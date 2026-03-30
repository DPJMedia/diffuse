/**
 * Persist a completed cover regen (pending review) — shared by POST /api/workflow/regen-image
 * after a synchronous n8n response. Mirrors the former regen-image-complete webhook behavior.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeRegenImagePendingComplete, type RegenImagePendingPayload } from '@/lib/regen-image-context'

function trimStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t || null
}

/** Unwrap common n8n “Respond to Webhook” / array shapes. */
export function unwrapN8nRegenResponse(raw: unknown): Record<string, unknown> {
  let cur: unknown = raw
  if (Array.isArray(cur) && cur.length > 0) {
    const first = cur[0] as Record<string, unknown>
    cur = first?.json ?? first
  }
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
    const o = cur as Record<string, unknown>
    const inner = o.json ?? o.body ?? o.data
    if (inner !== undefined && inner !== cur) {
      cur = inner
    }
  }
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
    return cur as Record<string, unknown>
  }
  return {}
}

export function extractRegenFieldsFromN8nBody(obj: Record<string, unknown>): {
  image_base64: string
  file_path: string
  content_type: string
  photo_caption: string | null
  photo_credit: string | null
  image_prompt: string | null
} {
  const pick = (a: string, b?: string) => {
    const v = obj[a] ?? (b ? obj[b] : undefined)
    return typeof v === 'string' ? v.trim() : ''
  }
  const image_base64 = pick('image_base64', 'imageBase64')
  const file_path = pick('file_path', 'filePath')
  const contentTypeRaw = pick('content_type', 'contentType')
  const content_type = contentTypeRaw || 'image/png'
  return {
    image_base64,
    file_path,
    content_type,
    photo_caption: trimStr(obj.photo_caption ?? obj.photoCaption),
    photo_credit: trimStr(obj.photo_credit ?? obj.photoCredit),
    image_prompt: trimStr(obj.image_prompt ?? obj.imagePrompt),
  }
}

