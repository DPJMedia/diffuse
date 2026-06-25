/**
 * Personal Access Token (PAT) issuance and verification for the authenticated
 * agent MCP (`/api/agent/mcp`).
 *
 * Tokens look like `dfp_<base64url>` and are shown to the user exactly once.
 * We persist ONLY sha256(token) + a display prefix, never the plaintext.
 *
 * This module is the single allowed home for the service-role admin client on the
 * agent path: tool code under app/api/agent/** must never import createAdminClient
 * directly (enforced by ESLint). Token lookup and the durable usage counters must
 * bypass RLS (PAT requests carry no Supabase session), so they live here.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

export const PAT_PREFIX = 'dfp_'
export const AGENT_SCOPES = ['mcp:read', 'mcp:write'] as const
export type AgentScope = (typeof AGENT_SCOPES)[number]

/** Generate a new plaintext token. Returned to the caller once, then discarded. */
export function generateToken(): string {
  return PAT_PREFIX + randomBytes(32).toString('base64url')
}

/** sha256 hex of the plaintext token — what we store and look up by. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Display prefix stored alongside the hash so the UI can show which token is which. */
export function tokenPrefix(token: string): string {
  return token.slice(0, 12)
}

export interface AgentTokenRow {
  id: string
  created_by: string
  name: string
  scopes: string[] | null
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

/**
 * verifyToken implementation for mcp-handler's withMcpAuth. Resolves a Bearer PAT
 * to an AuthInfo carrying the owning user id. Fails CLOSED: any miss, error, or
 * expiry returns undefined (→ 401), never a partially-trusted result.
 */
export async function verifyPat(req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  // Claude.ai's connector UI can't send custom headers, so also accept ?token= in the URL.
  // The token is still hashed at rest and revocable; the tradeoff is it appears in server logs.
  let raw = bearerToken?.trim()
  if (!raw) {
    try {
      const url = new URL(req.url)
      const q = url.searchParams.get('token')
      if (q) raw = q.trim()
    } catch {
      // unparseable URL — fall through to undefined
    }
  }
  const token = raw
  if (!token || !token.startsWith(PAT_PREFIX) || token.length < PAT_PREFIX.length + 16) {
    return undefined
  }

  const admin = createAdminClient()
  if (!admin) {
    console.error('[pat] SUPABASE_SERVICE_ROLE_KEY not configured; cannot verify agent tokens')
    return undefined
  }

  const hash = hashToken(token)

  let row: AgentTokenRow | null = null
  try {
    const { data, error } = await admin
      .from('diffuse_agent_tokens')
      .select('id, created_by, name, scopes, last_used_at, expires_at, revoked_at')
      .eq('token_hash', hash)
      .maybeSingle()
    if (error) {
      console.error('[pat] token lookup failed:', error.message)
      return undefined // fail closed
    }
    row = (data as AgentTokenRow | null) ?? null
  } catch (e) {
    console.error('[pat] token lookup threw:', e instanceof Error ? e.message : e)
    return undefined // fail closed
  }

  if (!row) return undefined
  if (row.revoked_at) return undefined
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return undefined

  // Best-effort, throttled last_used_at update (never affects the auth decision).
  const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0
  if (Date.now() - lastUsed > 5 * 60 * 1000) {
    admin
      .from('diffuse_agent_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id)
      .then(undefined, (e: unknown) =>
        console.warn('[pat] last_used_at update failed:', e instanceof Error ? e.message : e)
      )
  }

  const scopes = Array.isArray(row.scopes) && row.scopes.length > 0 ? row.scopes : ['mcp:read']
  return {
    token: '[redacted]',
    clientId: row.id,
    scopes,
    expiresAt: row.expires_at ? Math.floor(Date.parse(row.expires_at) / 1000) : undefined,
    extra: { userId: row.created_by, tokenId: row.id },
  }
}

/**
 * Constant-time string compare helper (used for callback nonces elsewhere).
 * Exposed here so secret comparisons share one implementation.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
