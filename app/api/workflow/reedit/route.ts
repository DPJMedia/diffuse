import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { validateSchema, sanitizeString } from '@/lib/security/validation'
import { getReeditWebhookUrl } from '@/lib/n8n'
import type { DiffuseProjectOutput } from '@/types/database'

// Extract article JSON from n8n response (reuse pattern from main workflow)
function extractArticleContent(n8nResult: unknown): string {
  try {
    const r = n8nResult as any
    if (typeof r?.output === 'string') return r.output
    if (Array.isArray(r)) {
      const first = r[0]
      if (first?.output && Array.isArray(first.output)) {
        const msg = first.output.find((o: any) => o.type === 'message')
        const content = msg?.content?.find((c: any) => c.type === 'output_text')
        if (content?.text) return content.text
      }
      if (first?.content) {
        if (Array.isArray(first.content)) {
          const tc = first.content.find((c: any) => c.type === 'output_text' || c.text)
          if (tc?.text) return tc.text
        }
        return typeof first.content === 'string' ? first.content : JSON.stringify(first.content)
      }
    }
    if (r?.output && Array.isArray(r.output)) {
      const msg = r.output.find((o: any) => o.type === 'message')
      const content = msg?.content?.find((c: any) => c.type === 'output_text')
      if (content?.text) return content.text
    }
    if (r?.content) return typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
    return JSON.stringify(n8nResult)
  } catch {
    return JSON.stringify(n8nResult)
  }
}

// Merge workflow response into existing content: preserve image, photo_caption, photo_credit
function mergeContent(existingContent: string, workflowContent: string): string {
  let existing: Record<string, unknown> | Array<unknown> | null = null
  let workflow: Record<string, unknown> | Array<unknown> | null = null

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

  const preserveKeys = ['photo_caption', 'photo_credit'] as const
  const getArticle = (obj: unknown): Record<string, unknown> | null => {
    if (!obj || typeof obj !== 'object') return null
    const o = obj as Record<string, unknown>
    if (Array.isArray(o)) {
      const item = o.find((p: any) => p?.article)
      return item?.article && typeof item.article === 'object' ? (item.article as Record<string, unknown>) : null
    }
    if (o.article && typeof o.article === 'object') return o.article as Record<string, unknown>
    if (o.title || o.content) return o
    return null
  }

  const hasImageUrl = (obj: unknown): boolean => {
    if (!obj || typeof obj !== 'object') return false
    const o = obj as Record<string, unknown>
    const url = o.url ?? o.generated_image_url ?? o.image_url ?? o.image
    return typeof url === 'string' && url.trim().length > 0
  }

  const existingArticle = getArticle(existing)
  const workflowArticle = getArticle(workflow)
  if (!workflowArticle) return existingContent

  // Preserve photo_caption and photo_credit from existing (image metadata stays same)
  if (existingArticle) {
    for (const key of preserveKeys) {
      const val = existingArticle[key]
      if (val !== undefined && val !== null && String(val).trim()) {
        workflowArticle[key] = val
      }
    }
  }

  // Build merged result - preserve image element from existing when using array format
  if (Array.isArray(workflow) && workflow.length >= 2) {
    const second = workflow[1] as Record<string, unknown>
    if (second?.article && typeof second.article === 'object') {
      (second as Record<string, unknown>).article = workflowArticle
      // Preserve first element (image/url) from existing if it has image URL
      if (Array.isArray(existing) && existing.length >= 1 && hasImageUrl(existing[0])) {
        workflow[0] = existing[0]
      }
      return JSON.stringify(workflow)
    }
  }
  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) {
    const w = workflow as Record<string, unknown>
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
      existing_content: output.content,
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

    const unwrapped = (n8nResult as any)?.json ?? (n8nResult as any)?.body ?? (n8nResult as any)?.data ?? n8nResult
    const extracted = extractArticleContent(
      Array.isArray(n8nResult) && n8nResult.length > 0 ? (n8nResult[0] as any)?.json ?? n8nResult[0] ?? unwrapped : unwrapped
    )

    const codeBlockMatch = extracted.match(/^[\s\n]*```(?:json)?\s*([\s\S]*?)```[\s\n]*$/m)
    const workflowContent = codeBlockMatch ? codeBlockMatch[1].trim() : extracted
    const mergedContent = mergeContent(output.content, workflowContent)

    const { data: updatedOutput, error: updateError } = await supabase
      .from('diffuse_project_outputs')
      .update({
        content: mergedContent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', output_id)
      .select()
      .single()

    if (updateError) {
      console.error('[reedit] DB update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save updated output' }, { status: 500 })
    }

    const response = NextResponse.json({
      success: true,
      output: updatedOutput as DiffuseProjectOutput,
      message: 'Output re-edited successfully',
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
