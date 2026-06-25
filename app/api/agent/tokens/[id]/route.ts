/**
 * Revoke a Personal Access Token (cookie-authed). Sets revoked_at; the token then
 * fails verification immediately. RLS scopes the update to the caller's own tokens.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'
import { validateUUID } from '@/lib/security/validation'

export const runtime = 'nodejs'

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  // Anti-escalation: interactive cookie session only.
  if (request.headers.get('authorization')) {
    return NextResponse.json(
      { error: 'Token management requires an interactive login, not a Bearer token.' },
      { status: 401 }
    )
  }

  let id: string
  try {
    id = validateUUID(params.id)
  } catch {
    return NextResponse.json({ error: 'Invalid token id' }, { status: 400 })
  }

  let auth
  try {
    auth = await requireAuth()
  } catch {
    return unauthorizedResponse()
  }
  const { user, supabase } = auth

  const { error } = await supabase
    .from('diffuse_agent_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('created_by', user.id) // RLS also enforces this

  if (error) {
    console.error('[agent/tokens] revoke failed:', error.message)
    return NextResponse.json({ error: 'Could not revoke token' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
