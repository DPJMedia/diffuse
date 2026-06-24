/**
 * Read-only MCP server for Diffuse.
 *
 * Exposes clean, structured facts ABOUT the Diffuse product (overview, how it
 * works, features, FAQ, use cases) so an AI agent researching Diffuse on behalf
 * of a reader gets accurate information instead of scraping the marketing page.
 *
 * Streamable HTTP transport, no authentication, stateless. All tools read from
 * lib/content/diffuse.ts, which is also the source of truth for the landing page
 * and llms.txt, so what agents are told can never drift from what the site says.
 *
 * Endpoint (basePath '/api' + the [transport] segment): https://www.diffuse.press/api/mcp
 *
 * Next steps to consider later: MCP Server Cards and WebMCP are emerging ways to
 * advertise this server to clients. Not required for launch.
 */

import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'
import { overview, tagline, howItWorks, features, faqs, useCases } from '@/lib/content/diffuse'

export const runtime = 'nodejs'
export const maxDuration = 60

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'get_overview',
      {
        title: 'Get Diffuse overview',
        description:
          'What Diffuse is and how it is positioned: a context-to-publication system ' +
          'for local news with a human verification layer.',
      },
      async () => ({
        content: [{ type: 'text', text: `${tagline}\n\n${overview}` }],
      })
    )

    server.registerTool(
      'how_it_works',
      {
        title: 'How Diffuse works',
        description: 'The ordered steps of the Diffuse workflow, from raw material to verified, published story.',
      },
      async () => ({
        content: [
          {
            type: 'text',
            text: howItWorks.map((step, i) => `${i + 1}. ${step.title}: ${step.body}`).join('\n\n'),
          },
        ],
      })
    )

    server.registerTool(
      'get_feature',
      {
        title: 'Get a Diffuse feature',
        description: 'Look up one product feature by its key. Omit the key to list every feature key and title.',
        inputSchema: {
          key: z
            .string()
            .optional()
            .describe('Feature key, for example "agent-readable". Omit to list all available keys.'),
        },
      },
      async ({ key }) => {
        if (!key) {
          return {
            content: [
              {
                type: 'text',
                text:
                  'Available feature keys:\n' +
                  features.map((f) => `- ${f.key}: ${f.title}`).join('\n'),
              },
            ],
          }
        }
        const feature = features.find((f) => f.key === key)
        if (!feature) {
          return {
            content: [{ type: 'text', text: `No feature found for key "${key}".` }],
            isError: true,
          }
        }
        return {
          content: [{ type: 'text', text: `${feature.title}\n\n${feature.description}` }],
        }
      }
    )

    server.registerTool(
      'search_faq',
      {
        title: 'Search the Diffuse FAQ',
        description:
          'Search the frequently asked questions by case-insensitive substring. Omit the query to return every question and answer.',
        inputSchema: {
          query: z.string().optional().describe('Text to match against questions and answers. Omit to return all FAQs.'),
        },
      },
      async ({ query }) => {
        const q = query?.trim().toLowerCase()
        const matches = q
          ? faqs.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q))
          : faqs
        if (matches.length === 0) {
          return { content: [{ type: 'text', text: `No FAQ entries matched "${query}".` }] }
        }
        return {
          content: [
            {
              type: 'text',
              text: matches.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n'),
            },
          ],
        }
      }
    )

    server.registerTool(
      'get_use_cases',
      {
        title: 'Get Diffuse use cases',
        description: 'Real-world use cases, including the Spring-Ford Press live newsroom running on Diffuse.',
      },
      async () => ({
        content: [
          {
            type: 'text',
            text: useCases.map((u) => `${u.name}: ${u.summary}`).join('\n\n'),
          },
        ],
      })
    )
  },
  {
    serverInfo: { name: 'diffuse', version: '1.0.0' },
  },
  {
    basePath: '/api',
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
)

export { handler as GET, handler as POST }
