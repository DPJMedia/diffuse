/**
 * Image prompt / caption / credit extraction for cover regeneration webhooks.
 */

export type RegenImageContext = {
  image_prompt: string | null
  photo_caption: string | null
  photo_credit: string | null
}

function trimStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t || null
}

/** From workflow_metadata and/or parsed output content JSON. */
export function extractRegenContextFromOutput(
  workflowMetadata: Record<string, unknown> | null | undefined,
  content: string | null | undefined
): RegenImageContext {
  const wm = workflowMetadata ?? {}
  let image_prompt: string | null = null
  for (const key of ['image_prompt', 'suggested_image_prompt', 'suggestedImagePrompt']) {
    const p = trimStr(wm[key])
    if (p) {
      image_prompt = p
      break
    }
  }

  let photo_caption: string | null = trimStr(wm.photo_caption)
  let photo_credit: string | null = trimStr(wm.photo_credit)

  if (content && typeof content === 'string') {
    try {
      let parsed: unknown = JSON.parse(content)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        const art =
          o.article && typeof o.article === 'object' ? (o.article as Record<string, unknown>) : o
        if (!image_prompt) {
          for (const key of ['image_prompt', 'suggested_image_prompt']) {
            const p = trimStr(o[key])
            if (p) {
              image_prompt = p
              break
            }
          }
        }
        if (!image_prompt && art !== o) {
          for (const key of ['image_prompt', 'suggested_image_prompt']) {
            const p = trimStr(art[key])
            if (p) {
              image_prompt = p
              break
            }
          }
        }
        if (!photo_caption) photo_caption = trimStr(o.photo_caption) ?? trimStr(art.photo_caption)
        if (!photo_credit) photo_credit = trimStr(o.photo_credit) ?? trimStr(art.photo_credit)
      }
    } catch {
      /* ignore */
    }
  }

  return { image_prompt, photo_caption, photo_credit }
}

/** From cover_photo input metadata. */
export function extractRegenContextFromCoverInput(metadata: Record<string, unknown> | null | undefined): RegenImageContext {
  const m = metadata ?? {}
  let image_prompt: string | null = null
  for (const key of ['image_prompt', 'suggested_image_prompt', 'suggestedImagePrompt']) {
    const p = trimStr(m[key])
    if (p) {
      image_prompt = p
      break
    }
  }
  return {
    image_prompt,
    photo_caption: trimStr(m.photo_caption),
    photo_credit: trimStr(m.photo_credit),
  }
}

export function mergeRegenImageProcessing(
  existing: Record<string, unknown> | null | undefined,
  jobId: string
): Record<string, unknown> {
  const next = { ...(existing ?? {}) }
  next.regen_image = {
    status: 'processing' as const,
    started_at: new Date().toISOString(),
    job_id: jobId,
  }
  return next
}

/** Pending regen payload stored until the user approves (same shape n8n returns). */
export type RegenImagePendingPayload = {
  cover_photo_path: string
  photo_caption: string | null
  photo_credit: string | null
  /** Stored in workflow_metadata only; not shown in the article UI. */
  image_prompt: string | null
}

/**
 * Webhook: regeneration finished — image is in storage at `pending.cover_photo_path`;
 * committed `cover_photo_path` / article fields update only after user applies.
 */
export function mergeRegenImagePendingComplete(
  existing: Record<string, unknown> | null | undefined,
  pending: RegenImagePendingPayload,
  jobId?: string | null
): Record<string, unknown> {
  const next = { ...(existing ?? {}) }
  next.regen_image = {
    status: 'complete' as const,
    completed_at: new Date().toISOString(),
    ...(jobId ? { job_id: jobId } : {}),
    pending,
  }
  return next
}

export function stripRegenImage(existing: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const next = { ...(existing ?? {}) }
  delete next.regen_image
  return next
}
