/**
 * Personal Access Token management (cookie-authed). Backs the Settings UI.
 *
 * POST  — mint a token (plaintext returned exactly once)
 * GET   — list the caller's tokens (prefix + metadata, never the secret)
 *
 * Anti-escalation: these routes require an interactive Supabase cookie session and
 * AFFIRMATIVELY REJECT any inbound Authorization header, so a leaked PAT can never be
 * used to mint or enumerate tokens. PAT verification lives only in the MCP transport.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'
import { generateToken, hashToken, tokenPrefix } from '@/lib/auth/pat'
import { sanitizeString } from '@/lib/security/validation'

export const runtime = 'nodejs'

/** Reject any request carrying an Authorization header (must be cookie-session only). */
function rejectBearer(request: NextRequest): NextResponse | null {
  if (request.headers.get('authorization')) {
    return NextResponse.json(
      { error: 'Token management requires an interactive login, not a Bearer token.' },
      { status: 401 }
    )
  }
  return null
}

export async function POST(request: NextRequest) {
  const blocked = rejectBearer(request)
  if (blocked) return blocked

  let auth
  try {
    auth = await requireAuth()
  } catch {
    return unauthorizedResponse()
  }
  const { user, supabase } = auth

  let body: { name?: unknown; expires_in_days?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    /* empty body is fine */
  }

  const name = body.name != null ? sanitizeString(body.name, 100) || 'Agent token' : 'Agent token'
  let expiresAt: string | null = null
  if (body.expires_in_days != null) {
    const days = Number(body.expires_in_days)
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: 'expires_in_days must be an integer between 1 and 365' }, { status: 400 })
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  }

  const token = generateToken()
  const { data, error } = await supabase
    .from('diffuse_agent_tokens')
    .insert({
      created_by: user.id, // RLS WITH CHECK (created_by = auth.uid()) also enforces this
      name,
      token_hash: hashToken(token),
      prefix: tokenPrefix(token),
      expires_at: expiresAt,
    })
    .select('id, name, prefix, scopes, expires_at, created_at')
    .single()

  if (error || !data) {
    console.error('[agent/tokens] mint failed:', error?.message)
    return NextResponse.json({ error: 'Could not create token' }, { status: 500 })
  }

  // Plaintext returned exactly once — never stored, never retrievable again.
  return NextResponse.json({ ...data, token }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const blocked = rejectBearer(request)
  if (blocked) return blocked

  let auth
  try {
    auth = await requireAuth()
  } catch {
    return unauthorizedResponse()
  }
  const { user, supabase } = auth

  const { data, error } = await supabase
    .from('diffuse_agent_tokens')
    .select('id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[agent/tokens] list failed:', error.message)
    return NextResponse.json({ error: 'Could not list tokens' }, { status: 500 })
  }
  return NextResponse.json({ tokens: data ?? [] })
}
