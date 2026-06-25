/**
 * Authenticated WRITE (+read) MCP server for Diffuse.
 *
 * Lets a logged-in Diffuse user drive their OWN account from an AI agent: create
 * projects, add inputs, trigger the context-to-publication generation, and read back
 * their own projects/outputs. Separate from the public read MCP at /api/mcp so the
 * auth boundary is physical, not a per-tool conditional.
 *
 * Auth: Personal Access Token (Bearer) verified by lib/auth/pat.ts via withMcpAuth.
 * Every tool derives the userId from the verified token only (never from input) and
 * all DB access goes through the strictly-scoped lib/agent/data layer.
 *
 * Endpoint (basePath '/api/agent' + the [transport] segment): /api/agent/mcp
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { verifyPat } from '@/lib/auth/pat'
import { assertScope, defineTool, toolJson, AgentError } from '@/lib/agent/context'
import { rateLimitHourly, getMonthlyUnits } from '@/lib/agent/usage'
import * as data from '@/lib/agent/data'
import { triggerAgentGeneration, MONTHLY_ARTICLE_LIMIT } from '@/lib/workflow/run'
import { sanitizeString } from '@/lib/security/validation'

export const runtime = 'nodejs'
export const maxDuration = 300

// Per-user hourly write caps (durable, keyed on the authenticated userId — see lib/agent/usage).
const LIMITS = {
  create_project: 30,
  add_text_input: 120,
  generate_output: 20,
} as const

const FREE_TEXT_MAX = 2000
const INPUT_CONTENT_MAX = 100_000

const handler = createMcpHandler(
  (server) => {
    // ---- Reads -------------------------------------------------------------
    server.registerTool(
      'whoami',
      {
        title: 'Who am I',
        description:
          'Return the authenticated Diffuse account (id, email, plan), the granting token\'s scopes, ' +
          'and remaining monthly article quota for Contractor Pro. Useful to confirm a token works.',
        inputSchema: {}, // empty schema → callback receives (args, extra), matching defineTool
      },
      defineTool<Record<string, never>>(async (_args, id) => {
        assertScope(id, 'mcp:read')
        const profile = await data.getProfile(id.userId)
        let remainingArticles: number | null = null
        if (profile.subscriptionTier === 'contractor_pro') {
          const used = await getMonthlyUnits(id.userId, 'article_units')
          remainingArticles = Math.max(0, MONTHLY_ARTICLE_LIMIT - used)
        }
        return toolJson({
          user_id: profile.userId,
          email: profile.email,
          full_name: profile.fullName,
          subscription_tier: profile.subscriptionTier,
          token_scopes: id.scopes,
          remaining_articles_this_month: remainingArticles,
        })
      })
    )

    server.registerTool(
      'list_projects',
      {
        title: 'List my projects',
        description: 'List the projects you own (newest first). Supports filtering and keyset pagination via cursor.',
        inputSchema: {
          status: z.enum(['active', 'archived', 'draft']).optional(),
          project_type: z.enum(['project', 'advertisement']).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().optional().describe('created_at of the last item from the previous page'),
        },
      },
      defineTool<{ status?: 'active' | 'archived' | 'draft'; project_type?: 'project' | 'advertisement'; limit?: number; cursor?: string }>(
        async (args, id) => {
          assertScope(id, 'mcp:read')
          const result = await data.listProjects(id.userId, {
            status: args.status,
            projectType: args.project_type,
            limit: args.limit,
            cursor: args.cursor,
          })
          return toolJson(result)
        }
      )
    )

    server.registerTool(
      'get_project',
      {
        title: 'Get one of my projects',
        description: 'Fetch a project you own with its inputs (content previews) and a list of its outputs.',
        inputSchema: { project_id: z.string().uuid() },
      },
      defineTool<{ project_id: string }>(async (args, id) => {
        assertScope(id, 'mcp:read')
        const project = await data.requireOwnedProject(id.userId, args.project_id)
        const [inputs, outputs] = await Promise.all([
          data.listInputs(id.userId, args.project_id),
          data.listOutputs(id.userId, args.project_id),
        ])
        return toolJson({ project, inputs, outputs })
      })
    )

    server.registerTool(
      'list_inputs',
      {
        title: 'List a project\'s inputs',
        description: 'List the inputs for a project you own (type, file name, content preview).',
        inputSchema: { project_id: z.string().uuid() },
      },
      defineTool<{ project_id: string }>(async (args, id) => {
        assertScope(id, 'mcp:read')
        return toolJson(await data.listInputs(id.userId, args.project_id))
      })
    )

    server.registerTool(
      'list_outputs',
      {
        title: 'List a project\'s outputs',
        description:
          'List the outputs for a project you own, with workflow_status (pending|processing|completed|failed). ' +
          'Poll this after generate_output.',
        inputSchema: {
          project_id: z.string().uuid(),
          status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
        },
      },
      defineTool<{ project_id: string; status?: 'pending' | 'processing' | 'completed' | 'failed' }>(async (args, id) => {
        assertScope(id, 'mcp:read')
        return toolJson(await data.listOutputs(id.userId, args.project_id, args.status))
      })
    )

    server.registerTool(
      'get_output',
      {
        title: 'Get one output',
        description: 'Fetch a single output in full (content, structured_data, status, cover image) for an output you own.',
        inputSchema: { output_id: z.string().uuid() },
      },
      defineTool<{ output_id: string }>(async (args, id) => {
        assertScope(id, 'mcp:read')
        const output = await data.getOutputForUser(id.userId, args.output_id)
        if (!output) throw new AgentError('not_found', 'Output not found or you do not own it')
        return toolJson(output)
      })
    )

    // ---- Writes ------------------------------------------------------------
    server.registerTool(
      'create_project',
      {
        title: 'Create a project',
        description:
          'Create a new private project owned by you. Visibility is always private; publishing stays a deliberate action in the Diffuse app.',
        inputSchema: {
          name: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          project_type: z.enum(['project', 'advertisement']).optional(),
        },
      },
      defineTool<{ name: string; description?: string; project_type?: 'project' | 'advertisement' }>(async (args, id) => {
        assertScope(id, 'mcp:write')
        if (!(await rateLimitHourly(id.userId, 'create_project', LIMITS.create_project))) {
          throw new AgentError('rate_limited', 'Hourly project-creation limit reached. Try again later.')
        }
        const name = sanitizeString(args.name, 200)
        if (!name) throw new AgentError('bad_request', 'Project name cannot be empty')
        const description = args.description ? sanitizeString(args.description, 2000) : undefined
        const project = await data.createProject(id.userId, { name, description, projectType: args.project_type })
        return toolJson(project)
      })
    )

    server.registerTool(
      'add_text_input',
      {
        title: 'Add a text input',
        description:
          'Add a text input (source material / context) to a project you own. This is the primary way to feed an agent\'s research into Diffuse before generating.',
        inputSchema: {
          project_id: z.string().uuid(),
          content: z.string().min(1).max(INPUT_CONTENT_MAX),
          title: z.string().max(200).optional(),
        },
      },
      defineTool<{ project_id: string; content: string; title?: string }>(async (args, id) => {
        assertScope(id, 'mcp:write')
        if (!(await rateLimitHourly(id.userId, 'add_text_input', LIMITS.add_text_input))) {
          throw new AgentError('rate_limited', 'Hourly input limit reached. Try again later.')
        }
        const content = sanitizeString(args.content, INPUT_CONTENT_MAX)
        if (!content) throw new AgentError('bad_request', 'Input content cannot be empty')
        const title = args.title ? sanitizeString(args.title, 200) : undefined
        const input = await data.addTextInput(id.userId, args.project_id, { content, title })
        return toolJson(input)
      })
    )

    server.registerTool(
      'generate_output',
      {
        title: 'Generate output',
        description:
          'Run the Diffuse context-to-publication workflow on a project you own. Returns a pending output_id immediately; ' +
          'poll list_outputs / get_output until workflow_status is completed. This consumes generation quota.',
        inputSchema: {
          project_id: z.string().uuid(),
          output_type: z.enum(['article', 'ad']).optional(),
          mode: z.enum(['quick', 'refine']).optional(),
          tone: z.string().max(FREE_TEXT_MAX).optional(),
          length: z.string().max(FREE_TEXT_MAX).optional(),
          audience: z.string().max(FREE_TEXT_MAX).optional(),
          comments: z.string().max(FREE_TEXT_MAX).optional(),
          number_of_outputs: z.number().int().min(2).max(5).optional(),
          article_topics: z.string().max(1000).optional(),
        },
      },
      defineTool<{
        project_id: string
        output_type?: 'article' | 'ad'
        mode?: 'quick' | 'refine'
        tone?: string
        length?: string
        audience?: string
        comments?: string
        number_of_outputs?: number
        article_topics?: string
      }>(async (args, id) => {
        assertScope(id, 'mcp:write')
        // Strict ownership before anything expensive.
        await data.requireOwnedProject(id.userId, args.project_id)
        if (!(await rateLimitHourly(id.userId, 'generate_output', LIMITS.generate_output))) {
          throw new AgentError('rate_limited', 'Hourly generation limit reached. Try again later.')
        }
        const clean = (s?: string, max = FREE_TEXT_MAX) => (s ? sanitizeString(s, max) || undefined : undefined)
        const { outputId } = await triggerAgentGeneration({
          userId: id.userId,
          projectId: args.project_id,
          params: {
            outputType: args.output_type ?? 'article',
            mode: args.mode,
            tone: clean(args.tone),
            length: clean(args.length),
            audience: clean(args.audience),
            comments: clean(args.comments),
            numberOfOutputs: args.number_of_outputs,
            articleTopics: clean(args.article_topics, 1000),
          },
        })
        return toolJson({
          output_id: outputId,
          workflow_status: 'pending',
          message: 'Generation started. Poll list_outputs or get_output until workflow_status is "completed".',
        })
      })
    )
  },
  {
    serverInfo: { name: 'diffuse-agent', version: '1.0.0' },
  },
  {
    basePath: '/api/agent',
    maxDuration: 300,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
)

// Require a valid Personal Access Token on every request. Unauthenticated requests
// get 401 + WWW-Authenticate pointing at the protected-resource metadata.
const authHandler = withMcpAuth(handler, verifyPat, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource/api/agent',
})

// Claude.ai's connector UI cannot send custom headers — it only supports OAuth fields.
// If a ?token= query param is present and no Authorization header is set, lift it into
// the header so withMcpAuth sees a proper Bearer token and never returns a 401 that
// triggers Claude.ai's OAuth discovery flow.
async function routeHandler(req: Request, ctx: unknown) {
  try {
    const url = new URL(req.url)
    const queryToken = url.searchParams.get('token')
    if (queryToken && !req.headers.get('authorization')) {
      const patched = new Headers(req.headers)
      patched.set('authorization', `Bearer ${queryToken}`)
      return authHandler(new Request(req, { headers: patched }), ctx)
    }
  } catch {
    // unparseable URL — fall through to normal handler
  }
  return authHandler(req, ctx)
}

export { routeHandler as GET, routeHandler as POST }
