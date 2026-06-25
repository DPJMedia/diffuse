/**
 * RFC 9728 protected-resource metadata for the agent MCP.
 *
 * withMcpAuth points the 401 WWW-Authenticate header here. We intentionally do NOT
 * advertise an authorization_servers entry yet: the agent server authenticates with
 * Personal Access Tokens (mint one in Diffuse → Settings → AI agent access), not
 * OAuth. When OAuth one-click login ships, add authorization_servers here and the
 * tool surface stays unchanged.
 */

import { NextResponse } from 'next/server'
import { metadataCorsOptionsRequestHandler } from 'mcp-handler'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return NextResponse.json(
    {
      resource: `${origin}/api/agent/mcp`,
      bearer_methods_supported: ['header'],
      resource_documentation: `${origin}/agent`,
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  )
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
