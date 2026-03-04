'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import EmptyState from '@/components/dashboard/EmptyState'
import CreateProjectModal from '@/components/dashboard/CreateProjectModal'
import type { DiffuseWorkspace, DiffuseProject, OrganizationPlan } from '@/types/database'

type SubscriptionTier = 'free' | 'pro' | 'pro_max'

const planDetails = {
  enterprise_pro: { name: 'Enterprise Pro', projects: 50, price: '$100/mo' },
  enterprise_pro_max: { name: 'Enterprise Pro Max', projects: 'Unlimited', price: '$500/mo' },
}

// Role hierarchy: owner > admin > editor > viewer
const roleHierarchy = ['viewer', 'editor', 'admin', 'owner'] as const
const roleLabels: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

const getRoleLevel = (role: string) => roleHierarchy.indexOf(role as typeof roleHierarchy[number])
const canEditRole = (currentUserRole: string, targetRole: string) => {
  const currentLevel = getRoleLevel(currentUserRole)
  const targetLevel = getRoleLevel(targetRole)
  return currentLevel > targetLevel
}

interface ProjectWithCounts extends DiffuseProject {
  creator_name?: string
  input_count: number
  output_count: number
}

interface MemberWithDetails {
  user_id: string
  role: string
  name: string
  project_count: number
}

