import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { stripRegenImage, type RegenImagePendingPayload } from '@/lib/regen-image-context'
import { createAdminClient } from '@/lib/supabase/server'

type Approvals = {
  cover_image?: boolean
  photo_caption?: boolean
  photo_credit?: boolean
}

/** Match workflow route: array may be one element `[{ article, generated_image_url? }]`, not only `[a, { article }]`. */
function mergeArticlePhotoFields(
  content: string | null | undefined,
  caption: string | null,
  credit: string | null
): string {
  const raw = (content ?? '').trim()
  if (!raw) {
    return JSON.stringify({
      title: '',
      author: 'Diffuse.AI',
      excerpt: '',
      content: '',
      photo_caption: caption,
      photo_credit: credit,
    })
  }
  try {
    let parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed as string)
    if (Array.isArray(parsed)) {
      const idx = parsed.findIndex(
        (x) =>
          x &&
          typeof x === 'object' &&
          (x as Record<string, unknown>).article &&
          typeof (x as Record<string, unknown>).article === 'object'
      )
      if (idx >= 0) {
        const next = [...parsed]
        const holder = { ...(next[idx] as Record<string, unknown>) }
        const art = { ...((holder.article as Record<string, unknown>) ?? {}) }
        art.photo_caption = caption
        art.photo_credit = credit
        holder.article = art
        next[idx] = holder
        return JSON.stringify(next)
      }
      if (parsed.length >= 2 && parsed[1] && typeof parsed[1] === 'object') {
        const second = parsed[1] as Record<string, unknown>
        if (second.article && typeof second.article === 'object') {
          const nextArticle = {
            ...(second.article as Record<string, unknown>),
            photo_caption: caption,
            photo_credit: credit,
          }
          return JSON.stringify([parsed[0], { ...second, article: nextArticle }])
        }
        const nextSecond = { ...second, photo_caption: caption, photo_credit: credit }
        return JSON.stringify([parsed[0], nextSecond])
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({ ...(parsed as Record<string, unknown>), photo_caption: caption, photo_credit: credit })
    }
  } catch {
    /* fall through */
  }
  return raw
}

