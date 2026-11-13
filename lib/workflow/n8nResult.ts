// Parsing helpers for n8n workflow responses, shared by the synchronous
// workflow route (app/api/workflow/route.ts) and the async callback route
// (app/api/workflow/callback/route.ts). Both receive the same payload shape.

import https from 'https'
import { isLikelyImageBase64 } from '@/lib/workflowImage'

/** Download image via Node https (fallback when fetch fails with "fetch failed" on some networks). */
export function downloadImageViaHttps(url: string, timeoutMs: number): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      reject(new Error('Only https URLs supported'))
      return
    }
    const req = https.get(
      url,
      { headers: { Accept: 'image/*', 'User-Agent': 'DiffuseWorkflow/1.0 (image-fetch)' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Image fetch ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const contentType = res.headers['content-type'] || 'image/png'
          resolve({ buffer, contentType })
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Image fetch timeout'))
    })
  })
}

// Helper to extract the actual article JSON from various n8n/OpenAI response formats
export function extractArticleContent(n8nResult: any): string {
  try {
    // Case 1: Direct output string (Simplify Output ON)
    if (typeof n8nResult.output === 'string') {
      return n8nResult.output
    }

    // Case 2: Array response from OpenAI (Simplify Output OFF)
    if (Array.isArray(n8nResult)) {
      const firstItem = n8nResult[0]
      
      // Check for nested output array with message content
      if (firstItem?.output && Array.isArray(firstItem.output)) {
        const message = firstItem.output.find((o: any) => o.type === 'message')
        if (message?.content && Array.isArray(message.content)) {
          const textContent = message.content.find((c: any) => c.type === 'output_text')
          if (textContent?.text) {
            return textContent.text
          }
        }
      }
      
      // Check for direct content
      if (firstItem?.content) {
        if (Array.isArray(firstItem.content)) {
          const textContent = firstItem.content.find((c: any) => c.type === 'output_text' || c.text)
          if (textContent?.text) {
            return textContent.text
          }
        }
        return typeof firstItem.content === 'string' ? firstItem.content : JSON.stringify(firstItem.content)
      }
    }

    // Case 3: Object with output array
    if (n8nResult.output && Array.isArray(n8nResult.output)) {
      const message = n8nResult.output.find((o: any) => o.type === 'message')
      if (message?.content && Array.isArray(message.content)) {
        const textContent = message.content.find((c: any) => c.type === 'output_text')
        if (textContent?.text) {
          return textContent.text
        }
      }
    }

    // Case 4: Direct content property
    if (n8nResult.content) {
      return typeof n8nResult.content === 'string' ? n8nResult.content : JSON.stringify(n8nResult.content)
    }

    // Fallback: stringify the whole thing
    return JSON.stringify(n8nResult)
  } catch (error) {
    console.error('Error extracting content:', error)
    return JSON.stringify(n8nResult)
  }
}

// Normalize external image URL so it always has https (avoids <img> / next/image failing)
export const normalizeImageUrl = (u: string | undefined): string | undefined => {
  if (!u || typeof u !== 'string') return undefined
  const t = u.trim()
  if (t.startsWith('https://') || t.startsWith('http://')) return t
  if (t.startsWith('//')) return `https:${t}`
  if (t.includes('.') && (t.includes('blob.') || t.includes('amazonaws.') || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t))) return `https://${t}`
  return undefined
}

// Recursively find first string that looks like an image URL (so we find it even if n8n put it in a different node)
const IMAGE_URL_PATTERN = /^https?:\/\/|^\/\/|\.blob\.|\.amazonaws\.|\.(png|jpg|jpeg|webp|gif)(\?|$)/i
export function findImageUrlInPayload(obj: unknown, depth = 0): string | undefined {
  if (depth > 20) return undefined
  if (typeof obj === 'string') {
    const normalized = normalizeImageUrl(obj)
    if (normalized && IMAGE_URL_PATTERN.test(normalized)) return normalized
    return undefined
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const u = findImageUrlInPayload(item, depth + 1)
      if (u) return u
    }
    return undefined
  }
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>
    for (const key of ['url', 'image_url', 'image', 'generated_image_url', 'src', 'href']) {
      const u = findImageUrlInPayload(o[key], depth + 1)
      if (u) return u
    }
    for (const value of Object.values(o)) {
      const u = findImageUrlInPayload(value, depth + 1)
      if (u) return u
    }
  }
  return undefined
}

// Recursively find base64 image (workflow can send image bytes so we never need to fetch from Azure)
// Image-bytes validation (base64 + magic-number checks) is shared with the async callback
// route via @/lib/workflowImage so the two paths cannot drift apart again.
export function findBase64ImageInPayload(obj: unknown, depth = 0): { data: string; contentType?: string } | undefined {
  if (depth > 20) return undefined
  if (typeof obj === 'string') {
    if (isLikelyImageBase64(obj)) return { data: obj }
    return undefined
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const b = findBase64ImageInPayload(item, depth + 1)
      if (b) return b
    }
    return undefined
  }
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>
    for (const key of ['image_base64', 'imageBase64', 'image_base64_data', 'image_data']) {
      const v = o[key]
      if (typeof v === 'string' && isLikelyImageBase64(v)) {
        return { data: v, contentType: typeof o.content_type === 'string' ? o.content_type : undefined }
      }
    }
    if (o.image && typeof o.image === 'object' && o.image !== null && typeof (o.image as Record<string, unknown>).data === 'string') {
      const d = (o.image as Record<string, unknown>).data as string
      if (isLikelyImageBase64(d)) return { data: d }
    }
    for (const value of Object.values(o)) {
      const b = findBase64ImageInPayload(value, depth + 1)
      if (b) return b
    }
  }
  return undefined
}

// 0) If workflow already uploaded to Supabase and returned the path, use it (best: no Azure fetch, no proxy)
const UUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+$/i
export function findStoragePathInPayload(obj: unknown, depth = 0): string | undefined {
  if (depth > 20) return undefined
  if (typeof obj === 'string') {
    const t = obj.trim()
    if (t.length > 10 && t.length < 500 && !t.startsWith('http') && UUID_PATH.test(t) && !t.includes('..')) return t
    return undefined
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const p = findStoragePathInPayload(item, depth + 1)
      if (p) return p
    }
    return undefined
  }
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>
    for (const key of ['cover_photo_path', 'storage_path', 'supabase_path', 'image_storage_path', 'image_path']) {
      const v = o[key]
      if (typeof v === 'string') {
        const p = findStoragePathInPayload(v, depth + 1)
        if (p) return p
      }
    }
    for (const value of Object.values(o)) {
      const p = findStoragePathInPayload(value, depth + 1)
      if (p) return p
    }
  }
  return undefined
}
