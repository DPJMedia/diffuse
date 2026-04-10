import type { NextRequest } from 'next/server'

/** Default dev port when PORT / NEXT_PUBLIC_DEV_PORT are not set. */
const DEFAULT_DEV_PORT = '3000'

function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}

/** True when the configured site URL clearly points at this machine (not production). */
function isLocalhostSiteUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

/**
 * In development, a production `NEXT_PUBLIC_SITE_URL` in `.env.local` breaks OAuth/email redirects
 * for anyone running on localhost. Ignore it unless it's localhost-shaped or explicitly forced.
 */
function effectiveNextPublicSiteUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (!raw) return undefined

  const forceInDev =
    process.env.NEXT_PUBLIC_USE_SITE_URL_IN_DEV === '1' ||
    process.env.NEXT_PUBLIC_USE_SITE_URL_IN_DEV === 'true'

  if (isDevelopment() && !forceInDev && !isLocalhostSiteUrl(raw)) {
    return undefined
  }

  return raw
}

/** Public base URL for callbacks (no trailing slash). Used when no HTTP request is available. */
export function getPublicSiteUrl(): string {
  const fromEnv = effectiveNextPublicSiteUrl()
  if (fromEnv) {
    return fromEnv
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`
  }
  // Local dev: PORT when set; else optional NEXT_PUBLIC_DEV_PORT (when Next bumps 3000→3001, etc.)
  const port = process.env.PORT || process.env.NEXT_PUBLIC_DEV_PORT || DEFAULT_DEV_PORT
  return `http://localhost:${port}`
}

/**
 * OAuth / email redirect base URL from client code. Uses the current browser origin in dev
 * (correct port) when `NEXT_PUBLIC_SITE_URL` is unset.
 */
export function getSiteUrlForAuthClient(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return getPublicSiteUrl()
}

/**
 * Base URL for server-side redirects and invite links. Prefers `Host` / `X-Forwarded-*` so local
 * dev stays on the correct port (e.g. :3001) and proxies report the public origin correctly.
 * Falls back to `request.nextUrl.origin` if headers are missing.
 */
export function getRedirectBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host')?.split(',')[0]?.trim()

  if (host) {
    let proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    if (!proto) {
      const h = host.toLowerCase()
      proto = h.startsWith('localhost') || h.startsWith('127.') ? 'http' : 'https'
    }
    return `${proto}://${host}`
  }

  return request.nextUrl.origin
}
