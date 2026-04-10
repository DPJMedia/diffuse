import { MAX_PULL_BYTES, streamToBufferLimited } from '@/lib/recordings/pullAudioFromUrl'

export class YouTubeError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'YouTubeError'
  }
}

/**
 * Detect YouTube watch, live, shorts, and youtu.be URLs (no network call).
 */
export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.toLowerCase()
    if (host === 'youtu.be') {
      return u.pathname.length > 1 && u.pathname !== '/'
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const p = u.pathname.toLowerCase()
      return (
        p.startsWith('/watch') ||
        p.startsWith('/live') ||
        p.startsWith('/shorts/') ||
        p.startsWith('/embed/')
      )
    }
    return false
  } catch {
    return false
  }
}

function getCobaltBaseUrl(): string | undefined {
  return process.env.COBALT_API_URL?.trim().replace(/\/+$/, '')
}

function getCobaltApiKey(): string | undefined {
  return process.env.COBALT_API_KEY?.trim()
}

function formatCobaltError(body: Record<string, unknown>): string {
  const err = body.error
  if (err && typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: string }).code
    if (typeof code === 'string' && code.length > 0) {
      const ctx = (err as { context?: Record<string, unknown> }).context
      if (ctx && typeof ctx === 'object') {
        return `${code} (${JSON.stringify(ctx)})`
      }
      return code
    }
  }
  if (typeof err === 'string' && err.length > 0) {
    return err
  }
  return JSON.stringify(body.error ?? body)
}

/**
 * Resolve a playable download URL from a successful Cobalt JSON body.
 * See https://github.com/imputnet/cobalt/blob/main/docs/api.md
 */
function resolveCobaltMediaUrl(body: Record<string, unknown>): string | null {
  const status = body.status
  if (status === 'tunnel' || status === 'redirect') {
    const u = body.url
    return typeof u === 'string' && u.length > 0 ? u : null
  }
  if (status === 'local-processing') {
    const tunnels = body.tunnel
    if (Array.isArray(tunnels) && tunnels.length > 0 && typeof tunnels[0] === 'string') {
      return tunnels[0]
    }
  }
  if (status === 'picker' && Array.isArray(body.picker)) {
    for (const item of body.picker) {
      if (item && typeof item === 'object' && item !== null && 'url' in item) {
        const url = (item as { url?: string; type?: string }).url
        if (typeof url === 'string' && url.length > 0) {
          return url
        }
      }
    }
  }
  return null
}

/**
 * Extract audio for YouTube URLs via a self-hosted Cobalt instance.
 * Set COBALT_API_URL (and optionally COBALT_API_KEY) — see .env.example.
 */
export async function extractYouTubeAudio(
  url: string,
  signal: AbortSignal
): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  const baseUrl = getCobaltBaseUrl()
  if (!baseUrl) {
    throw new YouTubeError(
      'YouTube pull is not configured. Set COBALT_API_URL to your self-hosted Cobalt API base URL (see .env.example).',
      'COBALT_NOT_CONFIGURED'
    )
  }

  const apiKey = getCobaltApiKey()
  const endpoint = `${baseUrl}/`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (apiKey) {
    headers.Authorization = `Api-Key ${apiKey}`
  }

  let cobaltRes: Response
  try {
    cobaltRes = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url,
        downloadMode: 'audio',
        audioFormat: 'mp3',
        // Tunnel through Cobalt instead of a bare CDN redirect — often required for YouTube from server IPs.
        alwaysProxy: true,
      }),
      signal,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new YouTubeError(`Cobalt API request failed: ${message}`, 'COBALT_REQUEST_FAILED')
  }

  let cobaltBody: Record<string, unknown>
  try {
    cobaltBody = (await cobaltRes.json()) as Record<string, unknown>
  } catch {
    throw new YouTubeError(
      `Cobalt API returned a non-JSON response (HTTP ${cobaltRes.status})`,
      'COBALT_INVALID_RESPONSE'
    )
  }

  if (!cobaltRes.ok || cobaltBody.status === 'error') {
    const detail = formatCobaltError(cobaltBody)
    console.error('[cobalt] error response:', JSON.stringify(cobaltBody))
    throw new YouTubeError(
      `Cobalt could not process this URL (${detail}). It may be unsupported, private, geo-blocked, or require login. If you self-host, set API_URL on the Cobalt service to its public https URL and check Cobalt deploy logs.`,
      'COBALT_FAILED'
    )
  }

  const audioUrl = resolveCobaltMediaUrl(cobaltBody)
  if (!audioUrl) {
    console.error('[cobalt] unexpected success shape:', JSON.stringify(cobaltBody))
    throw new YouTubeError(
      `Cobalt returned status "${String(cobaltBody.status)}" but no usable download URL. Update the app or check Cobalt version/docs.`,
      'COBALT_NO_URL'
    )
  }

  const audioFetchHeaders: Record<string, string> = {}
  if (apiKey) {
    try {
      if (new URL(audioUrl).origin === new URL(baseUrl).origin) {
        audioFetchHeaders.Authorization = `Api-Key ${apiKey}`
      }
    } catch {
      /* ignore */
    }
  }

  let audioRes: Response
  try {
    audioRes = await fetch(audioUrl, {
      signal,
      headers: Object.keys(audioFetchHeaders).length ? audioFetchHeaders : undefined,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new YouTubeError(`Failed to fetch Cobalt audio URL: ${message}`, 'COBALT_AUDIO_FETCH_FAILED')
  }

  if (!audioRes.ok) {
    throw new YouTubeError(
      `Cobalt audio download returned HTTP ${audioRes.status}`,
      'COBALT_AUDIO_DOWNLOAD_FAILED'
    )
  }

  const resBody = audioRes.body
  if (!resBody) {
    throw new YouTubeError('Cobalt audio response had no body', 'COBALT_EMPTY_BODY')
  }

  const buffer = await streamToBufferLimited(resBody, MAX_PULL_BYTES)
  if (buffer.length === 0) {
    throw new YouTubeError('Cobalt returned an empty audio file', 'COBALT_EMPTY_AUDIO')
  }

  return { buffer, contentType: 'audio/mpeg', ext: '.mp3' }
}
