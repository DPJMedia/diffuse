/**
 * Parse and merge workflow output JSON stored in diffuse_project_outputs.content.
 * Webhooks often send metadata on a wrapper object next to nested `article`; the UI edits a flat StructuredArticle.
 */

export interface StructuredArticle {
  title: string
  author: string
  subtitle?: string | null
  excerpt: string
  content: string
  photo_caption?: string | null
  photo_credit?: string | null
  suggested_sections?: string[]
  category?: string
  tags?: string[]
  meta_title?: string
  meta_description?: string
}

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\\n/g, '\n') : '')

/** Normalize tags from JSON (array), JSON string, or missing. */
export function normalizeTags(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string')
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return []
    try {
      const p = JSON.parse(t) as unknown
      if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string')
    } catch {
      return [raw]
    }
  }
  return []
}

function articleRecordToStructured(a: Record<string, unknown>): StructuredArticle {
  return {
    title: (a.title as string) || '',
    author: (a.author as string) || 'Diffuse.AI',
    subtitle: (a.subtitle as string)?.replace(/\\n/g, '\n') ?? null,
    excerpt: str(a.excerpt) || '',
    content: str(a.content) || '',
    photo_caption: (a.photo_caption as string)?.replace(/\\n/g, '\n') ?? null,
    photo_credit: (a.photo_credit as string)?.replace(/\\n/g, '\n') ?? null,
    suggested_sections: Array.isArray(a.suggested_sections) ? (a.suggested_sections as string[]) : undefined,
    category: typeof a.category === 'string' ? a.category : undefined,
    tags: normalizeTags(a.tags),
    meta_title: typeof a.meta_title === 'string' ? a.meta_title : undefined,
    meta_description: typeof a.meta_description === 'string' ? a.meta_description : undefined,
  }
}

/** Overlay wrapper-level metadata onto base (wrapper wins when key is present on wrapper). */
function overlayMetadata(base: StructuredArticle, wrapper: Record<string, unknown>): StructuredArticle {
  const next = { ...base }
  if ('photo_caption' in wrapper) {
    const v = wrapper.photo_caption
    next.photo_caption = typeof v === 'string' ? v.replace(/\\n/g, '\n') : v == null ? null : base.photo_caption
  }
  if ('photo_credit' in wrapper) {
    const v = wrapper.photo_credit
    next.photo_credit = typeof v === 'string' ? v.replace(/\\n/g, '\n') : v == null ? null : base.photo_credit
  }
  if ('category' in wrapper) {
    const v = wrapper.category
    next.category = typeof v === 'string' ? v : undefined
  }
  if ('suggested_sections' in wrapper) {
    const v = wrapper.suggested_sections
    next.suggested_sections = Array.isArray(v) ? (v as string[]) : base.suggested_sections
  }
  if ('tags' in wrapper) {
    next.tags = normalizeTags(wrapper.tags)
  }
  if ('meta_title' in wrapper) {
    const v = wrapper.meta_title
    next.meta_title = typeof v === 'string' ? v : undefined
  }
  if ('meta_description' in wrapper) {
    const v = wrapper.meta_description
    next.meta_description = typeof v === 'string' ? v : undefined
  }
  return next
}

function extractField(content: string, field: string): string | null {
  const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]*(?:\\\\"[^"]*)*)"`, 's')
  const match = content.match(regex)
  if (match) {
    return match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }
  return null
}

