import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { stripRegenImage } from '@/lib/regen-image-context'

/** Clear regen_image metadata after the client has finished the reveal animation. */
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

    if (body.output_id) {
      const { data: row, error } = await supabase
        .from('diffuse_project_outputs')
        .select('project_id, workflow_metadata')
        .eq('id', body.output_id)
        .single()
      if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      try {
        await requireProjectOwnership(row.project_id, user.id, supabase)
      } catch (e: unknown) {
        return forbiddenResponse(e instanceof Error ? e.message : 'Forbidden')
      }
      const { error: up } = await supabase
        .from('diffuse_project_outputs')
        .update({ workflow_metadata: stripRegenImage(row.workflow_metadata as Record<string, unknown> | undefined) })
        .eq('id', body.output_id)
      if (up) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    const { data: row, error } = await supabase
      .from('diffuse_project_inputs')
      .select('project_id, metadata')
      .eq('id', body.input_id!)
      .single()
    if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    try {
      await requireProjectOwnership(row.project_id, user.id, supabase)
    } catch (e: unknown) {
      return forbiddenResponse(e instanceof Error ? e.message : 'Forbidden')
    }
    const { error: up } = await supabase
      .from('diffuse_project_inputs')
      .update({ metadata: stripRegenImage(row.metadata as Record<string, unknown> | undefined) })
      .eq('id', body.input_id!)
    if (up) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error('[regen-image/ack]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
