import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { stripRegenImage, type RegenImagePendingPayload } from '@/lib/regen-image-context'
import { createAdminClient } from '@/lib/supabase/server'

/** POST — discard pending regeneration (deletes staged file, clears metadata). */
export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await requireAuth()
    } catch {
      return unauthorizedResponse()
    }
    const { user, supabase } = authResult

    let body: { output_id?: string; input_id?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    if (!!body.output_id === !!body.input_id) {
      return NextResponse.json({ error: 'Provide exactly one of output_id or input_id' }, { status: 400 })
    }

    const admin = createAdminClient() ?? supabase

    if (body.output_id) {
      const { data: row, error } = await supabase
        .from('diffuse_project_outputs')
        .select('id, project_id, workflow_metadata')
        .eq('id', body.output_id)
        .single()

      if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      try {
        await requireProjectOwnership(row.project_id, user.id, supabase)
      } catch (e: unknown) {
        return forbiddenResponse(e instanceof Error ? e.message : 'Forbidden')
      }

      const wm = row.workflow_metadata as Record<string, unknown> | null | undefined
      const pending = (wm?.regen_image as { pending?: RegenImagePendingPayload } | undefined)?.pending
      if (pending?.cover_photo_path) {
        await admin.storage.from('project-files').remove([pending.cover_photo_path])
      }

      const { error: upErr } = await supabase
        .from('diffuse_project_outputs')
        .update({
          workflow_metadata: stripRegenImage(wm),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      if (upErr) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    const { data: inputRow, error: inErr } = await supabase
      .from('diffuse_project_inputs')
      .select('id, project_id, metadata')
      .eq('id', body.input_id!)
      .single()

    if (inErr || !inputRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    try {
      await requireProjectOwnership(inputRow.project_id, user.id, supabase)
    } catch (e: unknown) {
      return forbiddenResponse(e instanceof Error ? e.message : 'Forbidden')
    }

    const meta = inputRow.metadata as Record<string, unknown> | null | undefined
    const pending = (meta?.regen_image as { pending?: RegenImagePendingPayload } | undefined)?.pending
    if (pending?.cover_photo_path) {
      await admin.storage.from('project-files').remove([pending.cover_photo_path])
    }

    const { error: upErr } = await supabase
      .from('diffuse_project_inputs')
      .update({ metadata: stripRegenImage(meta) })
      .eq('id', inputRow.id)

    if (upErr) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error('[regen-image/reject]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
