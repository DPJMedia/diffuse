import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import https from 'https'
import { isLikelyImageBase64, isValidImageBytes, imageExtFromBuffer } from '@/lib/workflowImage'
import { safeEqual } from '@/lib/auth/pat'
import { assertSafePublicUrl, safeFetch } from '@/lib/security/ssrf'

// Callback route receives the completed workflow result from n8n when running in async mode.
// n8n should POST here with the same payload it would normally return synchronously, plus output_id.
// Set WORKFLOW_CALLBACK_SECRET in environment and send it as "Authorization: Bearer <secret>" from n8n.
export const maxDuration = 120

// ── Helpers (mirror of app/api/workflow/route.ts) ──────────────────────────────

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
        res.on('end', () =>
          resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/png' })
        )
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Image fetch timeout'))
    })
  })
}

function extractArticleContent(n8nResult: any): string {
  try {
    if (typeof n8nResult.output === 'string') return n8nResult.output

    if (Array.isArray(n8nResult)) {
      const firstItem = n8nResult[0]
      if (firstItem?.output && Array.isArray(firstItem.output)) {
        const message = firstItem.output.find((o: any) => o.type === 'message')
        if (message?.content && Array.isArray(message.content)) {
          const textContent = message.content.find((c: any) => c.type === 'output_text')
          if (textContent?.text) return textContent.text
        }
      }
      if (firstItem?.content) {
        if (Array.isArray(firstItem.content)) {
          const textContent = firstItem.content.find((c: any) => c.type === 'output_text' || c.text)
          if (textContent?.text) return textContent.text
        }
        return typeof firstItem.content === 'string' ? firstItem.content : JSON.stringify(firstItem.content)
      }
    }

    if (n8nResult.output && Array.isArray(n8nResult.output)) {
      const message = n8nResult.output.find((o: any) => o.type === 'message')
      if (message?.content && Array.isArray(message.content)) {
        const textContent = message.content.find((c: any) => c.type === 'output_text')
        if (textContent?.text) return textContent.text
      }
    }

    if (n8nResult.content) {
      return typeof n8nResult.content === 'string' ? n8nResult.content : JSON.stringify(n8nResult.content)
    }

    return JSON.stringify(n8nResult)
  } catch (error) {
    console.error('[workflow/callback] Error extracting content:', error)
    return JSON.stringify(n8nResult)
  }
}

const IMAGE_URL_PATTERN = /^https?:\/\/|^\/\/|\.blob\.|\.amazonaws\.|\.(png|jpg|jpeg|webp|gif)(\?|$)/i
const UUID_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+$/i

function normalizeImageUrl(u: string | undefined): string | undefined {
  if (!u || typeof u !== 'string') return undefined
  const t = u.trim()
  if (t.startsWith('https://') || t.startsWith('http://')) return t
  if (t.startsWith('//')) return `https:${t}`
  if (
    t.includes('.') &&
    (t.includes('blob.') || t.includes('amazonaws.') || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t))
  )
    return `https://${t}`
  return undefined
}

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

function findBase64ImageInPayload(obj: unknown, depth = 0): { data: string; contentType?: string } | undefined {
  if (depth > 20) return undefined
  if (typeof obj === 'string') {
    if (isLikelyImageBase64(obj)) return { data: obj }
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
      if (typeof v === 'string' && isLikelyImageBase64(v)) {
        return { data: v, contentType: typeof o.content_type === 'string' ? o.content_type : undefined }
      }
    }
    if (
      o.image &&
      typeof o.image === 'object' &&
      o.image !== null &&
      typeof (o.image as Record<string, unknown>).data === 'string'
    ) {
      const d = (o.image as Record<string, unknown>).data as string
      if (isLikelyImageBase64(d)) return { data: d }
    }
    for (const value of Object.values(o)) {
      const b = findBase64ImageInPayload(value, depth + 1)
      if (b) return b
    }
  }
  return undefined
}

