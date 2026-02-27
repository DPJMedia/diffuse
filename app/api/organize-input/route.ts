import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
// Prefer free model; fallback to same model as transcribe (Claude Haiku) if needed
const OPENROUTER_MODEL_PRIMARY = 'google/gemini-2.0-flash-exp:free'
const OPENROUTER_MODEL_FALLBACK = 'anthropic/claude-3.5-haiku'

const SYSTEM_PROMPT = `You are a content processor for a local news AI system. Organize scraped web content for use in article generation.

Your task:
1. Remove only non-content: navigation menus, ads, footers, cookie notices, and boilerplate.
2. Keep ALL substantive information: do not remove or summarize away any facts, quotes, data, or main article text.
3. Organize the content into clear sections if multiple topics are present.
4. Preserve important names, dates, numbers, and quotes exactly.
5. Output clean, well-structured text with all key information retained, optimized for news article generation.

Format the output as clean paragraphs separated by blank lines. No markdown, no bullets, just clear prose that includes all the important information in an organized fashion.

CRITICAL: Output ONLY the organized content. Do not add any preamble, introduction, or meta-commentary (e.g. no "Here's the processed content...", no "Key information:", no "Summary:"). Start directly with the first paragraph of the organized content.`

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await checkRateLimit(request, 'expensive')
    if (rateLimitResponse) return rateLimitResponse

    let authResult
    try {
      authResult = await requireAuth()
    } catch {
      return unauthorizedResponse()
    }
    void authResult

    let body: { content?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    if (!content) {
      return NextResponse.json({ error: 'content is required and must be a non-empty string' }, { status: 400 })
    }

    const apiKey = process.env.OPENROUTER || process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 503 })
    }

    const userMessage = `Organize the following scraped web content. Output ONLY the organized content. No intro line, no "Here's..." or "Key information:" or similar. Start directly with the first paragraph.\n\n${content.slice(0, 120000)}`

    const payload = {
      model: OPENROUTER_MODEL_PRIMARY,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 16000,
    }

    let res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    // If primary (free) model fails, try fallback model used by transcribe
    if (!res.ok && res.status !== 400) {
      console.warn('[organize-input] Primary model failed, trying fallback:', res.status, await res.text().catch(() => ''))
      res = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...payload, model: OPENROUTER_MODEL_FALLBACK }),
      })
    }

    const resText = await res.text()

    if (!res.ok) {
      let errMessage = 'Failed to organize content'
      try {
        const errJson = JSON.parse(resText) as { error?: { message?: string }; message?: string }
        const msg = errJson?.error?.message ?? errJson?.message ?? errJson?.error
        if (typeof msg === 'string' && msg.length > 0 && msg.length < 500) errMessage = msg
        else if (typeof msg === 'object' && msg && 'message' in msg) errMessage = String((msg as { message?: string }).message).slice(0, 300)
      } catch {
        if (resText && resText.length < 300) errMessage = resText
      }
      console.error('[organize-input] OpenRouter error:', res.status, resText.slice(0, 500))
      return NextResponse.json({ error: errMessage }, { status: 502 })
    }

    let data: { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> }
    try {
      data = JSON.parse(resText) as typeof data
    } catch {
      console.error('[organize-input] Invalid JSON from OpenRouter')
      return NextResponse.json({ error: 'Invalid response from AI service' }, { status: 502 })
    }

    const rawContent = data?.choices?.[0]?.message?.content
    let organizedContent = ''
    if (typeof rawContent === 'string') {
      organizedContent = rawContent.trim()
    } else if (Array.isArray(rawContent)) {
      organizedContent = rawContent
        .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim()
    }

    if (!organizedContent) {
      console.error('[organize-input] OpenRouter returned no content. Response keys:', data ? Object.keys(data) : 'null')
      return NextResponse.json(
        { error: 'Model returned no text. Try again or use different content.' },
        { status: 502 }
      )
    }

    // Strip common preamble line(s) if the model added them despite instructions
    let finalContent = organizedContent
    const firstLineEnd = finalContent.indexOf('\n')
    const firstLine = firstLineEnd >= 0 ? finalContent.slice(0, firstLineEnd) : finalContent
    if (/^\s*(Here'?s?\s+(?:the\s+)?(?:processed\s+)?content|(?:Key\s+information|Summary|Overview)\s*[:\s]|.*focusing on the key information)/i.test(firstLine.trim())) {
      const rest = firstLineEnd >= 0 ? finalContent.slice(firstLineEnd + 1).trim() : ''
      finalContent = rest.length > 0 ? rest : finalContent
    }

    return NextResponse.json({ organizedContent: finalContent })
  } catch (err) {
    console.error('[organize-input]', err)
    return NextResponse.json({ error: 'Failed to organize content' }, { status: 500 })
  }
}
