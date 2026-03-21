import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import { sanitizeString } from '@/lib/security/validation'

const EMAIL_MAX_LENGTH = 254
const MAX_EMAILS = 25

function normalizeEmails(input: unknown): { emails: string[]; invalid: string[] } {
  if (typeof input !== 'string' && !Array.isArray(input)) {
    return { emails: [], invalid: ['Invalid emails payload'] }
  }

  const rawList: string[] = Array.isArray(input) ? input.map((v) => (typeof v === 'string' ? v : String(v))) : [input]

  const flattened = rawList
    .flatMap((chunk) => chunk.split(/[,;\n]+/g))
    .flatMap((chunk) => chunk.split(/\s+/g))
    .map((s) => s.trim())
    .filter(Boolean)

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i

  const unique = Array.from(new Set(flattened.map((e) => e.toLowerCase())))
  const valid: string[] = []
  const invalid: string[] = []

  for (const email of unique) {
    try {
      const sanitized = sanitizeString(email, EMAIL_MAX_LENGTH)
      if (!sanitized || sanitized.length > EMAIL_MAX_LENGTH) {
        invalid.push(email)
        continue
      }
      if (!emailRegex.test(sanitized)) {
        invalid.push(email)
        continue
      }
      valid.push(sanitized)
    } catch {
      invalid.push(email)
    }
  }

  return { emails: valid.slice(0, MAX_EMAILS), invalid: invalid.slice(0, MAX_EMAILS) }
}

function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  return process.env.NODE_ENV === 'production' ? 'https://www.diffuse.press' : 'http://localhost:3000'
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await checkRateLimit(request, 'authenticated')
    if (rateLimitResponse) return rateLimitResponse

    const authResult = await requireAuth().catch(() => null)
    if (!authResult) return unauthorizedResponse()
    const { user } = authResult

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body. Expected JSON.' }, { status: 400 })
    }

    const { emails, invalid } = normalizeEmails((body as any)?.emails)

    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'No valid emails provided', invalidEmails: invalid },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    if (!admin) {
      return NextResponse.json(
        { error: 'Server misconfigured', message: 'SUPABASE_SERVICE_ROLE_KEY is required for invitations.' },
        { status: 500 }
      )
    }

    const siteUrl = getSiteUrl()
    const redirectTo = `${siteUrl}/api/auth/callback`

    const invited: string[] = []
    const failures: Array<{ email: string; message: string }> = []

    for (const email of emails) {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          invited_by: user.id,
          invite_scope: 'platform',
        },
      })

      if (error) {
        failures.push({ email, message: error.message || 'Invite failed' })
      } else {
        invited.push(email)
      }
    }

    if (invited.length === 0) {
      return NextResponse.json({ error: 'Failed to send invitations', failures }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      invited: invited.length,
      invitedEmails: invited,
      invalidEmails: invalid,
      failures,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to invite users', message: err?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