function findStoragePathInPayload(obj: unknown, depth = 0): string | undefined {
  if (depth > 20) return undefined
  if (typeof obj === 'string') {
    const t = obj.trim()
    if (t.length > 10 && t.length < 500 && !t.startsWith('http') && UUID_PATH.test(t) && !t.includes('..'))
      return t
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

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Verify shared secret. MANDATORY in production (fail closed if unset). Set
  // WORKFLOW_CALLBACK_SECRET in env and send "Authorization: Bearer <secret>" from n8n.
  const secret = process.env.WORKFLOW_CALLBACK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[workflow/callback] WORKFLOW_CALLBACK_SECRET is not set; refusing callbacks in production')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    console.warn('[workflow/callback] WORKFLOW_CALLBACK_SECRET not set (permitted in non-production only)')
  } else {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !safeEqual(authHeader, `Bearer ${secret}`)) {
      console.warn('[workflow/callback] Unauthorized callback attempt (missing or invalid secret)')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { output_id } = body
  if (!output_id || typeof output_id !== 'string') {
    return NextResponse.json({ error: 'output_id is required' }, { status: 400 })
  }

  // Use admin client — this is a server-to-server call with no user session cookie.
  const supabase = createAdminClient()
  if (!supabase) {
    console.error('[workflow/callback] SUPABASE_SERVICE_ROLE_KEY not configured; cannot process callback')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Fetch the pending output row to verify it exists.
  const { data: existingOutput, error: fetchError } = await supabase
    .from('diffuse_project_outputs')
    .select('id, project_id, workflow_status, callback_nonce')
    .eq('id', output_id)
    .single()

  if (fetchError || !existingOutput) {
    console.error('[workflow/callback] Output not found:', output_id, fetchError?.message)
    return NextResponse.json({ error: 'Output not found' }, { status: 404 })
  }

  // Defense-in-depth: if n8n echoes the per-output nonce, it MUST match (binds the callback
  // to that specific row). When n8n does not send one, the mandatory shared secret above is
  // the authentication. This lets the nonce be adopted in n8n without a breaking flag-day for
  // existing callbacks. To enforce it strictly later, have n8n always echo `callback_nonce`.
  if (
    existingOutput.callback_nonce &&
    typeof body.callback_nonce === 'string' &&
    body.callback_nonce.length > 0
  ) {
    if (!safeEqual(body.callback_nonce, existingOutput.callback_nonce)) {
      console.warn('[workflow/callback] Invalid callback_nonce for output:', output_id)
      return NextResponse.json({ error: 'Invalid callback nonce' }, { status: 401 })
    }
  }

  if (existingOutput.workflow_status === 'completed') {
    console.warn('[workflow/callback] Output already completed, ignoring duplicate callback:', output_id)
    return NextResponse.json({ success: true, message: 'Already completed' })
  }

  // Strip routing fields from body to get the raw n8n result payload.
  const { output_id: _oid, callback_url: _cburl, callback_nonce: _cbn, ...n8nResult } = body

  // Find image in payload (same logic as main workflow route).
  const workflowStoragePath = findStoragePathInPayload(n8nResult)
  if (workflowStoragePath) console.log('[workflow/callback] Found Supabase storage path:', workflowStoragePath)

  const imageBase64 = findBase64ImageInPayload(n8nResult)
  if (imageBase64) console.log('[workflow/callback] Found image_base64 in callback payload')

  let generatedImageUrl = findImageUrlInPayload(n8nResult)
  if (!generatedImageUrl && Array.isArray(n8nResult) && n8nResult.length > 0) {
    const first = n8nResult[0]
    if (
      first &&
      typeof first === 'object' &&
      typeof (first as Record<string, unknown>).generated_image_url === 'string'
    ) {
      const url = (first as Record<string, unknown>).generated_image_url as string
      if (normalizeImageUrl(url)) generatedImageUrl = normalizeImageUrl(url)!
    }
  }
  if (generatedImageUrl)
    console.log('[workflow/callback] Found image URL, host:', new URL(generatedImageUrl).hostname)

  // Extract and validate article content.
  let extractedContent = extractArticleContent(n8nResult)
  const codeBlockMatch = extractedContent.match(/^[\s\n]*```(?:json)?\s*([\s\S]*?)```[\s\n]*$/m)
  if (codeBlockMatch) extractedContent = codeBlockMatch[1].trim()

  // Also search for image URL inside the extracted content string.
  if (!generatedImageUrl) {
    try {
      const parsed = JSON.parse(extractedContent)
      generatedImageUrl = findImageUrlInPayload(parsed)
    } catch {
      /* ignore */
    }
  }

  const looksEmpty =
    !extractedContent ||
    extractedContent.trim() === '' ||
    extractedContent.trim() === '{}' ||
    extractedContent.trim() === '[]'

  if (looksEmpty) {
    console.error('[workflow/callback] Empty content in callback for output:', output_id)
    await supabase
      .from('diffuse_project_outputs')
      .update({ workflow_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', output_id)
    return NextResponse.json({ error: 'Empty content received in callback' }, { status: 422 })
  }

  // Normalize and parse finalContent.
  let finalContent = extractedContent
  const workflowMetadata: Record<string, unknown> | undefined =
    generatedImageUrl && !workflowStoragePath ? { generated_image_url: generatedImageUrl } : undefined
  try {
    const parsed = JSON.parse(extractedContent)
    if (Array.isArray(parsed)) {
      const articleItem = parsed.find((p: any) => p && typeof p === 'object' && p.article)
      const articleObj = articleItem?.article
      if (articleObj && typeof articleObj === 'object') {
        ;(articleObj as Record<string, unknown>).author = 'Diffuse.AI'
      }
      finalContent = JSON.stringify(parsed)
    } else if (parsed && typeof parsed === 'object') {
      if (!('author' in parsed)) parsed.author = 'Diffuse.AI'
      finalContent = JSON.stringify(parsed)
    }
  } catch {
    /* Not valid JSON, use as-is */
  }

  // Determine initial cover path: prefer workflow-provided storage path; if image will be
  // downloaded, set null for now and update after upload; otherwise keep whatever cover existed.
  const hasWorkflowImage = !!(workflowStoragePath || generatedImageUrl || imageBase64)
  const coverPhotoPath = workflowStoragePath ?? (hasWorkflowImage ? null : undefined)

  // Update the output row to completed with real content.
  const updatePayload: Record<string, unknown> = {
    content: finalContent,
    workflow_status: 'completed',
    updated_at: new Date().toISOString(),
    ...(workflowMetadata && { workflow_metadata: workflowMetadata }),
  }
  if (coverPhotoPath !== undefined) updatePayload.cover_photo_path = coverPhotoPath

  const { error: updateError } = await supabase
    .from('diffuse_project_outputs')
    .update(updatePayload)
    .eq('id', output_id)

  if (updateError) {
    console.error('[workflow/callback] Failed to update output to completed:', updateError.message)
    return NextResponse.json({ error: 'Failed to update output' }, { status: 500 })
  }

  console.log('[workflow/callback] Output marked completed:', output_id)

  // Fetch user_id for storage paths (needed for image upload).
  let createdBy: string | null = null
  if (hasWorkflowImage && !workflowStoragePath) {
    const { data: project } = await supabase
      .from('diffuse_projects')
      .select('created_by')
      .eq('id', existingOutput.project_id)
      .single()
    createdBy = project?.created_by ?? null
  }

  // Persist image to project-files storage (best-effort; same logic as main workflow route).
  let savedImagePath: string | null = workflowStoragePath ?? null

  if (!workflowStoragePath && createdBy) {
    if (imageBase64) {
      try {
        const buf = Buffer.from(imageBase64.data.replace(/\s/g, ''), 'base64')
        const decodedLen = buf.length
        if (!isValidImageBytes(buf)) {
          // Should not happen (detection already validates), but never persist non-image bytes.
          console.error('[workflow/callback] Decoded base64 is not a valid image; skipping. bytes:', decodedLen)
        } else {
          const ext = imageExtFromBuffer(buf)
          const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
          const storagePath = `${createdBy}/${existingOutput.project_id}/cover-${output_id}-generated.${ext}`
          const { error: uploadError } = await supabase.storage
            .from('project-files')
            .upload(storagePath, buf, { contentType, upsert: true })
          if (!uploadError) {
            savedImagePath = storagePath
            console.log('[workflow/callback] Base64 image uploaded:', storagePath)
          } else {
            console.error('[workflow/callback] Base64 upload failed:', uploadError.message)
          }
        }
      } catch (e) {
        console.error('[workflow/callback] Base64 decode/upload error:', e instanceof Error ? e.message : e)
      }
    }
    // SSRF guard: never fetch a payload-derived URL that resolves to a private/internal
    // address (e.g. 169.254.169.254 metadata). Skip the download entirely if unsafe.
    if (!savedImagePath && generatedImageUrl) {
      try {
        await assertSafePublicUrl(generatedImageUrl)
      } catch (e) {
        console.error('[workflow/callback] Refusing to fetch unsafe image URL:', e instanceof Error ? e.message : e)
        generatedImageUrl = undefined
      }
    }
    if (!savedImagePath && generatedImageUrl) {
      const TIMEOUT_MS = 25000
      let lastError: Error | null = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        let buf: Buffer | null = null
        let contentType = 'image/png'
        try {
          console.log(
            '[workflow/callback] Downloading image (attempt ' + attempt + ') from:',
            new URL(generatedImageUrl).hostname
          )
          try {
            // safeFetch re-validates every redirect hop against the SSRF allowlist.
            const imageRes = await safeFetch(generatedImageUrl, {
              signal: AbortSignal.timeout(TIMEOUT_MS),
              headers: { Accept: 'image/*', 'User-Agent': 'DiffuseWorkflow/1.0 (image-fetch)' },
            })
            if (!imageRes.ok) {
              lastError = new Error(`Image fetch ${imageRes.status}`)
              if (attempt === 2) break
              continue
            }
            const ab = await imageRes.arrayBuffer()
            buf = Buffer.from(ab)
            contentType = imageRes.headers.get('content-type') || 'image/png'
          } catch (fetchErr) {
            const fetchErrMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
            if (
              fetchErrMsg.includes('fetch failed') ||
              fetchErrMsg.includes('ECONNREFUSED') ||
              fetchErrMsg.includes('ENOTFOUND')
            ) {
              const result = await downloadImageViaHttps(generatedImageUrl, TIMEOUT_MS)
              buf = result.buffer
              contentType = result.contentType
            } else {
              throw fetchErr
            }
          }
          const dlLen = buf?.length ?? 0
          if (!isValidImageBytes(buf)) {
            // A 200 response can still be an HTML error page or a truncated body — never persist it.
            lastError = new Error(`Downloaded body is not a valid image (bytes: ${dlLen}, ct: ${contentType})`)
            if (attempt === 2) break
            continue
          }
          const ext = imageExtFromBuffer(buf)
          const uploadContentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
          const storagePath = `${createdBy}/${existingOutput.project_id}/cover-${output_id}-generated.${ext}`
          const { error: uploadError } = await supabase.storage
            .from('project-files')
            .upload(storagePath, buf, { contentType: uploadContentType, upsert: true })
          if (!uploadError) {
            savedImagePath = storagePath
            console.log('[workflow/callback] URL image uploaded:', storagePath)
            break
          }
          lastError = new Error(uploadError.message)
          if (attempt === 2) break
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e))
          console.error(
            '[workflow/callback] Image upload attempt ' + attempt + ' failed:',
            lastError.message
          )
          if (attempt === 2) break
        }
      }
      if (lastError && !savedImagePath) {
        console.error('[workflow/callback] All image upload attempts failed:', lastError.message)
      }
    }
  }

  // If we uploaded a new image, update cover_photo_path and add as image input.
  if (savedImagePath && savedImagePath !== workflowStoragePath) {
    await supabase
      .from('diffuse_project_outputs')
      .update({ cover_photo_path: savedImagePath, updated_at: new Date().toISOString() })
      .eq('id', output_id)
    console.log('[workflow/callback] cover_photo_path updated:', savedImagePath)
  }

  if (savedImagePath && createdBy) {
    let imageTitle = 'Diffuse Generated Image'
    let photoCaption: string | undefined
    let photoCredit: string | undefined
    try {
      const parsed = JSON.parse(finalContent)
      let article: Record<string, unknown> | null = null
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
        const wrapper = parsed[0] as Record<string, unknown>
        article = wrapper.article && typeof wrapper.article === 'object'
          ? (wrapper.article as Record<string, unknown>)
          : null
      } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>
        article = p.article && typeof p.article === 'object'
          ? (p.article as Record<string, unknown>)
          : p
      }
      if (article && typeof article.title === 'string' && article.title.trim()) {
        imageTitle = article.title.trim()
      }
      if (typeof article?.photo_caption === 'string' && article.photo_caption.trim()) {
        photoCaption = article.photo_caption.trim()
      }
      if (typeof article?.photo_credit === 'string' && article.photo_credit.trim()) {
        photoCredit = article.photo_credit.trim()
      }
    } catch {
      /* ignore */
    }
    const { error: inputErr } = await supabase.from('diffuse_project_inputs').insert({
      project_id: existingOutput.project_id,
      type: 'image',
      content: null,
      file_path: savedImagePath,
      file_name: imageTitle,
      metadata: {
        source: 'workflow_generated',
        output_id,
        ...(photoCaption && { photo_caption: photoCaption }),
        ...(photoCredit && { photo_credit: photoCredit }),
      },
      created_by: createdBy,
    })
    if (inputErr) {
      console.error('[workflow/callback] Failed to add generated image as input:', inputErr.message)
    } else {
      console.log('[workflow/callback] Generated image added as input for output:', output_id)
    }
  }

  console.log('[workflow/callback] Callback processing complete for output:', output_id)
  return NextResponse.json({ success: true })
}
