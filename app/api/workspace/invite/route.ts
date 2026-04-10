import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { forbiddenResponse, requireAuth, unauthorizedResponse, verifyWorkspaceAccess } from '@/lib/security/authorization'
import { sanitizeString, validateUUID } from '@/lib/security/validation'
import { createAdminClient } from '@/lib/supabase/server'
import { getRedirectBaseUrl } from '@/lib/site-url'
import type { UserRole } from '@/types/database'

const EMAIL_MAX_LENGTH = 254
const MAX_EMAILS = 25
const ALLOWED_ROLES: UserRole[] = ['viewer', 'editor', 'admin']

function normalizeEmails(input: unknown): { emails: string[]; invalid: string[] } {
  if (typeof input !== 'string' && !Array.isArray(input)) {
    return { emails: [], invalid: ['Invalid emails payload'] }
  }

  const rawList: string[] = Array.isArray(input)
    ? input.map((v) => (typeof v === 'string' ? v : String(v)))
    : [input]

  // Allow comma/semicolon/newline separation in a single string too.
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

function normalizeRole(input: unknown): UserRole {
  if (typeof input !== 'string') return 'viewer'
  const role = input.toLowerCase()
  if (ALLOWED_ROLES.includes(role as UserRole)) return role as UserRole
  return 'viewer'
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await checkRateLimit(request, 'authenticated')
    if (rateLimitResponse) return rateLimitResponse

    const authResult = await requireAuth().catch(() => null)
    if (!authResult) return unauthorizedResponse()
    const { user, supabase } = authResult

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body. Expected JSON.' }, { status: 400 })
    }

    const workspaceIdRaw = (body as any)?.workspaceId
    if (typeof workspaceIdRaw !== 'string') {
      return NextResponse.json({ error: 'workspaceId must be a string' }, { status: 400 })
    }

    let workspaceId: string
    try {
      workspaceId = validateUUID(workspaceIdRaw)
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Invalid workspaceId' }, { status: 400 })
    }

    const role = normalizeRole((body as any)?.role)
    const { emails, invalid } = normalizeEmails((body as any)?.emails)

    if (invalid.length > 0 && emails.length === 0) {
      return NextResponse.json(
        { error: 'Invalid email address(es)', invalidEmails: invalid },
        { status: 400 }
      )
    }
    if (emails.length === 0) {
      return NextResponse.json({ error: 'No valid emails provided' }, { status: 400 })
    }

    // Anyone who is already a workspace member can invite users.
    // (Owner is determined by diffuse_workspaces.owner_id, so we explicitly include it too.)

    const { data: workspace, error: workspaceError } = await supabase
      .from('diffuse_workspaces')
      .select('invite_code, owner_id')
      .eq('id', workspaceId)
      .maybeSingle()

    if (workspaceError || !workspace?.invite_code) {
      return NextResponse.json({ error: 'Invalid workspace' }, { status: 404 })
    }

    const isOwner = workspace.owner_id === user.id
    const isMember = await verifyWorkspaceAccess(workspaceId, user.id, supabase)
    if (!isOwner && !isMember) return forbiddenResponse('You must be a workspace member to invite users.')

    const admin = createAdminClient()
    if (!admin) {
      return NextResponse.json(
        { error: 'Server misconfigured', message: 'SUPABASE_SERVICE_ROLE_KEY is required for invitations.' },
        { status: 500 }
      )
    }

    const siteUrl = getRedirectBaseUrl(request)
    const redirectTo = `${siteUrl}/api/auth/callback?invite_code=${encodeURIComponent(workspace.invite_code)}&role=${encodeURIComponent(role)}`

    const invited: string[] = []
    const failures: Array<{ email: string; message: string }> = []

    // Loop sequentially to keep load predictable.
    for (const email of emails) {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          workspace_id: workspaceId,
          role,
          invited_by: user.id,
        },
      })

      if (error) {
        failures.push({ email, message: error.message || 'Invite failed' })
      } else {
        invited.push(email)
      }
    }

    if (invited.length === 0) {
      return NextResponse.json(
        { error: 'Failed to send invitations', failures },
        { status: 400 }
      )
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