/** POST — commit pending regen (per-field approvals). Default for each approval is true (accept proposed). */
export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await requireAuth()
    } catch {
      return unauthorizedResponse()
    }
    const { user, supabase } = authResult

    let body: { output_id?: string; input_id?: string; approvals?: Approvals }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    if (!!body.output_id === !!body.input_id) {
      return NextResponse.json({ error: 'Provide exactly one of output_id or input_id' }, { status: 400 })
    }

    const approvals: Approvals = body.approvals ?? {}
    const approveCover = approvals.cover_image !== false
    const approveCaption = approvals.photo_caption !== false
    const approveCredit = approvals.photo_credit !== false

    const admin = createAdminClient() ?? supabase

    if (body.output_id) {
      const { data: row, error } = await supabase
        .from('diffuse_project_outputs')
        .select('id, project_id, content, workflow_metadata, cover_photo_path, reedit_count')
        .eq('id', body.output_id)
        .single()

      if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      try {
        await requireProjectOwnership(row.project_id, user.id, supabase)
      } catch (e: unknown) {
        return forbiddenResponse(e instanceof Error ? e.message : 'Forbidden')
      }

      const wm = row.workflow_metadata as Record<string, unknown> | null | undefined
      const regen = wm?.regen_image as { status?: string; pending?: RegenImagePendingPayload } | undefined
      if (!regen?.pending || regen.status !== 'complete') {
        return NextResponse.json({ error: 'No pending regeneration to apply' }, { status: 400 })
      }

      const pending = regen.pending
      // Extract previous caption/credit from current content
      let prevCap: string | null = null
      let prevCred: string | null = null
      try {
        const c = typeof row.content === 'string' ? row.content : ''
        let p: unknown = JSON.parse(c.trim() || '{}')
        if (typeof p === 'string') p = JSON.parse(p)
        if (Array.isArray(p)) {
          const item = p.find(
            (x) =>
              x &&
              typeof x === 'object' &&
              (x as Record<string, unknown>).article &&
              typeof (x as Record<string, unknown>).article === 'object'
          ) as Record<string, unknown> | undefined
          const art =
            item?.article && typeof item.article === 'object'
              ? (item.article as Record<string, unknown>)
              : p[1] && typeof p[1] === 'object'
                ? ((p[1] as { article?: Record<string, unknown> }).article ?? (p[1] as Record<string, unknown>))
                : null
          if (art) {
            prevCap = typeof art.photo_caption === 'string' ? art.photo_caption : null
            prevCred = typeof art.photo_credit === 'string' ? art.photo_credit : null
          }
        } else if (p && typeof p === 'object' && !Array.isArray(p)) {
          const o = p as Record<string, unknown>
          prevCap = typeof o.photo_caption === 'string' ? o.photo_caption : null
          prevCred = typeof o.photo_credit === 'string' ? o.photo_credit : null
        }
      } catch {
        /* ignore */
      }

      const finalCaption = approveCaption ? pending.photo_caption : prevCap
      const finalCredit = approveCredit ? pending.photo_credit : prevCred
      const newContent = mergeArticlePhotoFields(row.content, finalCaption, finalCredit)

      let nextCoverPath = typeof row.cover_photo_path === 'string' ? row.cover_photo_path : null
      if (approveCover) {
        nextCoverPath = pending.cover_photo_path
      } else if (pending.cover_photo_path) {
        await admin.storage.from('project-files').remove([pending.cover_photo_path])
      }

      let nextWm: Record<string, unknown> = { ...(wm ?? {}) }
      nextWm = stripRegenImage(nextWm)
      if (approveCover && pending.image_prompt) {
        nextWm.image_prompt = pending.image_prompt
      }

      const reeditIncrement = approveCover ? 1 : 0
      const { data: updated, error: upErr } = await supabase
        .from('diffuse_project_outputs')
        .update({
          content: newContent,
          cover_photo_path: nextCoverPath,
          workflow_metadata: nextWm,
          reedit_count: (row.reedit_count ?? 0) + reeditIncrement,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .select()
        .single()

      if (upErr) {
        console.error('[regen-image/apply] output update failed:', upErr)
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
      }

      return NextResponse.json({ success: true, output: updated })
    }

    // input_id (cover photo input)
    const { data: inputRow, error: inErr } = await supabase
      .from('diffuse_project_inputs')
      .select('id, project_id, metadata, file_path, file_name')
      .eq('id', body.input_id!)
      .single()

    if (inErr || !inputRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    try {
      await requireProjectOwnership(inputRow.project_id, user.id, supabase)
    } catch (e: unknown) {
      return forbiddenResponse(e instanceof Error ? e.message : 'Forbidden')
    }

    const meta = inputRow.metadata as Record<string, unknown> | null | undefined
    const regen = meta?.regen_image as { status?: string; pending?: RegenImagePendingPayload } | undefined
    if (!regen?.pending || regen.status !== 'complete') {
      return NextResponse.json({ error: 'No pending regeneration to apply' }, { status: 400 })
    }

    const pending = regen.pending
    const prevCap = typeof meta?.photo_caption === 'string' ? (meta.photo_caption as string) : null
    const prevCred = typeof meta?.photo_credit === 'string' ? (meta.photo_credit as string) : null

    const finalCaption = approveCaption ? pending.photo_caption : prevCap
    const finalCredit = approveCredit ? pending.photo_credit : prevCred

    let nextPath = typeof inputRow.file_path === 'string' ? inputRow.file_path : null
    if (approveCover) {
      nextPath = pending.cover_photo_path
    } else if (pending.cover_photo_path) {
      await admin.storage.from('project-files').remove([pending.cover_photo_path])
    }

    const { data: signedData } =
      nextPath != null && nextPath.length > 0
        ? await admin.storage.from('project-files').createSignedUrl(nextPath, 60 * 60 * 24 * 365)
        : { data: null as { signedUrl: string } | null }

    let nextMeta: Record<string, unknown> = { ...(meta ?? {}) }
    nextMeta = stripRegenImage(nextMeta)
    if (finalCaption !== null) nextMeta.photo_caption = finalCaption
    else delete nextMeta.photo_caption
    if (finalCredit !== null) nextMeta.photo_credit = finalCredit
    else delete nextMeta.photo_credit
    if (approveCover && pending.image_prompt) {
      nextMeta.image_prompt = pending.image_prompt
    }
    nextMeta.source = 'upload'
    if (signedData?.signedUrl) nextMeta.storage_url = signedData.signedUrl

    const { data: updatedIn, error: upIn } = await supabase
      .from('diffuse_project_inputs')
      .update({
        file_path: nextPath ?? inputRow.file_path,
        file_name: approveCover ? `regenerated-cover.png` : inputRow.file_name,
        metadata: nextMeta,
      })
      .eq('id', inputRow.id)
      .select()
      .single()

    if (upIn) {
      console.error('[regen-image/apply] input update failed:', upIn)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    if (approveCover && nextPath) {
      await supabase
        .from('diffuse_project_outputs')
        .update({ cover_photo_path: nextPath, updated_at: new Date().toISOString() })
        .eq('project_id', inputRow.project_id)
        .is('deleted_at', null)
    }

    return NextResponse.json({ success: true, input: updatedIn })
  } catch (e: unknown) {
    console.error('[regen-image/apply]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
