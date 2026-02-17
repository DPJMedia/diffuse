'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import CreateProjectModal from '@/components/dashboard/CreateProjectModal'
import EmptyState from '@/components/dashboard/EmptyState'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
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
  const supabase = createClient()

  const subscriptionLimits: Record<SubscriptionTier, number> = {
    free: 3,
    pro: 15,
    pro_max: 40,
  }

  const fetchProjects = useCallback(async () => {
    if (!user) return

    setLoading(true)
    try {
      // Build base query - only get projects (not advertisements)
      const { data: allProjects, error } = await supabase
        .from('diffuse_projects')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (error) throw error
      
      // Filter for user's projects (created by them or in their workspace)
      let filteredProjects = (allProjects || []).filter(p => {
        const isCreator = p.created_by === user.id
        const isInWorkspace = currentWorkspace && p.workspace_id === currentWorkspace.id
        return isCreator || isInWorkspace
      })
      
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
  }, [user, currentWorkspace, supabase])

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
  }, [user, currentWorkspace, fetchProjects, fetchUserProfile])

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

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
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
        {/* Desktop button - hidden on mobile */}
        <CreateProjectButton className="hidden md:flex" />
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {/* Mobile button - full width at top of grid, hidden on desktop */}
          <CreateProjectButton className="md:hidden col-span-1" />
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => router.push(`/dashboard/projects/${project.id}`)}
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
                      router.push(`/dashboard/projects/${project.id}?tab=outputs`)
                    }}
                    className="text-caption text-cosmic-orange uppercase tracking-wider hover:text-orange-300 cursor-pointer transition-colors"
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
          ))}
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
