import * as cheerio from 'cheerio'

export const MAX_PULL_BYTES = 500 * 1024 * 1024
/** Long municipal streams (e.g. Swagit) often need several minutes for yt-dlp + ffmpeg. */
export const PULL_FETCH_TIMEOUT_MS = Number(process.env.PULL_TIMEOUT_MS) || 300_000

export const PULL_USER_AGENT =
  'Mozilla/5.0 (compatible; DiffuseAI/1.0; +https://diffuse.press)'

const MAX_REDIRECTS = 8

/**
 * Mitigate SSRF: block obvious private/special hostnames before server-side fetch.
 */
export function assertUrlSafeForServerFetch(url: URL): void {
  const host = url.hostname.toLowerCase()

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('This URL cannot be used')
    }
    return
  }

  if (host.endsWith('.local') || host.endsWith('.localhost')) {
    throw new Error('This URL cannot be used')
  }

  if (host === 'metadata.google.internal' || host.endsWith('.internal')) {
    throw new Error('This URL cannot be used')
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const m = host.match(ipv4)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 10) throw new Error('Private network URLs are not allowed')
    if (a === 172 && b >= 16 && b <= 31) throw new Error('Private network URLs are not allowed')
    if (a === 192 && b === 168) throw new Error('Private network URLs are not allowed')
    if (a === 169 && b === 254) throw new Error('Private network URLs are not allowed')
    if (a === 127) throw new Error('Private network URLs are not allowed')
    if (a === 0) throw new Error('Private network URLs are not allowed')
    if (a === 100 && b >= 64 && b <= 127) throw new Error('Private network URLs are not allowed')
  }
}

export async function fetchWithRedirectGuard(
  initialUrl: string,
  options: { signal?: AbortSignal; maxRedirects?: number } = {}
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  let current = new URL(initialUrl)
  assertUrlSafeForServerFetch(current)

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current.href, {
      method: 'GET',
      redirect: 'manual',
      signal: options.signal,
      headers: {
        'User-Agent': PULL_USER_AGENT,
        Accept: '*/*',
      },
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) {
        throw new Error('Redirect without location header')
      }
      current = new URL(loc, current)
      assertUrlSafeForServerFetch(current)
      continue
    }

    return { response: res, finalUrl: current.href }
  }

  throw new Error('Too many redirects')
}

export async function streamToBufferLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Buffer> {
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error(`Download exceeds maximum size (${Math.round(maxBytes / 1024 / 1024)}MB)`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks)
}

function extFromContentType(ct: string): string {
  const main = ct.split(';')[0].trim().toLowerCase()
  if (main.includes('mpeg') || main === 'audio/mp3') return '.mp3'
  if (main.includes('wav')) return '.wav'
  if (main.includes('m4a') || main === 'audio/mp4') return '.m4a'
  if (main === 'video/mp4') return '.mp4'
  if (main.includes('webm')) return '.webm'
  return '.bin'
}

function sniffAudioExt(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return '.mp3'
  if (buffer.length >= 4 && buffer.slice(0, 4).toString() === 'RIFF') return '.wav'
  if (buffer.length >= 8 && buffer.slice(4, 8).toString() === 'ftyp') return '.m4a'
  if (buffer.length >= 4 && buffer.slice(0, 4).toString() === 'OggS') return '.webm'
  return '.mp3'
}

function findAudioUrlInHtml(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html)

  const tryUrl = (raw: string | undefined): string | null => {
    if (!raw?.trim()) return null
    try {
      return new URL(raw.trim(), baseUrl).href
    } catch {
      return null
    }
  }

  const og =
    tryUrl($('meta[property="og:audio"]').attr('content')) ||
    tryUrl($('meta[property="og:audio:url"]').attr('content'))
  if (og) return og

  const tw = tryUrl($('meta[name="twitter:player:stream"]').attr('content'))
  if (tw) return tw

  const ogVideo =
    tryUrl($('meta[property="og:video:secure_url"]').attr('content')) ||
    tryUrl($('meta[property="og:video:url"]').attr('content')) ||
    tryUrl($('meta[property="og:video"]').attr('content'))
  if (ogVideo) return ogVideo

  // Swagit video pages expose a /download endpoint that redirects to a signed S3 MP4 URL.
  // Match both /videos/<id> and /videos/<id>/ (trailing slash).
  const swagitVideoPage = baseUrl.match(/^(https?:\/\/[^/]+\.swagit\.com\/videos\/\d+)\/?(\?.*)?$/)
  if (swagitVideoPage) {
    return swagitVideoPage[1] + '/download'
  }

  const swagitIframe = $('iframe[src*="swagit"]').first().attr('src')
  const iframeVideo = tryUrl(swagitIframe)
  if (iframeVideo) return iframeVideo

  for (const el of $('link[rel="enclosure"]').toArray()) {
    const $el = $(el)
    const type = ($el.attr('type') || '').toLowerCase()
    const href = $el.attr('href')
    const u = tryUrl(href)
    if (
      u &&
      (type.startsWith('audio/') || !type || type === 'application/octet-stream')
    ) {
      return u
    }
  }

  const src =
    tryUrl($('audio source').first().attr('src')) || tryUrl($('audio').first().attr('src'))
  if (src) return src

  return null
}

