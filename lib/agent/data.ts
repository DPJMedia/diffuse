/**
 * Scoped data-access layer for the agent MCP.
 *
 * Every function takes the authenticated `userId` (derived from the verified token,
 * never from tool input) and forces a `created_by = userId` filter / strict ownership
 * check. The agent path uses the service-role client (which bypasses RLS), so THESE
 * EXPLICIT CHECKS ARE THE PRIMARY ISOLATION BOUNDARY — not RLS.
 *
 * This module (plus lib/auth/pat.ts and lib/agent/usage.ts) is the contained home for
 * the admin client on the agent path. Tool code under app/api/agent/** must never
 * import createAdminClient directly (enforced by ESLint); it must call these helpers.
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AgentError } from '@/lib/agent/context'

export function getServiceClient(): SupabaseClient {
  const admin = createAdminClient()
  if (!admin) {
    throw new AgentError('server', 'Server is not configured for agent access')
  }
  return admin
}

export interface AgentProfile {
  userId: string
  email: string | null
  fullName: string | null
  subscriptionTier: string
}

export async function getProfile(userId: string): Promise<AgentProfile> {
  const db = getServiceClient()
  const { data: profile } = await db
    .from('user_profiles')
    .select('full_name, subscription_tier')
    .eq('id', userId)
    .maybeSingle()

  let email: string | null = null
  try {
    const { data } = await db.auth.admin.getUserById(userId)
    email = data?.user?.email ?? null
  } catch {
    /* email is best-effort */
  }

  return {
    userId,
    email,
    fullName: (profile?.full_name as string | null) ?? null,
    subscriptionTier: (profile?.subscription_tier as string | undefined) ?? 'free',
  }
}

export interface ListProjectsOpts {
  status?: 'active' | 'archived' | 'draft'
  projectType?: 'project' | 'advertisement'
  limit?: number
  cursor?: string // created_at ISO of the last item from the previous page
}

export async function listProjects(userId: string, opts: ListProjectsOpts = {}) {
  const db = getServiceClient()
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)
  let q = db
    .from('diffuse_projects')
    .select('id, name, description, status, visibility, project_type, created_at, updated_at')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (opts.status) q = q.eq('status', opts.status)
  if (opts.projectType) q = q.eq('project_type', opts.projectType)
  if (opts.cursor) q = q.lt('created_at', opts.cursor)

  const { data, error } = await q
  if (error) throw new AgentError('server', `Could not list projects: ${error.message}`)
  const projects = data ?? []
  const nextCursor = projects.length === limit ? projects[projects.length - 1].created_at : null
  return { projects, nextCursor }
}

/** Returns the project ONLY if the user strictly owns it (created_by === userId); else null. */
export async function getProjectForUser(userId: string, projectId: string) {
  const db = getServiceClient()
  const { data, error } = await db
    .from('diffuse_projects')
    .select('id, name, description, status, visibility, project_type, workspace_id, created_by, created_at, updated_at')
    .eq('id', projectId)
    .eq('created_by', userId)
    .maybeSingle()
  if (error) throw new AgentError('server', `Could not load project: ${error.message}`)
  return data ?? null
}

/** Throws not_found if the user does not strictly own the project. */
export async function requireOwnedProject(userId: string, projectId: string) {
  const project = await getProjectForUser(userId, projectId)
  if (!project) {
    throw new AgentError('not_found', 'Project not found or you do not own it')
  }
  return project
}

export async function listInputs(userId: string, projectId: string) {
  await requireOwnedProject(userId, projectId)
  const db = getServiceClient()
  const { data, error } = await db
    .from('diffuse_project_inputs')
    .select('id, type, content, file_name, created_at')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new AgentError('server', `Could not list inputs: ${error.message}`)
  return (data ?? []).map((i) => ({
    id: i.id,
    type: i.type,
    file_name: i.file_name,
    content_preview: typeof i.content === 'string' ? i.content.slice(0, 280) : null,
    created_at: i.created_at,
  }))
}

export async function listOutputs(
  userId: string,
  projectId: string,
  status?: 'pending' | 'processing' | 'completed' | 'failed'
) {
  await requireOwnedProject(userId, projectId)
  const db = getServiceClient()
  let q = db
    .from('diffuse_project_outputs')
    .select('id, output_type, workflow_status, cover_photo_path, created_at, updated_at')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('workflow_status', status)
  const { data, error } = await q
  if (error) throw new AgentError('server', `Could not list outputs: ${error.message}`)
  return data ?? []
}

/** Returns the output ONLY if it belongs to a project the user owns; else null. */
export async function getOutputForUser(userId: string, outputId: string) {
  const db = getServiceClient()
  const { data: output, error } = await db
    .from('diffuse_project_outputs')
    .select('id, project_id, output_type, content, structured_data, workflow_status, workflow_metadata, cover_photo_path, created_at, updated_at')
    .eq('id', outputId)
    .maybeSingle()
  if (error) throw new AgentError('server', `Could not load output: ${error.message}`)
  if (!output) return null
  const project = await getProjectForUser(userId, output.project_id)
  if (!project) return null // owned-check: output's project must be the user's
  return output
}

export async function createProject(
  userId: string,
  args: { name: string; description?: string; projectType?: 'project' | 'advertisement' }
) {
  const db = getServiceClient()
  const { data, error } = await db
    .from('diffuse_projects')
    .insert({
      name: args.name,
      description: args.description ?? null,
      project_type: args.projectType ?? 'project',
      visibility: 'private', // publishing stays a deliberate human action
      status: 'active',
      created_by: userId, // forced — never from input
    })
    .select('id, name, description, status, visibility, project_type, created_at')
    .single()
  if (error) throw new AgentError('server', `Could not create project: ${error.message}`)
  return data
}

export async function addTextInput(
  userId: string,
  projectId: string,
  args: { content: string; title?: string }
) {
  await requireOwnedProject(userId, projectId)
  const db = getServiceClient()
  const { data, error } = await db
    .from('diffuse_project_inputs')
    .insert({
      project_id: projectId,
      type: 'text',
      content: args.content,
      file_name: args.title ?? 'Agent text input',
      metadata: { source: 'mcp_agent' },
      created_by: userId, // forced — never from input
    })
    .select('id, type, file_name, created_at')
    .single()
  if (error) throw new AgentError('server', `Could not add input: ${error.message}`)
  return data
}
