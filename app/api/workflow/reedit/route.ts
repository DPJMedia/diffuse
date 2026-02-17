import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { validateSchema, sanitizeString } from '@/lib/security/validation'
import { getReeditWebhookUrl } from '@/lib/n8n'
import type { DiffuseProjectOutput } from '@/types/database'

// Unwrap n8n response: { json }, { body }, { data }, [ { json } ], etc.
function unwrapN8nResponse(obj: unknown): unknown {
  if (obj == null) return obj
  const o = obj as Record<string, unknown>
  if (typeof o.json === 'object' && o.json !== null) return o.json
  if (typeof o.body === 'object' && o.body !== null) return o.body
  if (typeof o.data === 'object' && o.data !== null) return o.data
  if (Array.isArray(obj) && obj.length > 0) {
    const first = obj[0] as Record<string, unknown>
    if (first?.json != null) return first.json
    if (first?.body != null) return first.body
    return first
  }
  return obj
}

// Find article-like content (has title or content) in response - walk common shapes
function findArticleInPayload(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj == null) return null
  const o = obj as Record<string, unknown>
  if (typeof o !== 'object') return null
  if (o.article && typeof o.article === 'object') return o.article
  if ((o.title || o.content) && typeof o === 'object') return o
  if (Array.isArray(o)) {
    for (const item of o) {
      const found = findArticleInPayload(item, depth + 1)
      if (found) return found
    }
    return null
  }
  for (const key of ['json', 'body', 'data', 'output', 'result']) {
    const v = o[key]
    if (v != null) {
      const found = findArticleInPayload(v, depth + 1)
      if (found) return found
    }
  }
  if (typeof o.content === 'string' && o.content.trim().startsWith('{')) {
    try {
      return JSON.parse(o.content)
    } catch {
      /* ignore */
    }
  }
  if (typeof o.output === 'string' && o.output.trim().startsWith('{')) {
    try {
      return JSON.parse(o.output)
    } catch {
      /* ignore */
    }
  }
  // Direct string content (AI node returns text)
  if (typeof o === 'object' && o !== null) {
    const text = (o as any).text ?? (o as any).message
    if (typeof text === 'string' && text.trim().startsWith('{')) {
      try {
        return JSON.parse(text)
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

// Keys that may hold image/binary data - strip those values when sending to reedit workflow to stay under token limits
const BINARY_KEYS = new Set([
  'url', 'generated_image_url', 'image_url', 'image', 'data', 'image_base64', 'imageBase64', 'image_data', 'image_data_url',
])
const DATA_URL_PREFIX = 'data:'
const BASE64_PLACEHOLDER = '[image omitted]'
const MAX_BINARY_STRING_LENGTH = 500

function looksLikeBase64(str: string): boolean {
  if (str.length < 100) return false
  const cleaned = str.replace(/\s/g, '')
  return /^[A-Za-z0-9+/]+=*$/.test(cleaned) && cleaned.length > 200
}

/** Recursively strip data URLs and base64 image data from output content so only text is sent to the reedit workflow. */
function stripBinaryFromOutputContent(content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return content
  }

  function walk(obj: unknown, keyHint?: string): unknown {
    if (obj == null) return obj
    if (typeof obj === 'string') {
      if (obj.startsWith(DATA_URL_PREFIX)) return BASE64_PLACEHOLDER
      if (keyHint && BINARY_KEYS.has(keyHint) && looksLikeBase64(obj)) return BASE64_PLACEHOLDER
      return obj
    }
    if (Array.isArray(obj)) return obj.map((item, i) => walk(item, undefined))
    if (typeof obj === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj)) {
        out[k] = walk(v, k)
      }
      return out
    }
    return obj
  }

  const cleaned = walk(parsed)
  return JSON.stringify(cleaned)
}

// Extract article content as JSON string from n8n response
function extractWorkflowContent(n8nResult: unknown): string | null {
  const unwrapped = unwrapN8nResponse(n8nResult)
  const article = findArticleInPayload(unwrapped)
  if (article && typeof article === 'object') return JSON.stringify(article)
  if (unwrapped && typeof unwrapped === 'object') {
    const u = unwrapped as Record<string, unknown>
    if (u.article || u.title || u.content) return JSON.stringify(unwrapped)
  }
  if (typeof unwrapped === 'string' && unwrapped.trim().startsWith('{')) {
    return unwrapped.trim()
  }
  return null
}

