import { createClient } from '@/lib/supabase/server'
import { getRedirectBaseUrl } from '@/lib/site-url'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { NextRequest } from 'next/server'
import type { UserRole } from '@/types/database'

function getSafeRedirectUrl(request: NextRequest, path: string): string {
  const base = getRedirectBaseUrl(request)
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function normalizeInviteRole(input: unknown): UserRole {
  if (typeof input !== 'string') return 'viewer'
  const role = input.toLowerCase()
  if (role === 'admin' || role === 'editor' || role === 'viewer') return role
  return 'viewer'
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await checkRateLimit(request, 'public')
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const inviteCodeRaw = requestUrl.searchParams.get('invite_code')
  const inviteRoleRaw = requestUrl.searchParams.get('role')
  const inviteCode = inviteCodeRaw ? inviteCodeRaw.trim().toUpperCase() : null
  const inviteRole = normalizeInviteRole(inviteRoleRaw)
  
  // Validate code parameter (should be a valid auth code)
  if (code && code.length > 1000) {
    // Auth codes shouldn't be this long - potential attack
    return NextResponse.redirect(getSafeRedirectUrl(request, '/login?error=auth_callback_error'), { status: 302 })
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // If this sign-in was triggered by an invite email, auto-join the workspace.
      if (inviteCode && /^[A-Z0-9]{4,32}$/.test(inviteCode)) {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (!authError && authData?.user) {
          const { data: workspace, error: workspaceError } = await supabase
            .from('diffuse_workspaces')
            .select('id')
            .eq('invite_code', inviteCode)
            .maybeSingle()

          if (!workspaceError && workspace?.id) {
            const { error: insertError } = await supabase
              .from('diffuse_workspace_members')
              .insert({
                workspace_id: workspace.id,
                user_id: authData.user.id,
                role: inviteRole,
              })

            // If the user is already a member, ignore the duplicate constraint error.
            if (insertError && insertError.code !== '23505') {
              return NextResponse.redirect(getSafeRedirectUrl(request, '/login?error=invite_join_failed'), { status: 302 })
            }

            return NextResponse.redirect(
              getSafeRedirectUrl(request, `/dashboard/organization/${workspace.id}`),
              { status: 302 }
            )
          }

          return NextResponse.redirect(getSafeRedirectUrl(request, '/login?error=invite_invalid'), { status: 302 })
        }
      }

      // Default: Safe redirect to dashboard
      return NextResponse.redirect(getSafeRedirectUrl(request, '/dashboard'), { status: 302 })
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(getSafeRedirectUrl(request, '/login?error=auth_callback_error'), { status: 302 })
}

