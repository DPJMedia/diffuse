import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { validateSchema, sanitizeString } from '@/lib/security/validation'
import { getRegenImageWebhookUrl } from '@/lib/n8n'
import {
  extractRegenContextFromCoverInput,
  extractRegenContextFromOutput,
  mergeRegenImageProcessing,
  stripRegenImage,
} from '@/lib/regen-image-context'
import {
  unwrapN8nRegenResponse,
  extractRegenFieldsFromN8nBody,
  persistRegenImageFromN8nResult,
} from '@/lib/regen-image-persist'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const N8N_FETCH_TIMEOUT_MS = 300_000 // matches maxDuration (Vercel / workflow route)

/** Avoid huge JSON bodies that n8n / proxies reject (413) or slow down. */
const MAX_CONTENT_PREVIEW_CHARS = 16_000
const MAX_METADATA_JSON_CHARS = 24_000

function slimPayloadForN8n(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload }
  const raw = out.content
  if (typeof raw === 'string' && raw.length > MAX_CONTENT_PREVIEW_CHARS) {
    out.content_preview = raw.slice(0, MAX_CONTENT_PREVIEW_CHARS)
    delete out.content
  }
  const wm = out.workflow_metadata
  if (wm != null) {
    const s = JSON.stringify(wm)
    if (s.length > MAX_METADATA_JSON_CHARS) {
      out.workflow_metadata_preview = s.slice(0, MAX_METADATA_JSON_CHARS)
      delete out.workflow_metadata
    }
  }
  return out
}

function n8nFailureResponse(status: number, errText: string) {
  const snippet = errText.replace(/\s+/g, ' ').trim().slice(0, 400)
  let hint = 'The n8n webhook returned an error.'
  if (status === 404) {
    hint =
      'n8n returned 404 — use the Production webhook URL, confirm the workflow is active, and that the Webhook node accepts POST + JSON.'
  } else if (status === 413 || status === 431) {
    hint = 'Request body was too large for n8n. Try again; if it persists, reduce article size or contact support.'
  } else if (status >= 500) {
    hint = 'n8n returned a server error — check the workflow execution log in n8n.'
  }
  return NextResponse.json(
    {
      error: 'Image regeneration request failed',
      message: hint,
      n8n_status: status,
      n8n_detail: snippet || undefined,
    },
    { status: 502 }
  )
}

