import { createClient } from '@/lib/supabase/server'
import { getRedirectBaseUrl } from '@/lib/site-url'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await checkRateLimit(request, 'authenticated')
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const supabase = await createClient()
  await supabase.auth.signOut()
  
  const base = getRedirectBaseUrl(request)
  return NextResponse.redirect(`${base}/`, { status: 302 })
}

