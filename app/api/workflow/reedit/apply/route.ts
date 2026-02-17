import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import type { DiffuseProjectOutput } from '@/types/database'

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

    let body: { output_id?: string; content?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body. Expected JSON.' }, { status: 400 })
    }

    const output_id = body.output_id
    const content = body.content

    if (typeof output_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(output_id)) {
      return NextResponse.json({ error: 'Invalid output_id' }, { status: 400 })
    }
    if (typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
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

    // Save current content to revisions before overwriting (marks the pre-apply state)
    await supabase.from('diffuse_project_output_revisions').insert({
      output_id,
      content: output.content,
      revision_type: 'previous',
    })

    const reeditCount = (output.reedit_count ?? 0) + 1
    const { data: updatedOutput, error: updateError } = await supabase
      .from('diffuse_project_outputs')
      .update({
        content: content.trim(),
        updated_at: new Date().toISOString(),
        reedit_count: reeditCount,
      })
      .eq('id', output_id)
      .select()
      .single()

    if (updateError) {
      console.error('[reedit/apply] DB update failed:', updateError)
      return NextResponse.json({ error: 'Failed to apply changes' }, { status: 500 })
    }

    const response = NextResponse.json({
      success: true,
      output: updatedOutput as DiffuseProjectOutput,
      message: 'Changes applied successfully',
    })
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v))
    return response
  } catch (error: any) {
    console.error('[reedit/apply] Error:', error)
    if (error.message?.includes('Unauthorized') || error.message?.includes('Forbidden')) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes('Unauthorized') ? 401 : 403 }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