export async function persistRegenImageFromN8nResult(
  admin: SupabaseClient,
  params: {
    outputId?: string
    inputId?: string
    jobId: string
    image_base64: string
    file_path: string
    content_type: string
    photo_caption: string | null
    photo_credit: string | null
    image_prompt: string | null
  }
): Promise<{ error: string | null }> {
  const hasOut = !!params.outputId
  const hasIn = !!params.inputId
  if (hasOut === hasIn) {
    return { error: 'Internal: provide exactly one of outputId or inputId' }
  }

  const jobId = params.jobId.trim()
  const photoCaption = params.photo_caption
  const photoCredit = params.photo_credit
  const imagePrompt = params.image_prompt
  const contentType = params.content_type.split(';')[0].trim() || 'image/png'

  const base64Raw = params.image_base64.trim()
  const filePathIn = params.file_path.trim()

  if (base64Raw) {
    let buf: Buffer
    try {
      buf = Buffer.from(base64Raw.replace(/\s/g, ''), 'base64')
    } catch {
      return { error: 'Invalid image_base64 in workflow response' }
    }
    if (!buf.length) {
      return { error: 'Empty image data in workflow response' }
    }

    if (params.outputId) {
      const { data: outRow, error: outErr } = await admin
        .from('diffuse_project_outputs')
        .select('id, project_id, workflow_metadata')
        .eq('id', params.outputId)
        .single()

      if (outErr || !outRow) {
        return { error: 'Output not found' }
      }

      const wm = outRow.workflow_metadata as Record<string, unknown> | null | undefined
      if (jobId && typeof wm?.regen_image === 'object' && wm.regen_image && 'job_id' in (wm.regen_image as object)) {
        const jid = (wm.regen_image as { job_id?: string }).job_id
        if (jid && jid !== jobId) {
          return { error: 'job_id mismatch' }
        }
      }

      const { data: proj, error: pErr } = await admin
        .from('diffuse_projects')
        .select('created_by')
        .eq('id', outRow.project_id)
        .single()
      if (pErr || !proj?.created_by) {
        return { error: 'Project not found' }
      }

      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
      const safeJob = jobId || 'job'
      const storagePath = `${proj.created_by}/${outRow.project_id}/cover-${outRow.id}-regen-${safeJob}.${ext}`

      const { error: uploadError } = await admin.storage
        .from('project-files')
        .upload(storagePath, buf, { contentType, upsert: true })

      if (uploadError) {
        console.error('[regen-image-persist] upload failed:', uploadError.message)
        return { error: 'Storage upload failed' }
      }

      const pending: RegenImagePendingPayload = {
        cover_photo_path: storagePath,
        photo_caption: photoCaption,
        photo_credit: photoCredit,
        image_prompt: imagePrompt,
      }

      const { error: upErr } = await admin
        .from('diffuse_project_outputs')
        .update({
          workflow_metadata: mergeRegenImagePendingComplete(wm, pending, jobId || null),
          updated_at: new Date().toISOString(),
        })
        .eq('id', outRow.id)

      if (upErr) {
        console.error('[regen-image-persist] output update failed:', upErr)
        return { error: 'Failed to update output' }
      }
      return { error: null }
    }

    const { data: inputRow, error: inErr } = await admin
      .from('diffuse_project_inputs')
      .select('id, project_id, metadata')
      .eq('id', params.inputId!)
      .single()

    if (inErr || !inputRow) {
      return { error: 'Input not found' }
    }

    const meta = inputRow.metadata as Record<string, unknown> | null | undefined
    if (jobId && typeof meta?.regen_image === 'object' && meta.regen_image && 'job_id' in (meta.regen_image as object)) {
      const jid = (meta.regen_image as { job_id?: string }).job_id
      if (jid && jid !== jobId) {
        return { error: 'job_id mismatch' }
      }
    }

    const { data: projIn, error: pInErr } = await admin
      .from('diffuse_projects')
      .select('created_by')
      .eq('id', inputRow.project_id)
      .single()
    if (pInErr || !projIn?.created_by) {
      return { error: 'Project not found' }
    }

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const safeJob = jobId || 'job'
    const storagePath = `${projIn.created_by}/${inputRow.project_id}/cover-input-${inputRow.id}-regen-${safeJob}.${ext}`

    const { error: uploadError } = await admin.storage
      .from('project-files')
      .upload(storagePath, buf, { contentType, upsert: true })

    if (uploadError) {
      console.error('[regen-image-persist] input upload failed:', uploadError.message)
      return { error: 'Storage upload failed' }
    }

    const pending: RegenImagePendingPayload = {
      cover_photo_path: storagePath,
      photo_caption: photoCaption,
      photo_credit: photoCredit,
      image_prompt: imagePrompt,
    }

    const { error: inUp } = await admin
      .from('diffuse_project_inputs')
      .update({
        metadata: mergeRegenImagePendingComplete(meta, pending, jobId || null),
      })
      .eq('id', inputRow.id)

    if (inUp) {
      console.error('[regen-image-persist] input metadata update failed:', inUp)
      return { error: 'Failed to update input' }
    }
    return { error: null }
  }

  if (!filePathIn) {
    return { error: 'Workflow must return image_base64 or file_path in the JSON response' }
  }

  const pendingLegacy: RegenImagePendingPayload = {
    cover_photo_path: filePathIn,
    photo_caption: photoCaption,
    photo_credit: photoCredit,
    image_prompt: imagePrompt,
  }

  if (params.outputId) {
    const { data: row, error: fetchErr } = await admin
      .from('diffuse_project_outputs')
      .select('id, workflow_metadata')
      .eq('id', params.outputId)
      .single()

    if (fetchErr || !row) {
      return { error: 'Output not found' }
    }

    const wm = row.workflow_metadata as Record<string, unknown> | null | undefined
    if (jobId && typeof wm?.regen_image === 'object' && wm.regen_image && 'job_id' in (wm.regen_image as object)) {
      const jid = (wm.regen_image as { job_id?: string }).job_id
      if (jid && jid !== jobId) {
        return { error: 'job_id mismatch' }
      }
    }

    const { error: upErr } = await admin
      .from('diffuse_project_outputs')
      .update({
        workflow_metadata: mergeRegenImagePendingComplete(wm, pendingLegacy, jobId || null),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)

    if (upErr) {
      console.error('[regen-image-persist] output update failed:', upErr)
      return { error: 'Failed to update output' }
    }
    return { error: null }
  }

  const { data: inputRow, error: inErr } = await admin
    .from('diffuse_project_inputs')
    .select('id, project_id, metadata')
    .eq('id', params.inputId!)
    .single()

  if (inErr || !inputRow) {
    return { error: 'Input not found' }
  }

  const meta = inputRow.metadata as Record<string, unknown> | null | undefined
  if (jobId && typeof meta?.regen_image === 'object' && meta.regen_image && 'job_id' in (meta.regen_image as object)) {
    const jid = (meta.regen_image as { job_id?: string }).job_id
    if (jid && jid !== jobId) {
      return { error: 'job_id mismatch' }
    }
  }

  const { error: inUp } = await admin
    .from('diffuse_project_inputs')
    .update({
      metadata: mergeRegenImagePendingComplete(meta, pendingLegacy, jobId || null),
    })
    .eq('id', inputRow.id)

  if (inUp) {
    console.error('[regen-image-persist] input update failed:', inUp)
    return { error: 'Failed to update input' }
  }
  return { error: null }
}