function parseWorkflowJsonResponse(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  if (!text?.trim()) {
    return { ok: false, message: 'Workflow returned empty response' }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, message: 'Workflow returned invalid JSON' }
  }
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

    const admin = createAdminClient()
    if (!admin) {
      console.error('[regen-image] SUPABASE_SERVICE_ROLE_KEY is required for storing the generated image')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    let body: {
      input_id?: string
      output_id?: string
      mode?: string
      comments?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body. Expected JSON.' }, { status: 400 })
    }

    let validated: { input_id?: string; output_id?: string; mode: 'scratch' | 'update'; comments: string }
    try {
      validated = validateSchema(body, {
        input_id: {
          required: false,
          type: 'string',
          validator: (val: unknown) => {
            if (val == null || val === '') return undefined
            if (typeof val !== 'string' || !UUID_RE.test(val)) throw new Error('Invalid input_id format')
            return val
          },
        },
        output_id: {
          required: false,
          type: 'string',
          validator: (val: unknown) => {
            if (val == null || val === '') return undefined
            if (typeof val !== 'string' || !UUID_RE.test(val)) throw new Error('Invalid output_id format')
            return val
          },
        },
        mode: {
          required: true,
          type: 'string',
          validator: (val: unknown) => {
            if (val !== 'scratch' && val !== 'update') throw new Error('mode must be scratch or update')
            return val as 'scratch' | 'update'
          },
        },
        comments: {
          required: true,
          type: 'string',
          validator: (val: unknown) => (val == null || val === '' ? '' : sanitizeString(val, 3000)),
        },
      }) as typeof validated
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Validation failed'
      return NextResponse.json({ error: 'Validation failed', message }, { status: 400 })
    }

    const hasInput = !!validated.input_id
    const hasOutput = !!validated.output_id
    if (hasInput === hasOutput) {
      return NextResponse.json(
        { error: 'Provide exactly one of input_id (cover photo input) or output_id (project output).' },
        { status: 400 }
      )
    }

    if (!validated.comments.trim()) {
      return NextResponse.json({ error: 'Comments are required' }, { status: 400 })
    }

    const webhookUrl = getRegenImageWebhookUrl()
    if (!webhookUrl) {
      console.error(
        '[regen-image] N8N_REGEN_IMAGE_WEBHOOK_URL is missing. Add it to .env.local (dev) or the host env (e.g. Vercel), then restart dev server or redeploy.'
      )
      return NextResponse.json(
        {
          error:
            'Image regeneration is not configured. Set N8N_REGEN_IMAGE_WEBHOOK_URL in the server environment and restart.',
        },
        { status: 503 }
      )
    }

    const jobId = randomUUID()
    let payload: Record<string, unknown>

    if (validated.input_id) {
      const { data: inputRow, error: inputErr } = await supabase
        .from('diffuse_project_inputs')
        .select('id, project_id, type, file_path, metadata, content')
        .eq('id', validated.input_id)
        .single()

      if (inputErr || !inputRow) {
        return NextResponse.json({ error: 'Input not found' }, { status: 404 })
      }
      if (inputRow.type !== 'cover_photo') {
        return NextResponse.json({ error: 'Input is not a cover photo' }, { status: 400 })
      }

      try {
        await requireProjectOwnership(inputRow.project_id, user.id, supabase)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Forbidden'
        return forbiddenResponse(msg)
      }

      const filePath = typeof inputRow.file_path === 'string' ? inputRow.file_path : null
      if (validated.mode === 'update' && !filePath) {
        return NextResponse.json(
          { error: 'There is no current image to refine. Choose “Start fresh” or upload a cover first.' },
          { status: 400 }
        )
      }

      const ctx = extractRegenContextFromCoverInput(
        inputRow.metadata as Record<string, unknown> | null | undefined
      )

      const metaMerged = mergeRegenImageProcessing(inputRow.metadata as Record<string, unknown> | undefined, jobId)
      const { error: metaErr } = await supabase
        .from('diffuse_project_inputs')
        .update({ metadata: metaMerged })
        .eq('id', inputRow.id)
      if (metaErr) {
        console.error('[regen-image] Failed to set processing on input:', metaErr)
        return NextResponse.json({ error: 'Could not start regeneration' }, { status: 500 })
      }

      payload = {
        source: 'cover_input',
        input_id: inputRow.id,
        project_id: inputRow.project_id,
        user_id: user.id,
        comments: validated.comments.trim(),
        mode: validated.mode,
        file_path: validated.mode === 'update' ? filePath : null,
        metadata: inputRow.metadata ?? {},
        image_prompt: ctx.image_prompt,
        photo_caption: ctx.photo_caption,
        photo_credit: ctx.photo_credit,
        job_id: jobId,
      }

      try {
        const u = new URL(webhookUrl)
        console.log('[regen-image] POST n8n webhook (sync)', u.origin + u.pathname)
      } catch {
        console.log('[regen-image] POST n8n webhook (invalid URL?)')
      }
      const bodyJson = JSON.stringify(slimPayloadForN8n(payload))
      let n8nResponse: Response
      try {
        n8nResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: bodyJson,
          signal: AbortSignal.timeout(N8N_FETCH_TIMEOUT_MS),
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Request failed'
        console.error('[regen-image] n8n fetch failed:', msg)
        await supabase
          .from('diffuse_project_inputs')
          .update({ metadata: stripRegenImage(inputRow.metadata as Record<string, unknown> | undefined) })
          .eq('id', inputRow.id)
        return NextResponse.json(
          {
            error: 'Image regeneration timed out or failed to reach n8n',
            message: msg.includes('abort') ? 'Workflow took too long. Try again or simplify the request.' : msg,
          },
          { status: 504 }
        )
      }

      if (!n8nResponse.ok) {
        const errText = await n8nResponse.text()
        console.error('[regen-image] Webhook error:', n8nResponse.status, errText?.slice(0, 500))
        await supabase
          .from('diffuse_project_inputs')
          .update({ metadata: stripRegenImage(inputRow.metadata as Record<string, unknown> | undefined) })
          .eq('id', inputRow.id)
        return n8nFailureResponse(n8nResponse.status, errText)
      }

      const responseText = await n8nResponse.text()
      const parsed = parseWorkflowJsonResponse(responseText)
      if (!parsed.ok) {
        await supabase
          .from('diffuse_project_inputs')
          .update({ metadata: stripRegenImage(inputRow.metadata as Record<string, unknown> | undefined) })
          .eq('id', inputRow.id)
        return NextResponse.json({ error: 'Invalid workflow response', message: parsed.message }, { status: 502 })
      }

      const flat = unwrapN8nRegenResponse(parsed.value)
      const ex = extractRegenFieldsFromN8nBody(flat)
      const persist = await persistRegenImageFromN8nResult(admin, {
        inputId: inputRow.id,
        jobId,
        image_base64: ex.image_base64,
        file_path: ex.file_path,
        content_type: ex.content_type,
        photo_caption: ex.photo_caption,
        photo_credit: ex.photo_credit,
        image_prompt: ex.image_prompt,
      })
      if (persist.error) {
        await supabase
          .from('diffuse_project_inputs')
          .update({ metadata: stripRegenImage(inputRow.metadata as Record<string, unknown> | undefined) })
          .eq('id', inputRow.id)
        return NextResponse.json({ error: persist.error }, { status: 502 })
      }
    } else {
      const { data: outputRow, error: outErr } = await supabase
        .from('diffuse_project_outputs')
        .select('id, project_id, cover_photo_path, workflow_metadata, content')
        .eq('id', validated.output_id!)
        .single()

      if (outErr || !outputRow) {
        return NextResponse.json({ error: 'Output not found' }, { status: 404 })
      }

      try {
        await requireProjectOwnership(outputRow.project_id, user.id, supabase)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Forbidden'
        return forbiddenResponse(msg)
      }

      const filePath = typeof outputRow.cover_photo_path === 'string' ? outputRow.cover_photo_path : null
      if (validated.mode === 'update' && !filePath) {
        return NextResponse.json(
          { error: 'There is no stored cover image to refine. Choose “Start fresh” or upload a cover first.' },
          { status: 400 }
        )
      }

      const ctx = extractRegenContextFromOutput(
        outputRow.workflow_metadata as Record<string, unknown> | null | undefined,
        typeof outputRow.content === 'string' ? outputRow.content : null
      )

      const wmMerged = mergeRegenImageProcessing(outputRow.workflow_metadata as Record<string, unknown> | undefined, jobId)
      const { error: wmErr } = await supabase
        .from('diffuse_project_outputs')
        .update({ workflow_metadata: wmMerged })
        .eq('id', outputRow.id)
      if (wmErr) {
        console.error('[regen-image] Failed to set processing on output:', wmErr)
        return NextResponse.json({ error: 'Could not start regeneration' }, { status: 500 })
      }

      payload = {
        source: 'output',
        output_id: outputRow.id,
        project_id: outputRow.project_id,
        user_id: user.id,
        comments: validated.comments.trim(),
        mode: validated.mode,
        file_path: validated.mode === 'update' ? filePath : null,
        workflow_metadata: outputRow.workflow_metadata ?? {},
        content: typeof outputRow.content === 'string' ? outputRow.content : null,
        image_prompt: ctx.image_prompt,
        photo_caption: ctx.photo_caption,
        photo_credit: ctx.photo_credit,
        job_id: jobId,
      }

      try {
        const u = new URL(webhookUrl)
        console.log('[regen-image] POST n8n webhook (sync)', u.origin + u.pathname)
      } catch {
        console.log('[regen-image] POST n8n webhook (invalid URL?)')
      }
      const bodyJson = JSON.stringify(slimPayloadForN8n(payload))
      let n8nResponse: Response
      try {
        n8nResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: bodyJson,
          signal: AbortSignal.timeout(N8N_FETCH_TIMEOUT_MS),
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Request failed'
        console.error('[regen-image] n8n fetch failed:', msg)
        await supabase
          .from('diffuse_project_outputs')
          .update({
            workflow_metadata: stripRegenImage(outputRow.workflow_metadata as Record<string, unknown> | undefined),
          })
          .eq('id', outputRow.id)
        return NextResponse.json(
          {
            error: 'Image regeneration timed out or failed to reach n8n',
            message: msg.includes('abort') ? 'Workflow took too long. Try again or simplify the request.' : msg,
          },
          { status: 504 }
        )
      }

      if (!n8nResponse.ok) {
        const errText = await n8nResponse.text()
        console.error('[regen-image] Webhook error:', n8nResponse.status, errText?.slice(0, 500))
        await supabase
          .from('diffuse_project_outputs')
          .update({
            workflow_metadata: stripRegenImage(outputRow.workflow_metadata as Record<string, unknown> | undefined),
          })
          .eq('id', outputRow.id)
        return n8nFailureResponse(n8nResponse.status, errText)
      }

      const responseText = await n8nResponse.text()
      const parsed = parseWorkflowJsonResponse(responseText)
      if (!parsed.ok) {
        await supabase
          .from('diffuse_project_outputs')
          .update({
            workflow_metadata: stripRegenImage(outputRow.workflow_metadata as Record<string, unknown> | undefined),
          })
          .eq('id', outputRow.id)
        return NextResponse.json({ error: 'Invalid workflow response', message: parsed.message }, { status: 502 })
      }

      const flat = unwrapN8nRegenResponse(parsed.value)
      const ex = extractRegenFieldsFromN8nBody(flat)
      const persist = await persistRegenImageFromN8nResult(admin, {
        outputId: outputRow.id,
        jobId,
        image_base64: ex.image_base64,
        file_path: ex.file_path,
        content_type: ex.content_type,
        photo_caption: ex.photo_caption,
        photo_credit: ex.photo_credit,
        image_prompt: ex.image_prompt,
      })
      if (persist.error) {
        await supabase
          .from('diffuse_project_outputs')
          .update({
            workflow_metadata: stripRegenImage(outputRow.workflow_metadata as Record<string, unknown> | undefined),
          })
          .eq('id', outputRow.id)
        return NextResponse.json({ error: persist.error }, { status: 502 })
      }
    }

    const response = NextResponse.json({
      success: true,
      message: 'Cover image ready to review.',
      job_id: jobId,
    })
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v))
    return response
  } catch (error: unknown) {
    console.error('[regen-image] Error:', error)
    if (error instanceof Error && (error.message?.includes('Unauthorized') || error.message?.includes('Forbidden'))) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes('Unauthorized') ? 401 : 403 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
