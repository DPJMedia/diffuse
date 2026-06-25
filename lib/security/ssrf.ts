/**
 * SSRF protection for server-side fetches of caller-influenced URLs.
 *
 * Used by the web-scrape route and the workflow image-download path. An attacker
 * who can steer a URL we fetch (directly, via a redirect, or via what an upstream
 * workflow returns) must not be able to reach internal/cloud-metadata addresses.
 *
 * Strategy: require https, resolve the hostname to its real IP(s), reject any
 * private/loopback/link-local/reserved address (IPv4 + IPv6, incl. IPv4-mapped and
 * numeric-encoded forms, and 169.254.169.254 metadata), and re-validate on every
 * redirect hop (redirect: 'manual').
 */

import dns from 'node:dns/promises'
import net from 'node:net'

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

/** True when an IPv4 address string is in a private/loopback/link-local/reserved range. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // unparseable → treat as unsafe
  }
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false
}

/** True when an IPv6 address string is in a private/loopback/link-local/reserved range. */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // IPv4-mapped / -compatible (e.g. ::ffff:127.0.0.1) → judge by the embedded v4.
  const mapped = lower.match(/(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  if (lower === '::1' || lower === '::') return true // loopback / unspecified
  if (lower.startsWith('fe80') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true // fe80::/10 link-local
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 unique-local
  if (lower.startsWith('ff')) return true // ff00::/8 multicast
  if (lower.startsWith('64:ff9b')) return true // NAT64
  if (lower.startsWith('::ffff:')) return true // any other IPv4-mapped we didn't parse
  return false
}

function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) return isPrivateIPv4(ip)
  if (family === 6) return isPrivateIPv6(ip)
  return true // not a recognizable IP → unsafe
}

/**
 * Validate that a URL is safe to fetch server-side. Throws SsrfError otherwise.
 * Returns the parsed URL and the resolved public IP addresses.
 */
export async function assertSafePublicUrl(
  rawUrl: string,
  opts: { allowHttp?: boolean } = {}
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfError('Invalid URL')
  }

  const allowed = opts.allowHttp ? ['http:', 'https:'] : ['https:']
  if (!allowed.includes(url.protocol)) {
    throw new SsrfError(`URL must use ${allowed.map((p) => p.replace(':', '')).join(' or ')}`)
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets

  // Resolve to real addresses (handles DNS names AND numeric-encoded literals like 2130706433).
  let addresses: string[]
  if (net.isIP(hostname)) {
    addresses = [hostname]
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true })
      addresses = records.map((r) => r.address)
    } catch {
      throw new SsrfError('Could not resolve host')
    }
  }

  if (addresses.length === 0) throw new SsrfError('Host did not resolve')
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new SsrfError('URL resolves to a non-public address')
    }
  }

  return { url, addresses }
}

/**
 * Fetch that re-validates the target on every redirect hop. Use instead of a plain
 * fetch with redirect:'follow' for any caller-influenced URL.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { allowHttp?: boolean; maxRedirects?: number } = {}
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 4
  let current = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafePublicUrl(current, { allowHttp: opts.allowHttp })
    const res = await fetch(current, { ...init, redirect: 'manual' })
    // 3xx with a Location → validate the next hop ourselves.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      current = new URL(location, current).toString()
      continue
    }
    return res
  }
  throw new SsrfError('Too many redirects')
}
