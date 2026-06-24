# Agent discoverability and AI SEO

How agents and AI search find Diffuse, what is already shipped, and the steps that
still need a human (DNS records, account logins, directory submissions).

## What is already live on diffuse.press

- **MCP server** at `https://www.diffuse.press/api/mcp` (read-only, no auth). Tools:
  `get_overview`, `how_it_works`, `get_feature`, `search_faq`, `get_use_cases`.
  Source of truth: `lib/content/diffuse.ts`.
- **llms.txt** at `https://www.diffuse.press/llms.txt` points agents to the MCP server.
- **JSON-LD** structured data in `app/schema.tsx` (FAQ, Product, Service, HowTo) so AI
  overviews and rich results read the correct, reframed positioning.
- **robots.ts** posture: search engines and on-behalf-of-reader agents are allowed,
  AI training crawlers are blocked. See `app/robots.ts`.

## Important reality check

The MCP server and llms.txt do **not** make Diffuse surface for a cold prompt like
"find me a tool that automates local news." Those are an access layer for agents that
are already pointed at the site. Cold discovery comes from two other places:

1. Search-backed chatbots (ChatGPT search, Claude web search, Perplexity, Google AI
   overviews) -> ordinary SEO plus being cited on third-party pages.
2. Being listed in MCP/connector directories that agents and clients browse.

Everything below targets those two.

## 1. Publish to the official MCP Registry

Manifest is committed as `server.json` (namespace `press.diffuse/diffuse`, remote
streamable-http). Custom-domain namespaces use DNS verification.

```bash
# Install the publisher CLI (macOS)
brew install mcp-publisher

# Generate an Ed25519 keypair and add the printed TXT record to diffuse.press DNS:
#   v=MCPv1; k=ed25519; p=<public-key>
mcp-publisher login dns --domain diffuse.press

# Publish (uses the committed server.json)
mcp-publisher publish

# Verify
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=press.diffuse/diffuse"
```

Needs: access to add a DNS TXT record for diffuse.press. The registry hosts only
metadata, so nothing else needs publishing for a remote server.

## 2. Submit to third-party MCP directories

These accept remote/hosted servers and are browsed by clients and agents:

- PulseMCP — https://www.pulsemcp.com (submit form / crawls public servers)
- mcp.so — https://mcp.so (submit listing)
- Glama — https://glama.ai/mcp/servers (submit)
- Smithery — https://smithery.ai (submit; supports remote servers)

Each needs an account and a short listing (name, description, the `/api/mcp` URL).

## 3. AI SEO / GEO checklist (off-repo, ongoing)

What actually drives "coming up" in search-backed chatbots:

- Get listed in the roundups those chatbots cite ("AI tools for local newsrooms",
  "AI for journalists"). Pitch to those authors and directories.
- Launch surfaces with durable backlinks: Product Hunt, relevant newsletters,
  Hacks/Hackers community posts.
- Keep on-page content indexable and specific. The reframed copy and JSON-LD help,
  but third-party mentions and backlinks move rankings more than on-page tweaks.
- Target the right phrases. The positioning is "verified local coverage" and
  "human in the loop," not "automate." Do not chase "automated news" as a keyword.
- Re-check `app/robots.ts` if a specific AI search engine you want to appear in turns
  out to use a crawler in the training block list (the list is conservative and
  preserves Googlebot, Bingbot, OAI-SearchBot, and PerplexityBot today).

## Porting to Spring-Ford Press

Spring-Ford Press is a separate Next.js + Supabase repo. The same three pieces
(MCP route, llms.txt, JSON-LD) port directly, but there the MCP should expose the
published local-news articles (query Supabase), not product facts.