// Merge: replace everything with workflow content EXCEPT image, photo_caption, photo_credit
function mergeContent(existingContent: string, workflowContent: string): string {
  let existing: unknown = null
  let workflow: unknown = null

  try {
    existing = JSON.parse(existingContent)
  } catch {
    return workflowContent
  }
  try {
    workflow = JSON.parse(workflowContent)
  } catch {
    return existingContent
  }

  const getArticle = (obj: unknown): Record<string, unknown> | null => {
    if (!obj || typeof obj !== 'object') return null
    const o = obj as Record<string, unknown>
    if (Array.isArray(o)) {
      const item = o.find((p: any) => p && typeof p === 'object' && p.article)
      return item?.article && typeof item.article === 'object' ? (item.article as Record<string, unknown>) : null
    }
    if (o.article && typeof o.article === 'object') return o.article as Record<string, unknown>
    if (o.title || o.content) return o as Record<string, unknown>
    return null
  }

  const hasImageUrl = (obj: unknown): boolean => {
    if (!obj || typeof obj !== 'object') return false
    const o = obj as Record<string, unknown>
    const url = o.url ?? o.generated_image_url ?? o.image_url ?? o.image
    return typeof url === 'string' && String(url).trim().length > 0
  }

  const existingArticle = getArticle(existing)
  const workflowArticle = getArticle(workflow)
  if (!workflowArticle) return workflowContent // No article in workflow? Use workflow as-is

  // Preserve ONLY photo_caption and photo_credit from existing (image metadata stays same)
  if (existingArticle) {
    const preserveKeys = ['photo_caption', 'photo_credit'] as const
    for (const key of preserveKeys) {
      const val = existingArticle[key]
      if (val !== undefined && val !== null && String(val).trim()) {
        workflowArticle[key] = val
      }
    }
  }

  // Build final output - match existing structure when possible
  if (Array.isArray(existing) && existing.length >= 2) {
    // Existing uses array format [ {image}, { article } ] - preserve first element (image), use workflow article
    const result = [...existing] as Array<Record<string, unknown>>
    const second = result[1]
    if (second && typeof second === 'object') {
      second.article = workflowArticle
      return JSON.stringify(result)
    }
  }
  if (Array.isArray(existing) && existing.length >= 1 && hasImageUrl(existing[0])) {
    // Existing has image in first slot
    const result = [existing[0], { article: workflowArticle }]
    return JSON.stringify(result)
  }

  // Flat or unknown structure - output workflow article (nested or flat)
  if (Array.isArray(workflow) && workflow.length >= 2) {
    const second = workflow[1] as Record<string, unknown>
    if (second?.article) {
      second.article = workflowArticle
      if (Array.isArray(existing) && existing.length >= 1 && hasImageUrl(existing[0])) {
        (workflow as unknown[])[0] = existing[0]
      }
      return JSON.stringify(workflow)
    }
  }
  const w = workflow as Record<string, unknown>
  if (w && typeof w === 'object') {
    if (w.article) w.article = workflowArticle
    else Object.assign(w, workflowArticle)
    return JSON.stringify(workflow)
  }
  return JSON.stringify(workflowArticle)
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await checkRateLimit(request, 'expensive')
    if (rateLimitResponse) return rateLimitResponse

    let authResult
    try {
      authResult = await requireAuth()
    } catch {
      return unauthorizedResponse()
    }
    const { user, supabase } = authResult

    let body: { output_id?: string; comments?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body. Expected JSON.' }, { status: 400 })
    }

    let validatedData: { output_id: string; comments: string }
    try {
      validatedData = validateSchema(body, {
        output_id: {
          required: true,
          type: 'string',
          validator: (val: unknown) => {
            if (typeof val !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
              throw new Error('Invalid output_id format')
            }
            return val
          },
        },
        comments: {
          required: true,
          type: 'string',
          validator: (val: unknown) => (val == null || val === '') ? '' : sanitizeString(val, 3000),
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Validation failed', message: error.message },
        { status: 400 }
      )
    }

    const { output_id, comments } = validatedData
    if (!comments.trim()) {
      return NextResponse.json({ error: 'Comments are required' }, { status: 400 })
    }

    const { data: output, error: fetchError } = await supabase
      .from('diffuse_project_outputs')
      .select('*')
      .eq('id', output_id)
      .single()

    if (fetchError || !output) {
      return NextResponse.json({ error: 'Output not found' }, { status: 404 })
    }

    try {
      await requireProjectOwnership(output.project_id, user.id, supabase)
    } catch (error: any) {
      return forbiddenResponse(error.message)
    }

    const webhookUrl = getReeditWebhookUrl()
    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Re-edit workflow is not configured. Set N8N_REEDIT_WEBHOOK_URL.' },
        { status: 503 }
      )
    }

    const payload = {
      output_id,
      project_id: output.project_id,
      user_id: user.id,
      existing_content: stripBinaryFromOutputContent(output.content),
      comments: comments.trim(),
      workflow_metadata: output.workflow_metadata ?? {},
    }

    const n8nResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!n8nResponse.ok) {
      const errText = await n8nResponse.text()
      console.error('[reedit] Webhook error:', n8nResponse.status, errText)
      return NextResponse.json(
        { error: 'Re-edit workflow failed' },
        { status: 500 }
      )
    }

    const responseContentType = n8nResponse.headers.get('content-type') || ''
    let n8nResult: unknown
    if (responseContentType.includes('application/json')) {
      n8nResult = await n8nResponse.json()
    } else {
      const text = await n8nResponse.text()
      try {
        n8nResult = JSON.parse(text)
      } catch {
        return NextResponse.json(
          { error: 'Invalid workflow response format' },
          { status: 502 }
        )
      }
    }

    // Extract article content from workflow response (handles n8n json/body/data wrappers, arrays, etc.)
    let workflowContent = extractWorkflowContent(n8nResult)
    if (!workflowContent) {
      // Fallback: response might be a raw JSON string or inside output/content
      const raw = typeof n8nResult === 'string' ? n8nResult : JSON.stringify(n8nResult)
      const codeBlockMatch = raw.match(/^[\s\n]*```(?:json)?\s*([\s\S]*?)```[\s\n]*$/m)
      workflowContent = codeBlockMatch ? codeBlockMatch[1].trim() : raw
      try {
        JSON.parse(workflowContent)
      } catch {
        console.error('[reedit] Could not extract valid JSON from workflow response')
        return NextResponse.json(
          { error: 'Workflow response must be valid JSON with article content (title, content, etc.)' },
          { status: 502 }
        )
      }
    }
    // Strip markdown code fences if still present
    const codeBlockMatch = workflowContent.match(/^[\s\n]*```(?:json)?\s*([\s\S]*?)```[\s\n]*$/m)
    if (codeBlockMatch) workflowContent = codeBlockMatch[1].trim()

    const mergedContent = mergeContent(output.content, workflowContent)

    // Save BOTH renditions to revisions so we can compare and diff from DB
    // 1. Previous: content before re-edit (what was in the output)
    const { error: revPrevError } = await supabase
      .from('diffuse_project_output_revisions')
      .insert({
        output_id: output_id,
        content: output.content,
        revision_type: 'previous',
      })

    if (revPrevError) {
      console.warn('[reedit] Failed to save previous revision (table may not exist or revision_type column missing):', revPrevError.message)
    }

    // 2. Proposed: workflow result (merged content for user to approve/deny per field)
    const { error: revProposedError } = await supabase
      .from('diffuse_project_output_revisions')
      .insert({
        output_id: output_id,
        content: mergedContent,
        revision_type: 'proposed',
      })

    if (revProposedError) {
      console.warn('[reedit] Failed to save proposed revision:', revProposedError.message)
    }

    // Return proposed content without updating - user approves/denies per field, then applies
    const response = NextResponse.json({
      success: true,
      output: output as DiffuseProjectOutput,
      proposed_content: mergedContent,
      previous_content: output.content,
      message: 'Re-edit complete. Review changes and apply to save.',
    })
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v))
    return response
  } catch (error: any) {
    console.error('[reedit] Error:', error)
    if (error.message?.includes('Unauthorized') || error.message?.includes('Forbidden')) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes('Unauthorized') ? 401 : 403 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
