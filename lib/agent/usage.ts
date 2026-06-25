/**
 * Durable, per-user usage counters backed by Postgres (diffuse_agent_usage +
 * agent_usage_check_and_increment RPC).
 *
 * The legacy in-memory limiter (lib/security/rate-limit.ts) keys off the Supabase
 * cookie session, which PAT requests do not carry, so it degrades to a spoofable
 * shared-IP bucket. The agent path must NOT rely on it. These counters key strictly
 * on the authenticated userId and survive cold starts / multiple instances.
 *
 * Fail CLOSED: if the RPC errors, we deny the action.
 */

import { createAdminClient } from '@/lib/supabase/server'

function hourWindowStart(now = Date.now()): string {
  const ms = 60 * 60 * 1000
  return new Date(Math.floor(now / ms) * ms).toISOString()
}

function monthWindowStart(now = Date.now()): string {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

async function consume(
  userId: string,
  action: string,
  windowStart: string,
  limit: number,
  increment: number
): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) {
    console.error('[agent/usage] service role not configured; denying (fail closed)')
    return false
  }
  try {
    const { data, error } = await admin.rpc('agent_usage_check_and_increment', {
      p_user_id: userId,
      p_action: action,
      p_window_start: windowStart,
      p_limit: limit,
      p_increment: increment,
    })
    if (error) {
      console.error('[agent/usage] rpc error (fail closed):', error.message)
      return false
    }
    return data === true
  } catch (e) {
    console.error('[agent/usage] rpc threw (fail closed):', e instanceof Error ? e.message : e)
    return false
  }
}

/** Per-user hourly cap for a write action. Returns true if allowed (and counted). */
export function rateLimitHourly(userId: string, action: string, limit: number): Promise<boolean> {
  return consume(userId, action, hourWindowStart(), limit, 1)
}

/** Read the current month's counter for an action (0 if none). Best-effort (0 on error). */
export async function getMonthlyUnits(userId: string, action: string): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { data, error } = await admin
    .from('diffuse_agent_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('action', action)
    .eq('window_start', monthWindowStart())
    .maybeSingle()
  if (error || !data) return 0
  return typeof data.count === 'number' ? data.count : 0
}

/**
 * Per-user monthly units cap (e.g. Contractor Pro's 50 articles/month). `units` is the
 * effective number of generated articles, so number_of_outputs cannot multiply spend.
 */
export function consumeMonthlyUnits(
  userId: string,
  action: string,
  limit: number,
  units: number
): Promise<boolean> {
  return consume(userId, action, monthWindowStart(), limit, Math.max(1, units))
}