export default function OrganizationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orgId = params.id as string
  const { user, currentWorkspace } = useAuth()
  const [workspace, setWorkspace] = useState<DiffuseWorkspace | null>(null)
  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [members, setMembers] = useState<MemberWithDetails[]>([])
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingPlan, setSavingPlan] = useState(false)
  const [editingOrg, setEditingOrg] = useState(false)
  const [editOrgName, setEditOrgName] = useState('')
  const [editOrgDescription, setEditOrgDescription] = useState('')
  const [copiedCode, setCopiedCode] = useState(false)
  const [editingMemberRole, setEditingMemberRole] = useState<string | null>(null)
  const [savingRole, setSavingRole] = useState(false)
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false)
  const [deletingOrg, setDeletingOrg] = useState(false)
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>('free')
  const [projectCount, setProjectCount] = useState(0)
  const supabase = createClient()

  const subscriptionLimits: Record<SubscriptionTier, number> = {
    free: 3,
    pro: 15,
    pro_max: 40,
  }

  const fetchOrganizationData = useCallback(async () => {
    if (!user || !orgId) return

    setLoading(true)
    try {
      // Fetch workspace details
      const { data: workspaceData, error: workspaceError } = await supabase
        .from('diffuse_workspaces')
        .select('*')
        .eq('id', orgId)
        .single()

      if (workspaceError) throw workspaceError
      setWorkspace(workspaceData)

      // Fetch members of this workspace
      const { data: membersData, error: membersError } = await supabase
        .from('diffuse_workspace_members')
        .select('user_id, role')
        .eq('workspace_id', orgId)

      if (membersError) throw membersError
      
      const memberIds = membersData?.map(m => m.user_id) || []
      
      // Find current user's role (owner takes precedence)
      const isOwner = workspaceData.owner_id === user.id
      const currentUserMember = membersData?.find(m => m.user_id === user.id)
      setUserRole(isOwner ? 'owner' : (currentUserMember?.role || null))

      // Fetch member details (name and project count)
      const membersWithDetails: MemberWithDetails[] = []
      for (const member of membersData || []) {
        // Get user profile
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('full_name')
          .eq('id', member.user_id)
          .single()

        // Get project count for this member that are visible to this org
        const { count: projectCount } = await supabase
          .from('diffuse_projects')
          .select('*', { count: 'exact', head: true })
          .eq('created_by', member.user_id)
          .eq('visibility', 'public')
          .contains('visible_to_orgs', [orgId])

        // Check if this member is the owner
        const memberRole = workspaceData.owner_id === member.user_id ? 'owner' : member.role

        membersWithDetails.push({
          user_id: member.user_id,
          role: memberRole,
          name: profile?.full_name || 'Unknown',
          project_count: projectCount || 0,
        })
      }
      setMembers(membersWithDetails)

      // Fetch projects that are visible to this organization
      if (memberIds.length > 0) {
        const { data: projectsData, error: projectsError } = await supabase
          .from('diffuse_projects')
          .select('*')
          .eq('visibility', 'public')
          .contains('visible_to_orgs', [orgId])
          .order('created_at', { ascending: false })

        if (projectsError) throw projectsError

        // Fetch input/output counts for each project
        const projectsWithCounts: ProjectWithCounts[] = []
        for (const project of projectsData || []) {
          // Get creator name
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('full_name')
            .eq('id', project.created_by)
            .single()

          // Get input/output counts
          const [{ count: inputCount }, { count: outputCount }] = await Promise.all([
            supabase
              .from('diffuse_project_inputs')
              .select('*', { count: 'exact', head: true })
              .eq('project_id', project.id)
              .is('deleted_at', null),
            supabase
              .from('diffuse_project_outputs')
              .select('*', { count: 'exact', head: true })
              .eq('project_id', project.id)
              .is('deleted_at', null),
          ])

          projectsWithCounts.push({
            ...project,
            creator_name: profile?.full_name || undefined,
            input_count: inputCount || 0,
            output_count: outputCount || 0,
          })
        }

        setProjects(projectsWithCounts)
      }
    } catch (error) {
      console.error('Error fetching organization data:', error)
    } finally {
      setLoading(false)
    }
  }, [user, orgId, supabase])

  const fetchLimitData = useCallback(async () => {
    if (!user) return
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('subscription_tier')
        .eq('id', user.id)
        .single()
      if (profile?.subscription_tier) setSubscriptionTier(profile.subscription_tier as SubscriptionTier)

      const orFilter = currentWorkspace
        ? `created_by.eq.${user.id},workspace_id.eq.${currentWorkspace.id}`
        : `created_by.eq.${user.id}`
      const { data: projectsData } = await supabase
        .from('diffuse_projects')
        .select('id, project_type')
        .or(orFilter)
      // Projects + advertisements count toward the same limit
      setProjectCount(new Set((projectsData || []).map(p => p.id)).size)
    } catch (e) {
      console.warn('Limit data fetch failed', e)
    }
  }, [user, currentWorkspace, supabase])

  useEffect(() => {
    fetchOrganizationData()
  }, [fetchOrganizationData])

  useEffect(() => {
    if (user) fetchLimitData()
  }, [user, fetchLimitData])

  const handleChangePlan = async (newPlan: OrganizationPlan) => {
    if (!workspace || userRole !== 'owner') return
    
    setSavingPlan(true)
    try {
      const { error } = await supabase
        .from('diffuse_workspaces')
        .update({ plan: newPlan })
        .eq('id', workspace.id)

      if (error) throw error
      
      setWorkspace({ ...workspace, plan: newPlan })
    } catch (error) {
      console.error('Error updating plan:', error)
      alert('Failed to update plan')
    } finally {
      setSavingPlan(false)
    }
  }

  const handleLeaveOrganization = async () => {
    if (!user || !workspace) return
    
    const confirmLeave = window.confirm(
      `Are you sure you want to leave "${workspace.name}"? You'll lose access to all shared projects.`
    )
    
    if (!confirmLeave) return
    
    try {
      const { error } = await supabase
        .from('diffuse_workspace_members')
        .delete()
        .eq('workspace_id', workspace.id)
        .eq('user_id', user.id)

      if (error) throw error
      
      router.push('/dashboard/organization')
    } catch (error) {
      console.error('Error leaving organization:', error)
      alert('Failed to leave organization')
    }
  }

  const handleDeleteOrganization = async () => {
    if (!user || !workspace || !userRole) return
    
    // Only admins and owners can delete
    if (userRole !== 'admin' && userRole !== 'owner') return
    
    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${workspace.name}"? This action cannot be undone. All members will be removed and all shared projects will become personal projects.`
    )
    
    if (!confirmDelete) return
    
    setDeletingOrg(true)
    try {
      // First, set workspace_id to NULL for all projects in this workspace
      // This converts them to personal projects before deleting the workspace
      const { error: projectsError } = await supabase
        .from('diffuse_projects')
        .update({ workspace_id: null })
        .eq('workspace_id', workspace.id)

      if (projectsError) {
        console.error('Error updating projects:', projectsError)
        // Continue anyway - the workspace deletion will handle it via CASCADE
      }
      
      // Delete the workspace - this will cascade delete members
      const { error: deleteError } = await supabase
        .from('diffuse_workspaces')
        .delete()
        .eq('id', workspace.id)

      if (deleteError) throw deleteError
      
      // Redirect to organizations page
      router.push('/dashboard/organization')
    } catch (error: any) {
      console.error('Error deleting organization:', error)
      alert(`Failed to delete organization: ${error.message || 'Unknown error'}`)
    } finally {
      setDeletingOrg(false)
    }
  }

  const handleEditOrg = () => {
    if (workspace) {
      setEditOrgName(workspace.name)
      setEditOrgDescription(workspace.description || '')
      setEditingOrg(true)
    }
  }

  const handleSaveOrg = async () => {
    if (!workspace) return
    try {
      const { error } = await supabase
        .from('diffuse_workspaces')
        .update({ 
          name: editOrgName,
          description: editOrgDescription || null
        })
        .eq('id', workspace.id)

      if (error) throw error
      setEditingOrg(false)
      fetchOrganizationData()
    } catch (error) {
      console.error('Error saving organization:', error)
      alert('Failed to save organization')
    }
  }

  const handleChangeMemberRole = async (memberId: string, newRole: string) => {
    if (!workspace || !userRole || (userRole !== 'admin' && userRole !== 'owner')) return
    
    setSavingRole(true)
    try {
      console.log('Updating role:', { memberId, newRole, workspaceId: workspace.id })
      
      const { data, error } = await supabase
        .from('diffuse_workspace_members')
        .update({ role: newRole as 'admin' | 'editor' | 'viewer' })
        .eq('workspace_id', workspace.id)
        .eq('user_id', memberId)
        .select()

      console.log('Update result:', { data, error })

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }
      
      setEditingMemberRole(null)
      fetchOrganizationData()
    } catch (error: any) {
      console.error('Error changing member role:', error)
      alert(`Failed to change member role: ${error.message || 'Unknown error'}`)
    } finally {
      setSavingRole(false)
    }
  }

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!workspace || !userRole || (userRole !== 'admin' && userRole !== 'owner')) return
    
    const confirmRemove = window.confirm(
      `Are you sure you want to remove ${memberName} from this organization?`
    )
    
    if (!confirmRemove) return
    
    setSavingRole(true)
    try {
      const { error } = await supabase
        .from('diffuse_workspace_members')
        .delete()
        .eq('workspace_id', workspace.id)
        .eq('user_id', memberId)

      if (error) throw error
      
      setEditingMemberRole(null)
      fetchOrganizationData()
    } catch (error) {
      console.error('Error removing member:', error)
      alert('Failed to remove member')
    } finally {
      setSavingRole(false)
    }
  }

  const handleTransferOwnership = async (newOwnerId: string, newOwnerName: string) => {
    if (!workspace || userRole !== 'owner' || !user) return
    
    const confirmTransfer = window.confirm(
      `Are you sure you want to transfer ownership to ${newOwnerName}? You will be demoted to Admin.`
    )
    
    if (!confirmTransfer) return
    
    setSavingRole(true)
    try {
      // Update the workspace owner_id
      const { error: ownerError } = await supabase
        .from('diffuse_workspaces')
        .update({ owner_id: newOwnerId })
        .eq('id', workspace.id)

      if (ownerError) throw ownerError

      // Demote current owner to admin in members table
      const { error: demoteError } = await supabase
        .from('diffuse_workspace_members')
        .update({ role: 'admin' })
        .eq('workspace_id', workspace.id)
        .eq('user_id', user.id)

      if (demoteError) throw demoteError

      // Promote new owner to admin in members table (their actual role is determined by owner_id)
      const { error: promoteError } = await supabase
        .from('diffuse_workspace_members')
        .update({ role: 'admin' })
        .eq('workspace_id', workspace.id)
        .eq('user_id', newOwnerId)

      if (promoteError) throw promoteError
      
      setEditingMemberRole(null)
      fetchOrganizationData()
      alert(`Ownership transferred to ${newOwnerName}. You are now an Admin.`)
    } catch (error) {
      console.error('Error transferring ownership:', error)
      alert('Failed to transfer ownership')
    } finally {
      setSavingRole(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
          title="Organization Not Found"
          description="This organization doesn't exist or you don't have access to it."
        />
      </div>
    )
  }

  return (
    <div className="overflow-x-hidden">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Link 
            href="/dashboard/organization" 
            className="text-medium-gray hover:text-secondary-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          {editingOrg ? (
            <div className="flex-1 space-y-3">
              <input
                type="text"
                value={editOrgName}
                onChange={(e) => setEditOrgName(e.target.value)}
                className="w-full text-display-sm bg-white/5 border border-white/10 rounded-glass px-4 py-2 text-secondary-white focus:outline-none focus:border-cosmic-orange"
              />
              <textarea
                value={editOrgDescription}
                onChange={(e) => setEditOrgDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full text-body-lg bg-white/5 border border-white/10 rounded-glass px-4 py-2 text-medium-gray focus:outline-none focus:border-cosmic-orange resize-none"
              />
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={handleSaveOrg} className="btn-primary px-4 py-2 text-body-sm w-full sm:w-auto">
                  Save
                </button>
                <button onClick={() => setEditingOrg(false)} className="btn-secondary px-4 py-2 text-body-sm w-full sm:w-auto">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-display-sm text-secondary-white">{workspace.name}</h1>
                {userRole === 'owner' && (
                  <button
                    onClick={handleEditOrg}
                    className="opacity-0 group-hover:opacity-100 text-medium-gray hover:text-cosmic-orange transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </div>
              {workspace.description && (
                <p className="text-body-md text-medium-gray mt-1">
                  {workspace.description}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="glass-container p-4 text-center">
          <p className="text-body-sm text-medium-gray mb-1">Members</p>
          <p className="text-heading-lg text-secondary-white">{members.length}</p>
        </div>
        <div className="glass-container p-4 text-center">
          <p className="text-body-sm text-medium-gray mb-1">Projects</p>
          <p className="text-heading-lg text-secondary-white">{projects.length}</p>
        </div>
        <div className="glass-container p-4 text-center">
          <p className="text-body-sm text-medium-gray mb-1">Invite Code</p>
          {workspace.invite_code ? (
            <button
              onClick={() => {
                navigator.clipboard.writeText(workspace.invite_code || '')
                setCopiedCode(true)
                setTimeout(() => setCopiedCode(false), 2000)
              }}
              className="text-heading-lg text-cosmic-orange hover:text-cosmic-orange/80 transition-colors"
            >
              {copiedCode ? 'Copied!' : workspace.invite_code}
            </button>
          ) : (
            <span className="text-heading-lg text-medium-gray">-</span>
          )}
        </div>
      </div>

      {/* Projects */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-heading-lg text-secondary-white">Projects</h2>
        <button
          onClick={() => {
            const limit = subscriptionLimits[subscriptionTier]
            if (projectCount >= limit) {
              router.push('/dashboard/subscription')
              return
            }
            setShowCreateProjectModal(true)
          }}
          className="btn-primary px-4 py-2 flex items-center gap-2 text-body-sm"
        >
          {projectCount >= subscriptionLimits[subscriptionTier] ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              Upgrade to Increase Project Limit
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Project
            </>
          )}
        </button>
      </div>
      
      {projects.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          }
          title="No Shared Projects"
          description="No projects have been shared with this organization yet."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 mb-12">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => router.push(`/dashboard/projects/${project.id}?returnTo=${encodeURIComponent(`/dashboard/organization/${orgId}`)}`)}
              className="glass-container p-6 hover:bg-white/10 transition-colors cursor-pointer"
            >
              {/* Project Name */}
              <h3 className="text-heading-md text-secondary-white font-medium mb-4">
                {project.name}
              </h3>
              
              {/* Details */}
              <div className="space-y-2">
                {/* Inputs & Outputs */}
                <div className="flex items-center gap-2">
                  <span 
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/dashboard/projects/${project.id}?tab=inputs`)
                    }}
                    className="text-caption text-accent-purple uppercase tracking-wider hover:text-accent-purple/70 cursor-pointer transition-colors"
                  >
                    {project.input_count} INPUT{project.input_count !== 1 ? 'S' : ''}
                  </span>
                  <span className="text-caption text-medium-gray">•</span>
                  <span 
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/dashboard/projects/${project.id}?tab=outputs&returnTo=${encodeURIComponent(`/dashboard/organization/${orgId}`)}`)
                    }}
                    className="text-caption text-cosmic-orange uppercase tracking-wider hover:text-orange-300 cursor-pointer transition-colors"
                  >
                    {project.output_count} OUTPUT{project.output_count !== 1 ? 'S' : ''}
                  </span>
                </div>
                
                {/* Created By & Date */}
                <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider">
                  {project.creator_name && (
                    <>
                      <span>CREATED BY: {project.creator_name}</span>
                      <span>•</span>
                    </>
                  )}
                  <span>{new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Members */}
      <h2 className="text-heading-lg text-secondary-white mb-4">Members</h2>
      
      <div className="glass-container mb-12 relative z-10">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-4 px-6 text-caption text-medium-gray font-medium">NAME</th>
              <th className="text-left py-4 px-6 text-caption text-medium-gray font-medium">PROJECTS</th>
              <th className="text-left py-4 px-6 text-caption text-medium-gray font-medium">ROLE</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isCurrentUser = member.user_id === user?.id
              const isOwner = member.role === 'owner'
              const userCanEdit = userRole && canEditRole(userRole, member.role) && !isCurrentUser && !isOwner
              const isEditingThis = editingMemberRole === member.user_id
              
              // Determine role badge color
              const getRoleBadgeClass = (role: string) => {
                switch (role) {
                  case 'owner':
                    return 'bg-accent-purple/20 text-accent-purple border-accent-purple/30'
                  case 'admin':
                    return 'bg-cosmic-orange/20 text-cosmic-orange border-cosmic-orange/30'
                  case 'editor':
                    return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  default:
                    return 'bg-medium-gray/20 text-medium-gray border-medium-gray/30'
                }
              }
              
              return (
                <tr
                  key={member.user_id}
                  className="border-b border-white/10 last:border-b-0"
                >
                  <td className="py-4 px-6">
                    <p className="text-body-md text-secondary-white font-medium">
                      {member.name}
                      {isCurrentUser && <span className="text-medium-gray ml-2">(you)</span>}
                    </p>
                  </td>
                  <td className="py-4 px-6 text-body-sm text-medium-gray">
                    {member.project_count}
                  </td>
                  <td className="py-4 px-6">
                    {userCanEdit ? (
                      <div className="relative inline-block">
                        <button
                          onClick={() => {
                            if (isEditingThis) {
                              setEditingMemberRole(null)
                            } else {
                              setEditingMemberRole(member.user_id)
                            }
                          }}
                          className={`px-3 py-1 text-caption font-medium rounded-full border transition-colors hover:opacity-80 ${getRoleBadgeClass(member.role)}`}
                        >
                          {roleLabels[member.role] || member.role}
                          <svg className="w-3 h-3 inline-block ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        
                        {/* Dropdown */}
                        {isEditingThis && (
                          <>
                            {/* Backdrop to close on click outside */}
                            <div 
                              className="fixed inset-0 z-[9998]" 
                              onClick={() => setEditingMemberRole(null)}
                            />
                            <div 
                              className="absolute top-full left-0 mt-1 z-[9999] bg-[#0d0d0d] border border-white/20 rounded-lg shadow-2xl w-[160px]"
                            >
                              {['admin', 'editor', 'viewer'].map((role) => {
                                // Only show roles that the current user can assign (below their level)
                                if (userRole && getRoleLevel(userRole) <= getRoleLevel(role) && role !== 'viewer') {
                                  return null
                                }
                                return (
                                  <button
                                    key={role}
                                    onClick={() => handleChangeMemberRole(member.user_id, role)}
                                    disabled={savingRole || member.role === role}
                                    className={`w-full px-4 py-2.5 text-left text-body-sm transition-colors ${
                                      member.role === role
                                        ? 'bg-white/10 text-secondary-white font-medium'
                                        : 'text-secondary-white hover:bg-white/10'
                                    } disabled:opacity-50`}
                                  >
                                    {roleLabels[role]}
                                    {member.role === role && (
                                      <svg className="w-4 h-4 inline-block ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </button>
                                )
                              })}
                              {/* Transfer Ownership option - only for owners */}
                              {userRole === 'owner' && member.role !== 'owner' && (
                                <div className="border-t border-white/10">
                                  <button
                                    onClick={() => handleTransferOwnership(member.user_id, member.name)}
                                    disabled={savingRole}
                                    className="w-full px-4 py-2.5 text-left text-body-sm text-accent-purple hover:bg-accent-purple/10 transition-colors disabled:opacity-50"
                                  >
                                    Transfer Ownership
                                  </button>
                                </div>
                              )}
                              {/* Remove option */}
                              <div className="border-t border-white/10">
                                <button
                                  onClick={() => handleRemoveMember(member.user_id, member.name)}
                                  disabled={savingRole}
                                  className="w-full px-4 py-2.5 text-left text-body-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className={`px-3 py-1 text-caption font-medium rounded-full border ${getRoleBadgeClass(member.role)}`}>
                        {roleLabels[member.role] || member.role}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Settings - Only visible to owner */}
      {userRole === 'owner' && (
        <div>
          <h2 className="text-heading-lg text-secondary-white mb-4">Settings</h2>
          
          {/* Plan Selection */}
          <div className="glass-container p-6">
            <h3 className="text-body-md text-medium-gray mb-4">Organization Plan</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(Object.entries(planDetails) as [OrganizationPlan, typeof planDetails[keyof typeof planDetails]][]).map(([key, plan]) => {
                const isCurrentPlan = workspace.plan === key
                return (
                  <button
                    key={key}
                    onClick={() => handleChangePlan(key)}
                    disabled={savingPlan}
                    className={`p-5 rounded-glass border text-left transition-all ${
                      isCurrentPlan
                        ? 'border-cosmic-orange/30 bg-cosmic-orange/20'
                        : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className={`text-body-lg font-medium ${isCurrentPlan ? 'text-cosmic-orange' : 'text-secondary-white'}`}>
                        {plan.name}
                      </p>
                      {isCurrentPlan && (
                        <span className="px-2.5 py-1 text-caption font-medium rounded-full bg-cosmic-orange/20 text-cosmic-orange border border-cosmic-orange/30">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-body-sm text-medium-gray">
                      {isCurrentPlan ? 'Current plan' : 'Organization plan'}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Leave Organization / Delete Organization */}
      <div className="space-y-4 mt-8">
        {/* Leave Organization */}
        <div className="glass-container p-6 border border-red-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="text-body-md text-secondary-white mb-1">Leave Organization</h3>
              <p className="text-body-sm text-medium-gray break-words">
                Remove yourself from this organization. You&apos;ll lose access to shared projects.
              </p>
            </div>
            <button
              onClick={handleLeaveOrganization}
              className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-glass border border-red-500/30 transition-colors text-body-sm font-medium whitespace-nowrap flex-shrink-0"
            >
              Leave Organization
            </button>
          </div>
        </div>

        {/* Delete Organization - Only for admins/owners */}
        {(userRole === 'admin' || userRole === 'owner') && (
          <div className="glass-container p-6 border border-red-500/30">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex-1 min-w-0 pr-0 sm:pr-4">
                <h3 className="text-body-md text-secondary-white mb-1">Delete Organization</h3>
                <p className="text-body-sm text-medium-gray break-words">
                  Permanently delete this organization. All members will be removed and shared projects will become personal projects. This action cannot be undone.
                </p>
              </div>
              <button
                onClick={handleDeleteOrganization}
                disabled={deletingOrg}
                className="px-4 py-2 bg-red-500/30 hover:bg-red-500/40 text-red-400 rounded-glass border border-red-500/40 transition-colors text-body-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
              >
                {deletingOrg ? 'Deleting...' : 'Delete Organization'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreateProjectModal && workspace && (
        <CreateProjectModal
          workspaceId={workspace.id}
          projectType="project"
          shareWithOrgId={workspace.id}
          shareWithOrgName={workspace.name}
          onClose={() => setShowCreateProjectModal(false)}
          onSuccess={() => {
            setShowCreateProjectModal(false)
            fetchOrganizationData()
          }}
        />
      )}
    </div>
  )
}

