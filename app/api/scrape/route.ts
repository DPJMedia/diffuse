import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'
import { validateSchema, validateScrapeUrl } from '@/lib/security/validation'
import { safeFetch, SsrfError } from '@/lib/security/ssrf'

const SCRAPE_TIMEOUT_MS = 15000
const MIN_CONTENT_LENGTH = 100
const MAX_CONTENT_LENGTH = 50000
const USER_AGENT = 'Mozilla/5.0 (compatible; DiffuseAI/1.0; +https://diffuse.press)'

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await checkRateLimit(request, 'expensive')
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    let authResult
    try {
      authResult = await requireAuth()
    } catch {
      return unauthorizedResponse()
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body. Expected JSON.' },
        { status: 400 }
      )
    }

    let validatedData: { url: string }
    try {
      validatedData = validateSchema(body, {
        url: {
          required: true,
          type: 'string',
          validator: validateScrapeUrl,
        },
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Validation failed'
      return NextResponse.json(
        { error: 'Validation failed', message },
        { status: 400 }
      )
    }

    const { url } = validatedData
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)

    let response: Response
    try {
      // safeFetch resolves the host and blocks private/loopback/reserved addresses, and
      // re-validates every redirect hop (prevents SSRF to internal services / metadata).
      response = await safeFetch(
        url,
        { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } },
        { allowHttp: true }
      )
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof SsrfError) {
        return NextResponse.json({ error: 'This URL is not allowed.' }, { status: 400 })
      }
      if (err instanceof Error && err.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request timed out - site took too long to respond' },
          { status: 408 }
        )
      }
      const msg =
        err instanceof Error && (err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED'))
          ? 'Could not reach this website - check the URL'
          : 'Failed to fetch URL'
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    clearTimeout(timeout)

    if (!response.ok) {
      let errorMessage = 'Failed to fetch content'
      if (response.status === 403) {
        errorMessage = 'This site doesn\'t allow scraping.'
      } else if (response.status === 404) {
        errorMessage = 'Page not found'
      } else if (response.status === 429) {
        errorMessage = 'Rate limited - please try again later'
      } else if (response.status >= 500) {
        errorMessage = 'The website is currently unavailable'
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      )
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    $('script, style, nav, footer, header, iframe, noscript').remove()
    $('.advertisement, .ads, .social-share, .cookie-banner').remove()

    const title =
      $('title').text().trim() ||
      $('h1').first().text().trim() ||
      (() => {
        try {
          return new URL(url).hostname
        } catch {
          return 'Web Page'
        }
      })()

    const description =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      ''

    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content']
    let content = ''
    for (const selector of mainSelectors) {
      const el = $(selector).first()
      if (el.length > 0) {
        content = el.text()
        break
      }
    }
    if (!content) {
      content = $('body').text()
    }

    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()

    if (content.length < MIN_CONTENT_LENGTH) {
      return NextResponse.json(
        {
          error:
            'This site doesn\'t allow scraping.',
        },
        { status: 400 }
      )
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated due to length...]'
    }

    const res = NextResponse.json({
      success: true,
      data: {
        title: title || 'Web Page',
        description: description || undefined,
        content,
        url,
        scrapedAt: new Date().toISOString(),
      },
    })

    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      res.headers.set(key, value)
    })

    return res
  } catch (error) {
    console.error('Scraping error:', error)
    return NextResponse.json(
      { error: 'Failed to scrape URL' },
      { status: 500 }
    )
  }
}
