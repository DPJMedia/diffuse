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
     */
    '/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

