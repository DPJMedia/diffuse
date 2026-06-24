import { MetadataRoute } from 'next'

// Posture: allow search engines and agents that fetch on behalf of a reader,
// block crawlers that collect pages for AI model training. Search-index and
// on-behalf-of-user agents (Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User,
// Claude-User, PerplexityBot, Perplexity-User) are NOT in this list, so they
// stay allowed via the '*' rule and discoverability is preserved.
const AI_TRAINING_CRAWLERS = [
  'GPTBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'ClaudeBot',
  'anthropic-ai',
  'Bytespider',
  'Meta-ExternalAgent',
  'FacebookBot',
  'cohere-ai',
  'Diffbot',
  'Omgilibot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/login'],
      },
      {
        userAgent: AI_TRAINING_CRAWLERS,
        disallow: '/',
      },
    ],
    sitemap: 'https://www.diffuse.press/sitemap.xml',
  }
}
