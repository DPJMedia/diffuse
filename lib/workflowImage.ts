// Shared image-validation primitives for the workflow + workflow/callback routes.
//
// These two routes each parse n8n's response to extract a generated cover image.
// They previously kept *duplicate* copies of the detection logic, which drifted:
// a fix applied to one route silently left the other broken. The validation that
// actually prevents garbage from being persisted lives here so both routes share it.

const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/

// True only if the buffer starts with a real raster-image magic number.
export function isImageBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 4) return false
  const isJPEG = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  const isPNG = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const isGIF = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46
  const isWEBP =
    buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
  return isJPEG || isPNG || isGIF || isWEBP
}

// File extension derived from the buffer's magic number (never from a spoofable
// Content-Type header). Falls back to png if somehow not a known image.
export function imageExtFromBuffer(buf: Buffer): 'png' | 'jpg' | 'webp' | 'gif' {
  if (buf.length >= 4) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif'
    if (
      buf.length > 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP'
    )
      return 'webp'
  }
  return 'png'
}

// A cover image must be a real, plausibly-sized image. n8n payloads carry long
// IDs/tokens/hashes that pass a loose base64 regex but decode to a few junk bytes;
// without this guard those win over the real generated_image_url download.
const MIN_IMAGE_BYTES = 1024

export function isValidImageBytes(buf: Buffer | null | undefined): buf is Buffer {
  return !!buf && buf.length >= MIN_IMAGE_BYTES && isImageBuffer(buf)
}

// True if `raw` is a base64 string that decodes to a real, image-sized image.
export function isLikelyImageBase64(raw: string): boolean {
  const cleaned = raw.replace(/\s/g, '')
  if (cleaned.length < 100 || !BASE64_PATTERN.test(cleaned)) return false
  let buf: Buffer
  try {
    buf = Buffer.from(cleaned, 'base64')
  } catch {
    return false
  }
  return isValidImageBytes(buf)
}
