import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import https from 'https'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { validateSchema, validateProjectId, validateOutputType, sanitizeString } from '@/lib/security/validation'
import { getN8nWebhookUrl } from '@/lib/n8n'

// Workflow timeout: 5 minutes. Same limit locally and when deployed.
// When deployed: Vercel Pro allows up to 300s; Hobby is 10s. Other hosts may differ.
export const maxDuration = 300

/** Download image via Node https (fallback when fetch fails with "fetch failed" on some networks). */
function downloadImageViaHttps(url: string, timeoutMs: number): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      reject(new Error('Only https URLs supported'))
      return
    }
    const req = https.get(
      url,
      { headers: { Accept: 'image/*', 'User-Agent': 'DiffuseWorkflow/1.0 (image-fetch)' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Image fetch ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const contentType = res.headers['content-type'] || 'image/png'
          resolve({ buffer, contentType })
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Image fetch timeout'))
    })
  })
}

// Helper to extract the actual article JSON from various n8n/OpenAI response formats
function extractArticleContent(n8nResult: any): string {
  try {
    // Case 1: Direct output string (Simplify Output ON)
    if (typeof n8nResult.output === 'string') {
      return n8nResult.output
    }

    // Case 2: Array response from OpenAI (Simplify Output OFF)
    if (Array.isArray(n8nResult)) {
      const firstItem = n8nResult[0]
      
      // Check for nested output array with message content
      if (firstItem?.output && Array.isArray(firstItem.output)) {
        const message = firstItem.output.find((o: any) => o.type === 'message')
        if (message?.content && Array.isArray(message.content)) {
          const textContent = message.content.find((c: any) => c.type === 'output_text')
          if (textContent?.text) {
            return textContent.text
          }
        }
      }
      
      // Check for direct content
      if (firstItem?.content) {
        if (Array.isArray(firstItem.content)) {
          const textContent = firstItem.content.find((c: any) => c.type === 'output_text' || c.text)
          if (textContent?.text) {
            return textContent.text
          }
        }
        return typeof firstItem.content === 'string' ? firstItem.content : JSON.stringify(firstItem.content)
      }
    }

    // Case 3: Object with output array
    if (n8nResult.output && Array.isArray(n8nResult.output)) {
      const message = n8nResult.output.find((o: any) => o.type === 'message')
      if (message?.content && Array.isArray(message.content)) {
        const textContent = message.content.find((c: any) => c.type === 'output_text')
        if (textContent?.text) {
          return textContent.text
        }
      }
    }

    // Case 4: Direct content property
    if (n8nResult.content) {
      return typeof n8nResult.content === 'string' ? n8nResult.content : JSON.stringify(n8nResult.content)
    }

    // Fallback: stringify the whole thing
    return JSON.stringify(n8nResult)
  } catch (error) {
    console.error('Error extracting content:', error)
    return JSON.stringify(n8nResult)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting - expensive operation
    const rateLimitResponse = await checkRateLimit(request, 'expensive')
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    // Authentication check
    let authResult
    try {
      authResult = await requireAuth()
    } catch {
      return unauthorizedResponse()
    }
    const { user, supabase } = authResult

    // Parse and validate request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body. Expected JSON.' },
        { status: 400 }
      )
    }

    // Strict input validation - only allow expected fields
    const WORKFLOW_OPTION_MAX_LENGTH = 200
    let validatedData
    try {
      validatedData = validateSchema(body, {
        project_id: {
          required: true,
          type: 'string',
          validator: validateProjectId,
        },
        output_type: {
          required: false,
          type: 'string',
          validator: (val) => val === undefined ? 'article' : validateOutputType(val),
        },
        mode: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : (val === 'quick' || val === 'refine' ? val : undefined),
        },
        tone: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, WORKFLOW_OPTION_MAX_LENGTH),
        },
        length: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, WORKFLOW_OPTION_MAX_LENGTH),
        },
        audience: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, WORKFLOW_OPTION_MAX_LENGTH),
        },
        comments: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, 2000),
        },
        number_of_outputs: {
          required: false,
          type: 'number',
          validator: (val) => {
            if (val == null || val === '') return undefined
            const n = Number(val)
            if (Number.isNaN(n) || n < 2 || n > 10 || !Number.isInteger(n)) return undefined
            return n
          },
        },
        article_topics: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, 1000),
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Validation failed', message: error.message },
        { status: 400 }
      )
    }

    const { project_id, output_type, mode, tone, length, audience, comments, number_of_outputs, article_topics } = validatedData

    // Contractor Pro: enforce 50 articles/month (articles only)
    if (output_type === 'article') {
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('subscription_tier')
          .eq('id', user.id)
          .single()

        if (profile?.subscription_tier === 'contractor_pro') {
          const monthStart = new Date()
          monthStart.setUTCDate(1)
          monthStart.setUTCHours(0, 0, 0, 0)

          const { count, error: countError } = await supabase
            .from('diffuse_project_outputs')
            .select('id, diffuse_projects!inner(created_by)', { count: 'exact', head: true })
            .eq('output_type', 'article')
            .gte('created_at', monthStart.toISOString())
            .eq('diffuse_projects.created_by', user.id)

          if (countError) {
            console.warn('[workflow] Could not check Contractor Pro limit:', countError.message)
          } else if ((count ?? 0) >= 50) {
            return NextResponse.json(
              { error: 'Monthly article limit reached for Contractor Pro (50 articles/month).' },
              { status: 429 }
            )
          }
        }
      } catch (e) {
        console.warn('[workflow] Contractor Pro limit check failed:', e instanceof Error ? e.message : e)
      }
    }

    // Authorization check - verify user owns the project
    try {
      await requireProjectOwnership(project_id, user.id, supabase)
    } catch (error: any) {
      return forbiddenResponse(error.message)
    }

    // Fetch all inputs for this project
    const { data: inputs, error: inputsError } = await supabase
      .from('diffuse_project_inputs')
      .select('*')
      .eq('project_id', project_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    if (inputsError) {
      console.error('Error fetching inputs:', inputsError)
      return NextResponse.json({ error: 'Failed to fetch inputs' }, { status: 500 })
    }

    if (!inputs || inputs.length === 0) {
      return NextResponse.json({ error: 'No inputs found for this project' }, { status: 400 })
    }

    // Cover photo: one per project, stored in inputs (type cover_photo). Now sent to workflow for subtitle generation.
    // The workflow can analyze the cover photo with vision AI and generate a subtitle related to the image and article.
    // The cover photo is attached to every output when saving and populates every input/output in the project; when updated, all get the same cover.
    const coverPhotoInput = inputs.find((i: any) => i.type === 'cover_photo')
    const coverPhotoPathFromDb = coverPhotoInput?.file_path ?? null
    const photoCreditFromInput =
      coverPhotoInput?.metadata?.photo_credit != null && String(coverPhotoInput.metadata.photo_credit).trim() !== ''
        ? String(coverPhotoInput.metadata.photo_credit).trim()
        : null
    const inputsForWorkflow = inputs.filter((input: any) => input.type !== 'cover_photo')

    if (inputsForWorkflow.length === 0) {
      return NextResponse.json({ error: 'Add at least one content input (text, recording, audio, document, or image) to generate output. Cover photo alone is not enough.' }, { status: 400 })
    }

    // Generate signed URL for cover photo so n8n can fetch it for vision analysis
    let coverPhotoSignedUrl: string | null = null
    if (coverPhotoPathFromDb) {
      const storageClient = createAdminClient() ?? supabase
      const { data: signed, error: signedError } = await storageClient.storage
        .from('project-files')
        .createSignedUrl(coverPhotoPathFromDb, 3600) // 1 hour expiry
      
      if (!signedError && signed?.signedUrl) {
        coverPhotoSignedUrl = signed.signedUrl
      } else if (signedError) {
        console.warn('Failed to generate signed URL for cover photo:', signedError)
      }
    }

    // Compute the primary input ID now so we can include it in the pending row before calling n8n.
    const primaryInputId = inputsForWorkflow[0]?.id ?? inputs[0]?.id ?? null

    // Create a pending output row before calling n8n. This gives the UI something to show immediately
    // and lets the async callback route update it when n8n finishes (instead of the HTTP response).
    const { data: pendingOutput, error: pendingCreateError } = await supabase
      .from('diffuse_project_outputs')
      .insert({
        project_id,
        input_id: primaryInputId,
        content: '',
        output_type,
        workflow_status: 'pending',
        cover_photo_path: coverPhotoPathFromDb ?? null,
      })
      .select()
      .single()

    if (pendingCreateError) {
      console.error('[workflow] Failed to create pending output row:', pendingCreateError.message)
      return NextResponse.json({ error: 'Failed to initialize output' }, { status: 500 })
    }

    // Build callback URL from request headers — works in local dev and on Vercel/custom domains.
    const callbackHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
    const callbackProto = request.headers.get('x-forwarded-proto') ?? 'https'
    const callbackUrl = `${callbackProto}://${callbackHost}/api/workflow/callback`

    // Prepare payload for n8n - all fields always present for clean consumption by AI nodes.
    // See docs/N8N_WEBHOOK_PAYLOAD.md for schema.
    const n8nPayload = {
      project_id,
      user_id: user.id, // so n8n can upload to project-files at {user_id}/{project_id}/...
      output_type,
      mode: mode === 'quick' || mode === 'refine' ? mode : 'refine',
      inputs: inputsForWorkflow.map((input: any) => ({
        id: input.id,
        type: input.type,
        content: input.content || '',
        file_name: input.file_name || 'Untitled',
        image_url: input.type === 'image' ? (input.metadata?.storage_url ?? null) : null,
        file_path: input.file_path ?? null,
      })),
      cover_photo_url: coverPhotoSignedUrl ?? null,
      photo_credit: photoCreditFromInput ?? null,
      tone: (tone != null && tone !== '') ? tone : null,
      length: (length != null && length !== '') ? length : null,
      audience: (audience != null && audience !== '') ? audience : null,
      comments: (comments != null && comments !== '') ? comments : null,
      number_of_outputs: (number_of_outputs != null && number_of_outputs >= 2) ? number_of_outputs : 1,
      article_topics: (article_topics != null && article_topics !== '') ? article_topics : null,
      output_id: pendingOutput.id,  // echoed back in async callbacks so the callback route knows which row to update
      callback_url: callbackUrl,    // where n8n should POST the final result when running in async mode
    }

    // Call n8n webhook
    const webhookUrl = getN8nWebhookUrl()
    if (!webhookUrl) {
      await supabase
        .from('diffuse_project_outputs')
        .update({ workflow_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', pendingOutput.id)
      return NextResponse.json(
        { error: 'Workflow service unavailable' },
        { status: 503 }
      )
    }

    const N8N_FETCH_TIMEOUT_MS = 300_000 // 5 min - matches maxDuration (same locally and on Vercel Pro)
    const n8nResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(n8nPayload),
      signal: AbortSignal.timeout(N8N_FETCH_TIMEOUT_MS),
    })

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text()
      console.error('[workflow] n8n webhook returned', n8nResponse.status, errorText?.slice(0, 500))
      // Mark the pending output as failed so the UI doesn't show a stuck PENDING card.
      await supabase
        .from('diffuse_project_outputs')
        .update({ workflow_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', pendingOutput.id)
      const message = errorText?.trim()
        ? `Workflow returned ${n8nResponse.status}: ${errorText.slice(0, 200)}${errorText.length > 200 ? '…' : ''}`
        : 'Workflow execution failed'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const responseContentType = n8nResponse.headers.get('content-type') || ''
    let n8nResult: unknown
    /** When n8n responds with multipart/form-data, we can receive the image as a binary part (no Azure fetch). */
    let imageBinaryFromMultipart: { buffer: Buffer; contentType: string } | null = null

    if (responseContentType.includes('multipart/form-data')) {
      const formData = await n8nResponse.formData()
      const jsonPart = formData.get('json') ?? formData.get('payload') ?? formData.get('data')
      const rawImage =
        formData.get('image') ?? formData.get('file') ?? formData.get('cover') ?? formData.get('cover_image') ?? formData.get('binary') ?? formData.get('attachment')
      let imagePart: Blob | File | null = rawImage instanceof Blob ? rawImage : null
      if (!(imagePart instanceof Blob) || imagePart.size === 0) {
        for (const [name, value] of formData.entries()) {
          if (value instanceof Blob && value.size > 0 && (value.type.startsWith('image/') || name.toLowerCase().includes('image') || name.toLowerCase().includes('file') || name.toLowerCase().includes('cover'))) {
            imagePart = value
            break
          }
        }
      }
      if (jsonPart instanceof Blob) {
        const text = await jsonPart.text()
        try {
          n8nResult = JSON.parse(text)
        } catch {
          n8nResult = {}
        }
      } else {
        n8nResult = {}
      }
      if (imagePart instanceof Blob && imagePart.size > 0) {
        const ab = await imagePart.arrayBuffer()
        imageBinaryFromMultipart = {
          buffer: Buffer.from(ab),
          contentType: (imagePart.type && imagePart.type.startsWith('image/')) ? imagePart.type : 'image/png',
        }
        console.log('[workflow] Received image as binary in multipart response, size:', imageBinaryFromMultipart.buffer.length)
      } else {
        const partNames = Array.from(formData.keys())
        console.log('[workflow] Multipart response had no image part; formData keys:', partNames.join(', ') || '(none)')
      }
    } else {
      // n8n sometimes responds with text/plain or empty body; don't hard-fail JSON parsing.
      const responseText = await n8nResponse.text()
      if (!responseText || responseText.trim() === '') {
        console.log('[workflow] n8n returned empty body; continuing with empty payload')
        n8nResult = {}
      } else {
        try {
          n8nResult = JSON.parse(responseText)
        } catch {
          // Preserve raw output so extractArticleContent can still read it via `.output`.
          n8nResult = { output: responseText }
        }
      }
    }

    // Normalize external image URL so it always has https (avoids <img> / next/image failing)
    const normalizeImageUrl = (u: string | undefined): string | undefined => {
      if (!u || typeof u !== 'string') return undefined
      const t = u.trim()
      if (t.startsWith('https://') || t.startsWith('http://')) return t
      if (t.startsWith('//')) return `https:${t}`
      if (t.includes('.') && (t.includes('blob.') || t.includes('amazonaws.') || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t))) return `https://${t}`
      return undefined
    }

    // Recursively find first string that looks like an image URL (so we find it even if n8n put it in a different node)
    const IMAGE_URL_PATTERN = /^https?:\/\/|^\/\/|\.blob\.|\.amazonaws\.|\.(png|jpg|jpeg|webp|gif)(\?|$)/i
    function findImageUrlInPayload(obj: unknown, depth = 0): string | undefined {
      if (depth > 20) return undefined
      if (typeof obj === 'string') {
        const normalized = normalizeImageUrl(obj)
        if (normalized && IMAGE_URL_PATTERN.test(normalized)) return normalized
        return undefined
      }
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const u = findImageUrlInPayload(item, depth + 1)
          if (u) return u
        }
        return undefined
      }
      if (obj && typeof obj === 'object') {
        const o = obj as Record<string, unknown>
        for (const key of ['url', 'image_url', 'image', 'generated_image_url', 'src', 'href']) {
          const u = findImageUrlInPayload(o[key], depth + 1)
          if (u) return u
        }
        for (const value of Object.values(o)) {
          const u = findImageUrlInPayload(value, depth + 1)
          if (u) return u
        }
      }
      return undefined
    }

    // Recursively find base64 image (workflow can send image bytes so we never need to fetch from Azure)
    const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/
    function findBase64ImageInPayload(obj: unknown, depth = 0): { data: string; contentType?: string } | undefined {
      if (depth > 20) return undefined
      if (typeof obj === 'string') {
        if (obj.length > 100 && BASE64_PATTERN.test(obj.replace(/\s/g, ''))) return { data: obj }
        return undefined
      }
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const b = findBase64ImageInPayload(item, depth + 1)
          if (b) return b
        }
        return undefined
      }
      if (obj && typeof obj === 'object') {
        const o = obj as Record<string, unknown>
        for (const key of ['image_base64', 'imageBase64', 'image_base64_data', 'image_data']) {
          const v = o[key]
          if (typeof v === 'string' && v.length > 100 && BASE64_PATTERN.test(v.replace(/\s/g, ''))) {
            return { data: v, contentType: typeof o.content_type === 'string' ? o.content_type : undefined }
          }
        }
        if (o.image && typeof o.image === 'object' && o.image !== null && typeof (o.image as Record<string, unknown>).data === 'string') {
          const d = (o.image as Record<string, unknown>).data as string
          if (d.length > 100 && BASE64_PATTERN.test(d.replace(/\s/g, ''))) return { data: d }
        }
        for (const value of Object.values(o)) {
          const b = findBase64ImageInPayload(value, depth + 1)
          if (b) return b
        }
      }
      return undefined
    }

    // 0) If workflow already uploaded to Supabase and returned the path, use it (best: no Azure fetch, no proxy)
    const UUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+$/i
    function findStoragePathInPayload(obj: unknown, depth = 0): string | undefined {
      if (depth > 20) return undefined
      if (typeof obj === 'string') {
        const t = obj.trim()
        if (t.length > 10 && t.length < 500 && !t.startsWith('http') && UUID_PATH.test(t) && !t.includes('..')) return t
        return undefined
      }
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const p = findStoragePathInPayload(item, depth + 1)
          if (p) return p
        }
        return undefined
      }
      if (obj && typeof obj === 'object') {
        const o = obj as Record<string, unknown>
        for (const key of ['cover_photo_path', 'storage_path', 'supabase_path', 'image_storage_path', 'image_path']) {
          const v = o[key]
          if (typeof v === 'string') {
            const p = findStoragePathInPayload(v, depth + 1)
            if (p) return p
          }
        }
        for (const value of Object.values(o)) {
          const p = findStoragePathInPayload(value, depth + 1)
          if (p) return p
        }
      }
      return undefined
    }
    const workflowStoragePath = findStoragePathInPayload(n8nResult)
    if (workflowStoragePath) console.log('[workflow] Found Supabase storage path in n8n response:', workflowStoragePath)

    // 1) Prefer base64 image if workflow sent it (no Azure fetch needed)
    const imageBase64 = findBase64ImageInPayload(n8nResult)
    if (imageBase64) console.log('[workflow] Found image_base64 in n8n response')

    // 2) Try to find image URL in the raw n8n response (handles different node layouts)
    let generatedImageUrl = findImageUrlInPayload(n8nResult)
    // Explicitly handle webhook shape: [{ article: {...}, generated_image_url: "https://..." }]
    if (!generatedImageUrl && Array.isArray(n8nResult) && n8nResult.length > 0) {
      const first = n8nResult[0]
      if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).generated_image_url === 'string') {
        const url = (first as Record<string, unknown>).generated_image_url as string
        if (normalizeImageUrl(url)) generatedImageUrl = normalizeImageUrl(url)!
      }
    }
    if (generatedImageUrl) {
      console.log('[workflow] Found image URL in n8n response (host: ' + new URL(generatedImageUrl).hostname + ')')
    }

    // Extract the AI-generated content from n8n response (for article + fallback URL)
    let extractedContent = extractArticleContent(n8nResult)
    // Strip markdown code fences if present (e.g. ```json ... ```)
    const codeBlockMatch = extractedContent.match(/^[\s\n]*```(?:json)?\s*([\s\S]*?)```[\s\n]*$/m)
    if (codeBlockMatch) {
      extractedContent = codeBlockMatch[1].trim()
    }

    // 2) If we didn't find URL in raw response, try inside extracted content (array/object with url)
    if (!generatedImageUrl) {
      try {
        const parsed = JSON.parse(extractedContent)
        generatedImageUrl = findImageUrlInPayload(parsed)
      } catch {
        /* ignore */
      }
    }

    if (!generatedImageUrl) {
      const keys = typeof n8nResult === 'object' && n8nResult !== null ? Object.keys(n8nResult as object).join(', ') : 'n/a'
      const sample = JSON.stringify(n8nResult).slice(0, 600)
      console.log('[workflow] No image URL found in n8n response. Top-level keys:', keys, '| Sample:', sample + (JSON.stringify(n8nResult).length > 600 ? '...' : ''))
    }

    // Parse JSON; normalize article and final content
    let finalContent = extractedContent
    const workflowMetadata: Record<string, unknown> | undefined = generatedImageUrl ? { generated_image_url: generatedImageUrl } : undefined
    try {
      const parsed = JSON.parse(extractedContent)
      if (Array.isArray(parsed)) {
        const articleItem = parsed.find((p: any) => p && typeof p === 'object' && p.article)
        const articleObj = articleItem?.article
        if (articleObj && typeof articleObj === 'object') {
          (articleObj as Record<string, unknown>).author = 'Diffuse.AI'
        }
        finalContent = JSON.stringify(parsed)
      } else if (parsed && typeof parsed === 'object') {
        if (!('author' in parsed)) parsed.author = 'Diffuse.AI'
        finalContent = JSON.stringify(parsed)
      }
    } catch {
      // Not valid JSON, use as-is
    }

    // Guard: n8n returned empty/meaningless content. This happens when:
    // (a) n8n's internal webhook response timeout fired before the workflow finished (sync mode), or
    // (b) n8n is configured in async mode and will POST the real content via the callback URL.
    // Either way, do NOT persist garbage — leave the pending row alive for the callback to update.
    const looksEmpty =
      !finalContent ||
      finalContent.trim() === '' ||
      finalContent.trim() === '{}' ||
      finalContent.trim() === '[]'

    if (looksEmpty) {
      console.log('[workflow] n8n returned empty/ack body; pending row stays for async callback:', pendingOutput.id)
      const pendingResp = NextResponse.json({
        success: true,
        output: pendingOutput,
        pending: true,
        message: 'Generation is running. Results will appear automatically when complete.',
      })
      const pendingRateLimitHeaders = getRateLimitHeaders(request, 'expensive')
      Object.entries(pendingRateLimitHeaders).forEach(([key, value]) => {
        pendingResp.headers.set(key, value)
      })
      return pendingResp
    }

    // n8n responded synchronously with real content — update the pending row to completed.
    const hasWorkflowImage = !!(workflowStoragePath || generatedImageUrl || imageBase64 || imageBinaryFromMultipart)
    const initialCoverPath = workflowStoragePath ?? (hasWorkflowImage ? null : coverPhotoPathFromDb)
    const { data: output, error: outputError } = await supabase
      .from('diffuse_project_outputs')
      .update({
        content: finalContent,
        workflow_status: 'completed',
        cover_photo_path: initialCoverPath,
        ...(workflowMetadata && { workflow_metadata: workflowMetadata }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', pendingOutput.id)
      .select()
      .single()

    if (outputError) {
      console.error('Error saving output:', outputError)
      const isPermissionError =
        outputError.code === '42501' ||
        (outputError.message && /policy|permission|row-level security/i.test(outputError.message))
      const status = isPermissionError ? 403 : 500
      const message = isPermissionError
        ? "You don't have permission to update outputs for this project."
        : 'Failed to save output'
      return NextResponse.json({ error: message }, { status })
    }

    // When we have a workflow-generated cover (from workflow path or after we upload), we'll add it as an image input so it shows in Inputs and with the output.
    let generatedImagePathForInput: string | null = workflowStoragePath ?? null

    // Persist workflow image: download from URL (or decode base64) and upload to our bucket so we can display without proxy.
    // Use admin client for storage so upload succeeds regardless of RLS.
    const storageClient = createAdminClient() ?? supabase
    if (!createAdminClient()) {
      console.warn('[workflow] SUPABASE_SERVICE_ROLE_KEY not set; using user client for storage upload. If uploads fail, set the key so RLS does not block.')
    }
    if (output?.id && !workflowStoragePath) {
      let savedPath: string | null = null
      if (imageBinaryFromMultipart) {
        try {
          const { buffer: buf, contentType } = imageBinaryFromMultipart
          const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
          const storagePath = `${user.id}/${project_id}/cover-${output.id}-generated.${ext}`
          const { error: uploadError } = await storageClient.storage
            .from('project-files')
            .upload(storagePath, buf, { contentType: contentType.split(';')[0].trim(), upsert: true })
          if (!uploadError) {
            savedPath = storagePath
            console.log('[workflow] Multipart image uploaded to project-files at', storagePath)
          } else {
            console.error('[workflow] Multipart binary image upload failed:', uploadError.message)
          }
        } catch (e) {
          console.error('[workflow] Multipart binary image upload failed:', e instanceof Error ? e.message : e)
        }
      }
      if (!savedPath && imageBase64) {
        try {
          const buf = Buffer.from(imageBase64.data.replace(/\s/g, ''), 'base64')
          const contentType = imageBase64.contentType || 'image/png'
          const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
          const storagePath = `${user.id}/${project_id}/cover-${output.id}-generated.${ext}`
          const { error: uploadError } = await storageClient.storage
            .from('project-files')
            .upload(storagePath, buf, { contentType: contentType.split(';')[0].trim(), upsert: true })
          if (!uploadError) savedPath = storagePath
          else console.error('[workflow] Base64 image upload failed:', uploadError.message, 'code:', uploadError.name, uploadError)
        } catch (e) {
          console.error('[workflow] Base64 image decode/upload failed:', e instanceof Error ? e.message : e)
        }
      }
      if (!savedPath && generatedImageUrl) {
        const TIMEOUT_MS = 25000
        const fetchImageOptions = {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            Accept: 'image/*',
            'User-Agent': 'DiffuseWorkflow/1.0 (image-fetch)',
          },
        }
        let lastError: Error | null = null
        for (let attempt = 1; attempt <= 2; attempt++) {
          let buf: Buffer | null = null
          let contentType = 'image/png'
          try {
            console.log('[workflow] Downloading generated image (attempt ' + attempt + ') from workflow URL, host: ' + new URL(generatedImageUrl).hostname)
            try {
              const imageRes = await fetch(generatedImageUrl, fetchImageOptions)
              if (!imageRes.ok) {
                const errBody = await imageRes.text().catch(() => '')
                console.error('[workflow] Generated image fetch failed:', imageRes.status, imageRes.statusText, 'body:', errBody.slice(0, 300))
                lastError = new Error(`Image fetch ${imageRes.status}: ${errBody.slice(0, 100)}`)
                if (attempt === 2) break
                continue
              }
              const arrayBuffer = await imageRes.arrayBuffer()
              buf = Buffer.from(arrayBuffer)
              contentType = imageRes.headers.get('content-type') || 'image/png'
            } catch (fetchErr) {
              const fetchErrMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
              const err = fetchErr as Error & { cause?: Error; code?: string }
              const causeMsg = err.cause instanceof Error ? err.cause.message : String(err.cause ?? '')
              console.error('[workflow] fetch() failed:', fetchErrMsg, 'code:', err.code, 'cause:', causeMsg || '(none)')
              if (fetchErrMsg.includes('fetch failed') || fetchErrMsg.includes('ECONNREFUSED') || fetchErrMsg.includes('ENOTFOUND')) {
                console.log('[workflow] Trying Node https fallback for image download')
                const result = await downloadImageViaHttps(generatedImageUrl, TIMEOUT_MS)
                buf = result.buffer
                contentType = result.contentType
              } else {
                throw fetchErr
              }
            }
            if (!buf || buf.length === 0) {
              lastError = new Error('Empty image body')
              if (attempt === 2) break
              continue
            }
            const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
            const storagePath = `${user.id}/${project_id}/cover-${output.id}-generated.${ext}`
            const { error: uploadError } = await storageClient.storage
              .from('project-files')
              .upload(storagePath, buf, { contentType: contentType.split(';')[0].trim(), upsert: true })
            if (!uploadError) {
              savedPath = storagePath
              console.log('[workflow] Image uploaded to storage at', storagePath, '; updating output row')
              break
            }
            console.error('[workflow] Generated image upload failed:', uploadError.message, 'code:', uploadError.name, 'full:', JSON.stringify(uploadError))
            lastError = new Error(uploadError.message)
            if (attempt === 2) break
            continue
          } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e))
            const err = e as Error & { cause?: Error; code?: string }
            const causeMsg = err.cause instanceof Error ? err.cause.message : String(err.cause ?? '')
            const code = (err as any).code
            console.error('[workflow] Failed to persist generated image (attempt ' + attempt + '):', lastError.message, 'code:', code, 'cause:', causeMsg || '(none)')
            if ((code === 'ENOTFOUND' || (causeMsg && causeMsg.includes('ENOTFOUND'))) && attempt === 2) {
              console.error('[workflow] This server cannot resolve the image host (DNS). Have n8n send the image as base64 in the webhook response instead. See docs/N8N_IMAGE_RELIABLE_SETUP.md')
            }
            if (attempt === 2) break
          }
        }
      }
      if (savedPath) {
        const { error: updateErr } = await supabase
          .from('diffuse_project_outputs')
          .update({ cover_photo_path: savedPath, updated_at: new Date().toISOString() })
          .eq('id', output.id)
        if (updateErr) {
          console.error('[workflow] DB update failed (cover_photo_path):', updateErr.message)
        } else {
          output.cover_photo_path = savedPath
          generatedImagePathForInput = savedPath
          console.log('[workflow] Generated image saved to storage; output row updated:', savedPath)
        }
      } else {
        if (generatedImageUrl || imageBase64) {
          console.log('[workflow] Had image URL/base64 but upload failed; output row not updated (cover_photo_path unchanged)')
        } else {
          console.log('[workflow] No image URL or base64 in workflow response; output row not updated (cover_photo_path from project only)')
        }
      }
    }

    // Save the workflow-generated image as an image input; populate title, caption, credit from the same output article.
    if (output?.id && generatedImagePathForInput) {
      let imageTitle = 'Diffuse Generated Image'
      let photoCaption: string | undefined
      let photoCredit: string | undefined
      try {
        const parsed = JSON.parse(finalContent)
        let wrapper: Record<string, unknown> | null = null
        let article: Record<string, unknown> | null = null
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
          wrapper = parsed[0] as Record<string, unknown>
          const a = wrapper.article
          article = a && typeof a === 'object' ? (a as Record<string, unknown>) : null
        } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const p = parsed as Record<string, unknown>
          if (p.article && typeof p.article === 'object') {
            wrapper = p
            article = p.article as Record<string, unknown>
          } else {
            article = p as Record<string, unknown>
          }
        }
        const pickCap = (o: Record<string, unknown> | null) => {
          if (!o) return undefined
          const c = o.photo_caption
          return typeof c === 'string' && c.trim() ? c.trim() : undefined
        }
        const pickCredit = (o: Record<string, unknown> | null) => {
          if (!o) return undefined
          const c = o.photo_credit
          return typeof c === 'string' && c.trim() ? c.trim() : undefined
        }
        if (article && typeof article.title === 'string' && article.title.trim()) {
          imageTitle = article.title.trim()
        }
        photoCaption = pickCap(wrapper) ?? pickCap(article)
        photoCredit = pickCredit(wrapper) ?? pickCredit(article)
      } catch {
        /* ignore */
      }
      const ext = generatedImagePathForInput.includes('.') ? generatedImagePathForInput.split('.').pop()?.toLowerCase() || 'png' : 'png'
      const safeExt = /^(png|jpg|jpeg|webp|gif)$/i.test(ext || '') ? ext : 'png'
      const { error: inputErr } = await supabase
        .from('diffuse_project_inputs')
        .insert({
          project_id,
          type: 'image',
          content: null,
          file_path: generatedImagePathForInput,
          file_name: imageTitle,
          metadata: {
            source: 'workflow_generated',
            output_id: output.id,
            ...(photoCaption && { photo_caption: photoCaption }),
            ...(photoCredit && { photo_credit: photoCredit }),
          },
          created_by: user.id,
        })
      if (inputErr) {
        console.error('[workflow] Failed to add generated image as input:', inputErr.message)
      } else {
        console.log('[workflow] Generated image added as input; displays with output', output.id)
      }
    }

    const response = NextResponse.json({ 
      success: true, 
      output,
      message: 'Article generated successfully'
    })

    // Add rate limit headers
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    return response

  } catch (error: any) {
    console.error('Workflow API error:', error)

    if (error?.name === 'AbortError' || error?.message?.includes?.('timeout') || error?.message?.includes?.('aborted')) {
      return NextResponse.json(
        { error: 'Workflow timed out waiting for a response from n8n. If n8n is configured for async callbacks, results will appear automatically when complete. Otherwise, please try again.' },
        { status: 504 }
      )
    }

    // Don't expose internal error details
    if (error.message && (error.message.includes('Unauthorized') || error.message.includes('Forbidden'))) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes('Unauthorized') ? 401 : 403 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