/**
 * Best-effort parse of when the source media was recorded (e.g. Swagit og:title "Apr 01, 2026 …").
 * Returns ISO string or null.
 */
export function extractSourceRecordedAtFromHtml(html: string): string | null {
  const $ = cheerio.load(html)

  const published =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[property="og:article:published_time"]').attr('content') ||
    $('meta[name="article:published_time"]').attr('content')
  if (published?.trim()) {
    const d = new Date(published.trim())
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim()
  const docTitle = $('title').text().trim()
  const title = ogTitle || docTitle
  if (title) {
    // "Apr 01, 2026 …" or "April 1, 2026 …" at start (Swagit and similar)
    const shortMonth = title.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/)
    if (shortMonth) {
      const d = new Date(`${shortMonth[1]} ${shortMonth[2]}, ${shortMonth[3]}`)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
    const longMonth = title.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/)
    if (longMonth && longMonth[1].length > 3) {
      const d = new Date(`${longMonth[1]} ${longMonth[2]}, ${longMonth[3]}`)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }

  return null
}

export async function downloadDirectOrPageAudio(
  url: string,
  signal: AbortSignal
): Promise<{ buffer: Buffer; contentType: string; ext: string; sourceRecordedAt?: string | null }> {
  let { response: res, finalUrl } = await fetchWithRedirectGuard(url, { signal })
  if (!res.ok) {
    throw new Error(`Failed to fetch URL (${res.status})`)
  }

  let sourceRecordedAt: string | null = null

  // Follow HTML player pages (e.g. Swagit: watch page → /embed → real stream URL).
  const MAX_HTML_HOPS = 5
  for (let hop = 0; hop < MAX_HTML_HOPS; hop++) {
    const ctHeader = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!ctHeader.includes('text/html') && ctHeader !== 'application/xhtml+xml') {
      break
    }
    const html = await res.text()
    if (!sourceRecordedAt) {
      sourceRecordedAt = extractSourceRecordedAtFromHtml(html)
    }
    const nextUrl = findAudioUrlInHtml(html, finalUrl)
    if (!nextUrl) {
      throw new Error(
        'No embedded audio or video URL found on this page. Try pasting a direct audio or video link instead.'
      )
    }
    assertUrlSafeForServerFetch(new URL(nextUrl))
    const next = await fetchWithRedirectGuard(nextUrl, { signal })
    res = next.response
    finalUrl = next.finalUrl
    if (!res.ok) {
      throw new Error(`Failed to fetch media (${res.status})`)
    }
  }

  const finalCt = (res.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0]
    .trim()
    .toLowerCase()

  // Some hosts (notably S3) return mp4 as binary/octet-stream. Use the final URL as a hint so
  // we can treat it as video for audio extraction upstream.
  const hintedCt =
    (finalCt === 'application/octet-stream' || finalCt === 'binary/octet-stream') &&
    /\.(mp4)(\?|$)/i.test(finalUrl)
      ? 'video/mp4'
      : finalCt

  const body = res.body
  if (!body) {
    throw new Error('Empty response body')
  }

  // We allow `video/*` here as an *extraction source*; the API route will extract audio-only before storage.
  const isMediaLike =
    hintedCt.startsWith('audio/') ||
    hintedCt.startsWith('video/') ||
    hintedCt === 'application/octet-stream' ||
    hintedCt === 'binary/octet-stream'

  if (!isMediaLike) {
    throw new Error(
      'This URL did not return audio. Try a direct .mp3, .m4a, or video link.'
    )
  }

  const buffer = await streamToBufferLimited(body, MAX_PULL_BYTES)
  if (buffer.length === 0) {
    throw new Error('Downloaded file is empty')
  }

  let ext = extFromContentType(hintedCt)
  if (hintedCt === 'application/octet-stream' || hintedCt === 'binary/octet-stream') {
    ext = sniffAudioExt(buffer)
  }

  const contentType =
    hintedCt === 'binary/octet-stream' ? 'application/octet-stream' : hintedCt

  return { buffer, contentType, ext, sourceRecordedAt }
}