function extractArrayField(content: string, field: string): string[] {
  const regex = new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`, 's')
  const match = content.match(regex)
  if (match) {
    const arrayContent = match[1]
    const items = arrayContent.match(/"([^"]*)"/g)
    if (items) {
      return items.map((item) => item.replace(/"/g, ''))
    }
  }
  return []
}

function regexFallback(content: string): StructuredArticle | null {
  const title = extractField(content, 'title')
  const articleContent = extractField(content, 'content')
  if (!title && !articleContent) return null
  const tagsRaw = extractField(content, 'tags')
  let tagsFromString: string[] = []
  if (tagsRaw) {
    try {
      tagsFromString = normalizeTags(tagsRaw)
    } catch {
      tagsFromString = []
    }
  }
  const tagsFromArray = extractArrayField(content, 'tags')
  return {
    title: title || '',
    author: extractField(content, 'author') || 'Diffuse.AI',
    subtitle: extractField(content, 'subtitle') || null,
    excerpt: extractField(content, 'excerpt') || '',
    content: articleContent || '',
    photo_caption: extractField(content, 'photo_caption') || null,
    photo_credit: extractField(content, 'photo_credit') || null,
    suggested_sections: extractArrayField(content, 'suggested_sections'),
    category: extractField(content, 'category') || undefined,
    tags: tagsFromString.length ? tagsFromString : tagsFromArray,
    meta_title: extractField(content, 'meta_title') || undefined,
    meta_description: extractField(content, 'meta_description') || undefined,
  }
}

/**
 * Parse stored output JSON into a flat StructuredArticle (wrapper + article merged for display).
 */
export function parseOutputContentToStructuredArticle(content: string): StructuredArticle | null {
  try {
    let parsed: unknown = null
    let jsonString = (content || '').trim()
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
        try {
          jsonString = JSON.parse(jsonString)
          parsed = JSON.parse(jsonString)
        } catch {
          /* fall through */
        }
      }
    }
    if (parsed == null) return regexFallback(content)

    if (Array.isArray(parsed)) {
      const item = parsed.find(
        (p) => p && typeof p === 'object' && (p as Record<string, unknown>).article && typeof (p as Record<string, unknown>).article === 'object'
      ) as Record<string, unknown> | undefined
      if (item?.article && typeof item.article === 'object') {
        const base = articleRecordToStructured(item.article as Record<string, unknown>)
        return overlayMetadata(base, item)
      }
      if (parsed.length >= 2 && parsed[1] && typeof parsed[1] === 'object') {
        const second = parsed[1] as Record<string, unknown>
        if (second.article && typeof second.article === 'object') {
          return articleRecordToStructured(second.article as Record<string, unknown>)
        }
      }
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const flat = parsed as Record<string, unknown>
      if (flat.article && typeof flat.article === 'object') {
        const base = articleRecordToStructured(flat.article as Record<string, unknown>)
        return overlayMetadata(base, flat)
      }
      if (flat.title || flat.content) {
        return articleRecordToStructured(flat)
      }
    }

    return regexFallback(content)
  } catch {
    return regexFallback(content)
  }
}

function coreArticlePayload(a: StructuredArticle): Record<string, unknown> {
  return {
    title: a.title,
    author: a.author,
    subtitle: a.subtitle ?? null,
    excerpt: a.excerpt,
    content: a.content,
  }
}

function serializeTagsForStorage(original: unknown, tags: string[] | undefined): unknown {
  if (tags === undefined) return original
  if (typeof original === 'string') {
    return JSON.stringify(tags)
  }
  return tags
}

/**
 * Merge edited StructuredArticle back into previous JSON without dropping wrapper keys (e.g. image_base64).
 */
export function mergeStructuredArticleIntoContent(previousContent: string, article: StructuredArticle): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(previousContent)
  } catch {
    return JSON.stringify(article)
  }

  const metaAssign = (
    target: Record<string, unknown>,
    original: Record<string, unknown>,
    a: StructuredArticle
  ) => {
    if (a.photo_caption !== undefined) target.photo_caption = a.photo_caption
    if (a.photo_credit !== undefined) target.photo_credit = a.photo_credit
    if (a.category !== undefined) target.category = a.category
    if (a.suggested_sections !== undefined) target.suggested_sections = a.suggested_sections
    if (a.meta_title !== undefined) target.meta_title = a.meta_title
    if (a.meta_description !== undefined) target.meta_description = a.meta_description
    if (a.tags !== undefined) {
      target.tags = serializeTagsForStorage(original.tags, a.tags)
    }
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 1 && parsed[0] && typeof parsed[0] === 'object') {
      const wrapper = parsed[0] as Record<string, unknown>
      if (wrapper.article && typeof wrapper.article === 'object') {
        const prevArt = wrapper.article as Record<string, unknown>
        const mergedArticle: Record<string, unknown> = {
          ...prevArt,
          ...coreArticlePayload(article),
        }
        const nextWrapper: Record<string, unknown> = { ...wrapper, article: mergedArticle }
        metaAssign(nextWrapper, wrapper, article)
        return JSON.stringify([nextWrapper])
      }
    }

    if (parsed.length >= 2 && parsed[1] && typeof parsed[1] === 'object') {
      const slot1 = parsed[1] as Record<string, unknown>
      if (slot1.article && typeof slot1.article === 'object') {
        const prevArt = slot1.article as Record<string, unknown>
        const meta: Record<string, unknown> = {}
        if (article.photo_caption !== undefined) meta.photo_caption = article.photo_caption
        if (article.photo_credit !== undefined) meta.photo_credit = article.photo_credit
        if (article.category !== undefined) meta.category = article.category
        if (article.suggested_sections !== undefined) meta.suggested_sections = article.suggested_sections
        if (article.tags !== undefined) meta.tags = article.tags
        if (article.meta_title !== undefined) meta.meta_title = article.meta_title
        if (article.meta_description !== undefined) meta.meta_description = article.meta_description
        const mergedFull = {
          ...prevArt,
          ...coreArticlePayload(article),
          ...meta,
        }
        return JSON.stringify([parsed[0], { ...slot1, article: mergedFull }])
      }
    }
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const flat = parsed as Record<string, unknown>
    if (flat.article && typeof flat.article === 'object') {
      const prevArt = flat.article as Record<string, unknown>
      const mergedArticle: Record<string, unknown> = {
        ...prevArt,
        ...coreArticlePayload(article),
      }
      const next: Record<string, unknown> = { ...flat, article: mergedArticle }
      metaAssign(next, flat, article)
      return JSON.stringify(next)
    }
    if (flat.title || flat.content) {
      const next = { ...flat, ...coreArticlePayload(article) }
      metaAssign(next, flat, article)
      return JSON.stringify(next)
    }
  }

  return JSON.stringify(article)
}
