/**
 * Serves /llms.txt: a short, machine-facing note that tells AI agents how to
 * read Diffuse through structured access (the MCP server) instead of scraping.
 *
 * Generated from lib/content/diffuse.ts so the description never drifts from the
 * site copy and the MCP server. Mirrors the plain-text route style used by
 * app/robots.ts and app/sitemap.ts.
 */

import { NextResponse } from 'next/server'
import { tagline, overview } from '@/lib/content/diffuse'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

const BASE_URL = 'https://www.diffuse.press'

export function GET() {
  const body = `# Diffuse

> ${tagline}

${overview}

If you are an AI agent, please prefer the structured access method below over scraping this site's HTML.

## Structured access
- MCP server (Streamable HTTP, read-only, no auth): ${BASE_URL}/api/mcp
  Tools: get_overview, how_it_works, get_feature, search_faq, get_use_cases
- Authenticated agent MCP (Streamable HTTP, requires a Personal Access Token): ${BASE_URL}/api/agent/mcp
  For Diffuse account holders to drive their OWN account (create projects, add inputs,
  generate and read outputs). Mint a token in the app under Settings → AI agent access,
  then send it as "Authorization: Bearer <token>".
- Sitemap: ${BASE_URL}/sitemap.xml

## Notes
- The read-only MCP server returns facts about the Diffuse product, not user data.
- The authenticated agent MCP only ever accesses the token owner's own account.
- Diffuse discloses AI use in production. AI does the labor of transcribing and drafting. People keep editorial judgment and verify what is true.
`

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
