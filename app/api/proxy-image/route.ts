import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'

/**
 * GET /api/proxy-image?url=<encoded-image-url>
 *
 * Fetches the image server-side and streams it to the client.
 * Use this for workflow-generated image URLs (e.g. Azure blob) so the browser
 * never loads them directly (avoids ERR_NAME_NOT_RESOLVED / CORS).
 * Only allows known image hostnames. Requires auth.
 */
const ALLOWED_HOSTS = [
  'oaidalleapiprodscus.blob.core.windows.net',
  'blob.core.windows.net',
  /\.blob\.core\.windows\.net$/,
  /\.supabase\.co$/,
  /\.amazonaws\.com$/,
]

function isAllowedUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    return ALLOWED_HOSTS.some((h) =>
      typeof h === 'string' ? host === h : h.test(host)
    )
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth().catch(() => null)
    if (!authResult) return unauthorizedResponse()

    const urlParam = request.nextUrl.searchParams.get('url')
    if (!urlParam) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }
    // Decode once (frontend sends encodeURIComponent(url))
    let url: string
    try {
      url = decodeURIComponent(urlParam)
    } catch {
      return NextResponse.json({ error: 'Invalid url encoding' }, { status: 400 })
    }
    if (!isAllowedUrl(url)) {
      return NextResponse.json({ error: 'URL not allowed' }, { status: 400 })
    }

    // Longer timeout for Azure/S3; User-Agent and Accept so upstream doesn't block
    const res = await fetch(url, {
      signal: AbortSignal.timeout(25000),
      headers: {
        Accept: 'image/*',
        'User-Agent': 'DiffuseProxy/1.0 (image-fetch)',
      },
    })
    if (!res.ok) {
      const snippet = url.slice(0, 120) + (url.length > 120 ? '...' : '')
      console.error('[proxy-image] Upstream failed:', res.status, res.statusText, 'url:', snippet)
      return NextResponse.json(
        { error: 'Image fetch failed', status: res.status },
        { status: 502 }
      )
    }

    const contentType = res.headers.get('content-type') || 'image/png'
    const body = await res.arrayBuffer()

    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    console.error('[proxy-image] Error:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Failed to load image' },
      { status: 502 }
    )
  }
}
