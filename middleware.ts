import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // Update session and get user in one go (uses same client/cookie context)
  const { response, user } = await updateSession(request)

  // Check if the user is accessing a protected route
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!user) {
      // Redirect to login if not authenticated
      const redirectUrl = new URL('/login', request.url)
      return NextResponse.redirect(redirectUrl)
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Skip all Next internals (including dev HMR / any _next/* path), static assets, favicon.
     * Running Supabase session refresh on _next/* can break dev chunk serving and adds latency.
     * Also skip the public, unauthenticated agent-readable routes (the MCP transport endpoints
     * under /api/mcp|sse|message and /llms.txt) so we don't run a Supabase round-trip on them.
     *
     * The authenticated agent MCP transport (/api/agent/mcp|sse|message) authenticates via a
     * Bearer PAT, not a cookie, so skip session refresh there too — but NOT /api/agent/tokens,
     * which is cookie-authed and needs the session. Also skip /.well-known/* (public metadata).
     */
    '/((?!_next/|favicon.ico|llms\\.txt|\\.well-known/|api/(?:mcp|sse|message)|api/agent/(?:mcp|sse|message)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

