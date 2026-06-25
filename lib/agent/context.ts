/**
 * Shared helpers for agent MCP tools: deriving the authenticated identity from the
 * verified token, scope enforcement, and uniform tool results.
 *
 * The userId is ALWAYS taken from the verified token (authInfo.extra), never from a
 * tool input — this is the per-user isolation boundary for the agent path.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { AgentScope } from '@/lib/auth/pat'

export type AgentErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'server'

export class AgentError extends Error {
  constructor(public kind: AgentErrorKind, message: string) {
    super(message)
    this.name = 'AgentError'
  }
}

export interface AgentIdentity {
  userId: string
  tokenId: string
  scopes: string[]
}

/** Tool callback `extra` shape we rely on (mcp-handler passes authInfo through). */
interface ToolExtra {
  authInfo?: AuthInfo
}

/** Derive the authenticated identity. Throws if the token did not resolve to a user. */
export function getAgentIdentity(extra: ToolExtra | undefined): AgentIdentity {
  const authInfo = extra?.authInfo
  const extraData = (authInfo?.extra ?? {}) as Record<string, unknown>
  const userId = extraData.userId
  const tokenId = extraData.tokenId
  if (!authInfo || typeof userId !== 'string' || userId.length === 0) {
    throw new AgentError('unauthorized', 'Missing or invalid authentication')
  }
  return {
    userId,
    tokenId: typeof tokenId === 'string' && tokenId ? tokenId : userId,
    scopes: Array.isArray(authInfo.scopes) ? authInfo.scopes : [],
  }
}

/** Enforce that the granting token carries a scope. Read tools require mcp:read, writes mcp:write. */
export function assertScope(identity: AgentIdentity, scope: AgentScope): void {
  if (!identity.scopes.includes(scope)) {
    throw new AgentError('forbidden', `This token does not have the '${scope}' scope`)
  }
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

export function toolText(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

export function toolJson(value: unknown): ToolResult {
  return toolText(JSON.stringify(value, null, 2))
}

export function toolError(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e)
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

/**
 * Wrap a tool handler so identity extraction and error formatting are uniform.
 * The inner function receives the parsed args and the authenticated identity.
 */
export function defineTool<A>(
  fn: (args: A, identity: AgentIdentity) => Promise<ToolResult>
): (args: A, extra: ToolExtra) => Promise<ToolResult> {
  return async (args, extra) => {
    try {
      const identity = getAgentIdentity(extra)
      return await fn(args, identity)
    } catch (e) {
      return toolError(e)
    }
  }
}
