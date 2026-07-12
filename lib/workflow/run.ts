/**
 * Shared generation-trigger logic used by BOTH the cookie-authed HTTP route
 * (app/api/workflow/route.ts) and the agent MCP `generate_output` tool, so the
 * security-critical pieces — the monthly article quota and the per-output callback
 * nonce — cannot drift between the two entry points.
 *
 * Ownership semantics intentionally stay with each caller: the HTTP route allows
 * shared-org members (access check), while the agent path requires strict ownership.
 */

import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { getN8nWebhookUrl } from '@/lib/n8n'
import { consumeMonthlyUnits } from '@/lib/agent/usage'
import { AgentError } from '@/lib/agent/context'
import { fetchLatestRecordingTranscripts, resolveInputContent } from '@/lib/workflow/inputs'

export const MONTHLY_ARTICLE_LIMIT = 50

/** High-entropy nonce stored on a pending output and echoed by n8n on callback. */
export function generateCallbackNonce(): string {
  return randomBytes(24).toString('hex')
}

export interface QuotaResult {
  ok: boolean
  status?: number
  message?: string
}

/**
 * Enforce the Contractor Pro monthly article cap by UNITS (not rows), so
 * number_of_outputs cannot multiply spend. Fails CLOSED: if we cannot determine the
 * tier, generation is blocked rather than allowed.
 */
export async function assertArticleQuota(opts: {
  userId: string
  outputType: string
  requestedUnits: number
}): Promise<QuotaResult> {
  if (opts.outputType !== 'article') return { ok: true }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, status: 500, message: 'Could not verify your plan limit (server not configured).' }
  }

  const { data, error } = await admin
    .from('user_profiles')
    .select('subscription_tier')
    .eq('id', opts.userId)
    .maybeSingle()

  if (error) {
    // Fail closed: an unverifiable quota must block, not allow.
    console.error('[workflow/run] quota tier lookup failed (fail closed):', error.message)
    return { ok: false, status: 500, message: 'Could not verify your plan limit. Please try again.' }
  }

  const tier = (data?.subscription_tier as string | undefined) ?? 'free'
  if (tier !== 'contractor_pro') return { ok: true }

  const units = Math.max(1, Math.floor(opts.requestedUnits || 1))
  const allowed = await consumeMonthlyUnits(opts.userId, 'article_units', MONTHLY_ARTICLE_LIMIT, units)
  if (!allowed) {
    return {
      ok: false,
      status: 429,
      message: `Monthly article limit reached for Contractor Pro (${MONTHLY_ARTICLE_LIMIT} articles/month).`,
    }
  }
  return { ok: true }
}

export interface AgentGenerationParams {
  outputType: 'article' | 'ad'
  mode?: 'quick' | 'refine'
  tone?: string
  length?: string
  audience?: string
  comments?: string
  numberOfOutputs?: number
  articleTopics?: string
}

/**
 * Trigger generation for a project the agent user strictly owns. Inserts a pending
 * output, fires the n8n webhook in async mode, and returns the pending output id.
 * n8n posts the final result to /api/workflow/callback (verified by the nonce).
 */
export async function triggerAgentGeneration(args: {
  userId: string
  projectId: string
  params: AgentGenerationParams
}): Promise<{ outputId: string }> {
  const admin = createAdminClient()
  if (!admin) throw new AgentError('server', 'Server is not configured for agent generation')

  const { userId, projectId, params } = args
  const requestedUnits = params.numberOfOutputs && params.numberOfOutputs >= 2 ? params.numberOfOutputs : 1

  // 1) Quota (units, fail-closed) — shared with the HTTP route.
  const quota = await assertArticleQuota({ userId, outputType: params.outputType, requestedUnits })
  if (!quota.ok) {
    throw new AgentError(quota.status === 429 ? 'rate_limited' : 'server', quota.message ?? 'Quota check failed')
  }

  // 2) Fetch inputs; require at least one non-cover content input.
  const { data: inputs, error: inputsError } = await admin
    .from('diffuse_project_inputs')
    .select('*')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (inputsError) throw new AgentError('server', `Could not load inputs: ${inputsError.message}`)

  const coverPhotoInput = (inputs ?? []).find((i: { type: string }) => i.type === 'cover_photo')
  const contentInputs = (inputs ?? []).filter((i: { type: string }) => i.type !== 'cover_photo')
  if (contentInputs.length === 0) {
    throw new AgentError('bad_request', 'Add at least one text input to this project before generating.')
  }

  // 3) Sign the cover photo (best-effort) so n8n can use it for subtitle/vision.
  let coverPhotoSignedUrl: string | null = null
  const coverPhotoPath: string | null = coverPhotoInput?.file_path ?? null
  if (coverPhotoPath) {
    const { data: signed } = await admin.storage.from('project-files').createSignedUrl(coverPhotoPath, 3600)
    coverPhotoSignedUrl = signed?.signedUrl ?? null
  }

  // 4) Pending row with a per-output callback nonce.
  const callbackNonce = generateCallbackNonce()
  const primaryInputId = contentInputs[0]?.id ?? null
  const { data: pending, error: pendingError } = await admin
    .from('diffuse_project_outputs')
    .insert({
      project_id: projectId,
      input_id: primaryInputId,
      content: '',
      output_type: params.outputType,
      workflow_status: 'pending',
      cover_photo_path: coverPhotoPath,
      callback_nonce: callbackNonce,
    })
    .select('id')
    .single()
  if (pendingError || !pending) {
    throw new AgentError('server', `Could not initialize output: ${pendingError?.message ?? 'unknown'}`)
  }

  // 5) Fire n8n in async mode.
  const webhookUrl = getN8nWebhookUrl()
  if (!webhookUrl) {
    await admin
      .from('diffuse_project_outputs')
      .update({ workflow_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', pending.id)
    throw new AgentError('server', 'Workflow service is currently unavailable')
  }

  // Refresh recording-sourced inputs from the current recording transcript so speaker names
  // identified after the recording was added still reach the workflow (see lib/workflow/inputs).
  const latestRecordingTranscripts = await fetchLatestRecordingTranscripts(contentInputs, admin)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const payload = {
    project_id: projectId,
    user_id: userId,
    output_type: params.outputType,
    mode: params.mode === 'quick' ? 'quick' : 'refine',
    inputs: contentInputs.map((input: Record<string, unknown>) => ({
      id: input.id,
      type: input.type,
      content: resolveInputContent(input, latestRecordingTranscripts),
      file_name: input.file_name || 'Untitled',
      image_url: input.type === 'image' ? ((input.metadata as { storage_url?: string } | null)?.storage_url ?? null) : null,
      file_path: input.file_path ?? null,
    })),
    cover_photo_url: coverPhotoSignedUrl,
    tone: params.tone || null,
    length: params.length || null,
    audience: params.audience || null,
    comments: params.comments || null,
    number_of_outputs: requestedUnits,
    article_topics: params.articleTopics || null,
    output_id: pending.id,
    callback_url: `${appUrl}/api/workflow/callback`,
    callback_nonce: callbackNonce,
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      await admin
        .from('diffuse_project_outputs')
        .update({ workflow_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', pending.id)
      throw new AgentError('server', `Workflow service returned ${res.status}`)
    }
  } catch (e) {
    if (e instanceof AgentError) throw e
    await admin
      .from('diffuse_project_outputs')
      .update({ workflow_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', pending.id)
    throw new AgentError('server', 'Could not reach the workflow service')
  }

  return { outputId: pending.id }
}
