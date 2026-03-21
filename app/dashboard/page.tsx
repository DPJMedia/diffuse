'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import CreateProjectModal from '@/components/dashboard/CreateProjectModal'
import EmptyState from '@/components/dashboard/EmptyState'
import { GridPageSkeleton } from '@/components/dashboard/Skeletons'
import type { DiffuseProject } from '@/types/database'

type SubscriptionTier = 'free' | 'pro' | 'pro_max'

interface OrgInfo {
  id: string
  name: string
}

interface ProjectWithCounts extends DiffuseProject {
  input_count: number
  output_count: number
  creator_name?: string
  orgs?: OrgInfo[]
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, currentWorkspace, loading: authLoading } = useAuth()
  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [totalCountForLimit, setTotalCountForLimit] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>('free')
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const supabase = createClient()

  // Load view preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('projectsViewMode')
    if (saved === 'list' || saved === 'grid') setViewMode(saved)
  }, [])

  // Save view preference to localStorage
  const toggleViewMode = () => {
    const newMode = viewMode === 'grid' ? 'list' : 'grid'
    setViewMode(newMode)
    localStorage.setItem('projectsViewMode', newMode)
  }

  const subscriptionLimits: Record<SubscriptionTier, number> = {
    free: 3,
    pro: 15,
    pro_max: 40,
  }

  const fetchProjects = useCallback(async () => {
    if (!user) return

    setLoading(true)
    try {
      // Only fetch projects created by this user — shared projects appear under Organizations
      const { data: allProjects, error } = await supabase
        .from('diffuse_projects')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      
      const filteredProjects = allProjects || []
      
      // Projects + advertisements count toward the same limit
      setTotalCountForLimit(filteredProjects.length)

      // Filter out advertisements client-side (handles NULL project_type correctly)
      const projectsData = filteredProjects.filter(
        p => p.project_type !== 'advertisement'
      )

      if (!projectsData || projectsData.length === 0) {
        setProjects([])
        return
      }

      // Extract unique IDs for batch queries
      const projectIds = projectsData.map(p => p.id)
      const creatorIds = [...new Set(projectsData.map(p => p.created_by).filter(Boolean))]
      const allOrgIds = [...new Set(projectsData.flatMap(p => p.visible_to_orgs || []).filter(Boolean))]

      // Batch fetch all data in parallel (5 queries instead of 4N queries)
      const [inputsResult, outputsResult, creatorsResult, orgsResult] = await Promise.all([
        // Get all inputs for all projects
        projectIds.length > 0
          ? supabase
              .from('diffuse_project_inputs')
              .select('project_id')
              .in('project_id', projectIds)
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
        // Get all outputs for all projects
        projectIds.length > 0
          ? supabase
              .from('diffuse_project_outputs')
              .select('project_id')
              .in('project_id', projectIds)
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
        // Get all creator profiles
        creatorIds.length > 0
          ? supabase
              .from('user_profiles')
              .select('id, full_name')
              .in('id', creatorIds)
          : Promise.resolve({ data: [], error: null }),
        // Get all workspace names
        allOrgIds.length > 0
          ? supabase
              .from('diffuse_workspaces')
              .select('id, name')
              .in('id', allOrgIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      // Create lookup maps for fast access
      const inputCounts = new Map<string, number>()
      const outputCounts = new Map<string, number>()
      const creatorNames = new Map<string, string>()
      const orgNames = new Map<string, { id: string; name: string }>()

      // Count inputs per project
      const inputsData = inputsResult.data || []
      inputsData.forEach((input: { project_id: string }) => {
        inputCounts.set(input.project_id, (inputCounts.get(input.project_id) || 0) + 1)
      })

      // Count outputs per project
      const outputsData = outputsResult.data || []
      outputsData.forEach((output: { project_id: string }) => {
        outputCounts.set(output.project_id, (outputCounts.get(output.project_id) || 0) + 1)
      })

      // Map creator names
      const creatorsData = creatorsResult.data || []
      creatorsData.forEach((creator: { id: string; full_name: string | null }) => {
        creatorNames.set(creator.id, creator.full_name || 'Unknown')
      })

      // Map org names
      const orgsData = orgsResult.data || []
      orgsData.forEach((org: { id: string; name: string }) => {
        orgNames.set(org.id, { id: org.id, name: org.name })
      })

      // Assemble the final data
      const projectsWithCounts: ProjectWithCounts[] = projectsData.map(project => ({
        ...project,
        input_count: inputCounts.get(project.id) || 0,
        output_count: outputCounts.get(project.id) || 0,
        creator_name: creatorNames.get(project.created_by) || 'Unknown',
        orgs: (project.visible_to_orgs || [])
          .map((orgId: string) => orgNames.get(orgId))
          .filter(Boolean) as OrgInfo[],
      }))
      
      setProjects(projectsWithCounts)
    } catch (error) {
      console.error('Error fetching projects:', error)
    } finally {
      setLoading(false)
    }
  }, [user, supabase])

  const fetchUserProfile = useCallback(async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('subscription_tier')
        .eq('id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.warn('user_profiles table not found, using default tier')
        return
      }

      if (data) {
        setSubscriptionTier(data.subscription_tier)
      }
    } catch (error) {
      console.error('Error fetching user profile:', error)
    }
  }, [user, supabase])

  useEffect(() => {
    if (user) {
      fetchProjects()
      fetchUserProfile()
    }
  }, [user, fetchProjects, fetchUserProfile])

  // Supabase Realtime subscriptions for instant updates
  useEffect(() => {
    if (!user) return

    // Subscribe to project changes
    const projectsChannel = supabase
      .channel('projects-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_projects',
        },
        () => {
          // Refetch projects when any change occurs
          fetchProjects()
        }
      )
      .subscribe()

    // Subscribe to input changes (for counts)
    const inputsChannel = supabase
      .channel('inputs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_project_inputs',
        },
        () => {
          fetchProjects()
        }
      )
      .subscribe()

    // Subscribe to output changes (for counts)
    const outputsChannel = supabase
      .channel('outputs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_project_outputs',
        },
        () => {
          fetchProjects()
        }
      )
      .subscribe()

    // Cleanup subscriptions on unmount
    return () => {
      supabase.removeChannel(projectsChannel)
      supabase.removeChannel(inputsChannel)
      supabase.removeChannel(outputsChannel)
    }
  }, [user, supabase, fetchProjects])

  const toggleSelectProject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitEditMode = () => {
    setIsEditMode(false)
    setSelectedIds(new Set())
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} project${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return

    setIsDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      for (const id of ids) {
        await supabase.from('diffuse_project_inputs').delete().eq('project_id', id)
        await supabase.from('diffuse_project_outputs').delete().eq('project_id', id)
        await supabase.from('diffuse_projects').delete().eq('id', id)
      }
      exitEditMode()
      fetchProjects()
    } catch (error) {
      console.error('Error bulk deleting projects:', error)
      alert('Failed to delete some projects')
    } finally {
      setIsDeleting(false)
    }
  }

  if (authLoading || !user) {
    return <GridPageSkeleton />
  }

  const projectLimit = subscriptionLimits[subscriptionTier]
  const hasReachedLimit = totalCountForLimit >= projectLimit

  const CreateProjectButton = ({ className = '' }: { className?: string }) => (
    <button
      onClick={() => {
        if (hasReachedLimit) {
          router.push('/dashboard/subscription')
          return
        }
        setShowCreateModal(true)
      }}
      data-walkthrough="create-project"
      className={`btn-primary px-4 py-2 flex items-center justify-center gap-2 text-body-sm ${className}`}
    >
      {hasReachedLimit ? (
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
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 data-walkthrough="page-title" className="text-display-sm text-secondary-white">Projects</h1>
        {/* Desktop buttons - hidden on mobile */}
        <div className="hidden md:flex items-center gap-3">
          {isEditMode ? (
            <>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || isDeleting}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isDeleting ? 'Deleting...' : `Delete${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
              </button>
              <button
                onClick={exitEditMode}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-medium-gray hover:bg-white/10 transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </>
          ) : (
            <>
              {projects.length > 0 && (
                <>
                  <button
                    onClick={() => setIsEditMode(true)}
                    className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-glass-sm border border-white/20 text-secondary-white hover:bg-white/10 transition-colors"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={toggleViewMode}
                    className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-glass-sm border border-white/20 text-secondary-white hover:bg-white/10 transition-colors"
                    title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                  >
                    {viewMode === 'grid' ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                    )}
                  </button>
                </>
              )}
              <CreateProjectButton className="flex" />
            </>
          )}
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <GridPageSkeleton showHeader={false} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={
            <svg
              className="w-16 h-16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          }
          title="No Projects Yet"
          description="Create your first project to start processing inputs and generating articles with Diffuse."
        />
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4' : 'flex flex-col gap-3'}>
          {/* Mobile buttons - full width at top of grid, hidden on desktop */}
          {!isEditMode ? (
            <CreateProjectButton className="md:hidden col-span-1" />
          ) : (
            <div className="md:hidden col-span-1 flex gap-2">
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || isDeleting}
                className="flex-1 px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isDeleting ? 'Deleting...' : `Delete${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
              </button>
              <button
                onClick={exitEditMode}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-medium-gray hover:bg-white/10 transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </div>
          )}
          {projects.map((project) => {
            const isSelected = selectedIds.has(project.id)
            
            if (viewMode === 'list') {
              // List view: compact horizontal layout
              return (
                <div
                  key={project.id}
                  onClick={() => isEditMode ? toggleSelectProject(project.id) : router.push(`/dashboard/projects/${project.id}`)}
                  className={`glass-container p-4 transition-colors cursor-pointer flex items-center gap-4 ${
                    isEditMode
                      ? isSelected
                        ? 'bg-cosmic-orange/10 border-cosmic-orange/50 hover:bg-cosmic-orange/15'
                        : 'hover:bg-white/5'
                      : 'hover:bg-white/10'
                  }`}
                >
                  {/* Selection checkbox in edit mode */}
                  {isEditMode && (
                    <div className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      isSelected ? 'bg-cosmic-orange border-cosmic-orange' : 'border-white/30 bg-transparent'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}
                  
                  {/* Project icon */}
                  <div className="flex-shrink-0 w-10 h-10 bg-white/5 rounded-glass flex items-center justify-center">
                    <svg className="w-5 h-5 text-cosmic-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  
                  {/* Project info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body-md text-secondary-white font-medium truncate mb-1">
                      {project.name}
                    </h3>
                    <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider flex-wrap">
                      <span className="text-accent-purple">{project.input_count} INPUT{project.input_count !== 1 ? 'S' : ''}</span>
                      <span>•</span>
                      <span className="text-cosmic-orange">{project.output_count} OUTPUT{project.output_count !== 1 ? 'S' : ''}</span>
                      <span>•</span>
                      <span>{new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</span>
                    </div>
                  </div>
                  
                  {/* Status badge */}
                  <div className="flex-shrink-0 text-caption text-medium-gray uppercase tracking-wider px-2 py-1 bg-white/5 rounded">
                    {project.orgs && project.orgs.length > 0 ? 'PUBLIC' : 'PRIVATE'}
                  </div>
                  
                  {/* Arrow */}
                  {!isEditMode && (
                    <svg className="w-5 h-5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              )
            }
            
            // Grid view: original card layout
            return (
              <div
                key={project.id}
                onClick={() => isEditMode ? toggleSelectProject(project.id) : router.push(`/dashboard/projects/${project.id}`)}
                className={`glass-container p-6 transition-colors cursor-pointer relative ${
                  isEditMode
                    ? isSelected
                      ? 'bg-cosmic-orange/10 border-cosmic-orange/50 hover:bg-cosmic-orange/15'
                      : 'hover:bg-white/5'
                    : 'hover:bg-white/10'
                }`}
              >
                {/* Selection checkbox in edit mode */}
                {isEditMode && (
                  <div className={`absolute top-4 right-4 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    isSelected ? 'bg-cosmic-orange border-cosmic-orange' : 'border-white/30 bg-transparent'
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )}
                {/* Project Name */}
                <h3 className={`text-body-md text-secondary-white font-medium mb-4 ${isEditMode ? 'pr-8' : ''}`}>
                  {project.name}
                </h3>
                
                {/* Details */}
                <div className="space-y-2">
                  {/* Inputs & Outputs */}
                  <div className="flex items-center gap-2">
                    <span 
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isEditMode) router.push(`/dashboard/projects/${project.id}?tab=inputs`)
                      }}
                      className={`text-caption text-accent-purple uppercase tracking-wider transition-colors ${!isEditMode ? 'hover:text-accent-purple/70 cursor-pointer' : ''}`}
                    >
                      {project.input_count} INPUT{project.input_count !== 1 ? 'S' : ''}
                    </span>
                    <span className="text-caption text-medium-gray">•</span>
                    <span 
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isEditMode) router.push(`/dashboard/projects/${project.id}?tab=outputs`)
                      }}
                      className={`text-caption text-cosmic-orange uppercase tracking-wider transition-colors ${!isEditMode ? 'hover:text-orange-300 cursor-pointer' : ''}`}
                    >
                      {project.output_count} OUTPUT{project.output_count !== 1 ? 'S' : ''}
                    </span>
                  </div>
                  
                  {/* Created By & Date */}
                  <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider">
                    <span>CREATED BY: {project.creator_name}</span>
                    <span>•</span>
                    <span>{new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
                  </div>
                  
                  {/* Access */}
                  <div className="text-caption text-medium-gray uppercase tracking-wider">
                    {project.orgs && project.orgs.length > 0 ? 'PUBLIC' : 'PRIVATE'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <CreateProjectModal
          workspaceId={currentWorkspace?.id || null}
          projectType="project"
          onClose={() => setShowCreateModal(false)}
          onSuccess={fetchProjects}
        />
      )}
    </div>
  )
}
