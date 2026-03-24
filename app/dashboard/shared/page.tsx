'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { GridPageSkeleton } from '@/components/dashboard/Skeletons'
import EmptyState from '@/components/dashboard/EmptyState'
import type { DiffuseProject } from '@/types/database'

interface OrgInfo {
  id: string
  name: string
}

interface SharedProject extends DiffuseProject {
  input_count: number
  output_count: number
  author_name: string
  orgs: OrgInfo[]
}

export default function SharedWithMePage() {
  const router = useRouter()
  const { user, workspaces, loading: authLoading } = useAuth()
  const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const supabase = createClient()

  // Load view preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sharedViewMode')
    if (saved === 'list' || saved === 'grid') setViewMode(saved)
  }, [])

  // Save view preference to localStorage
  const toggleViewMode = () => {
    const newMode = viewMode === 'grid' ? 'list' : 'grid'
    setViewMode(newMode)
    localStorage.setItem('sharedViewMode', newMode)
  }

  const fetchSharedProjects = useCallback(async () => {
    if (!user || workspaces.length === 0) {
      setSharedProjects([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // Get workspace IDs the user is a member of
      const workspaceIds = workspaces.map(w => w.workspace.id)

      // Fetch public projects that are shared with any of the user's workspaces
      // but NOT created by the user
      const { data: projectsData, error } = await supabase
        .from('diffuse_projects')
        .select('*')
        .eq('visibility', 'public')
        .neq('created_by', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      // Filter projects that have at least one workspace in common
      const filteredProjects = (projectsData || []).filter(project => {
        const visibleOrgs = project.visible_to_orgs || []
        return visibleOrgs.some((orgId: string) => workspaceIds.includes(orgId))
      })

      // Fetch additional info for each project
      const sharedProjectsWithDetails: SharedProject[] = []
      for (const project of filteredProjects) {
        // Get author name, input/output counts, and org names
        const [authorResult, { count: inputCount }, { count: outputCount }, orgsResult] = await Promise.all([
          supabase
            .from('user_profiles')
            .select('full_name')
            .eq('id', project.created_by)
            .single(),
          supabase
            .from('diffuse_project_inputs')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id)
            .is('deleted_at', null)
            .not('type', 'in', '(cover_photo,image)'),
          supabase
            .from('diffuse_project_outputs')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', project.id)
            .is('deleted_at', null),
          project.visible_to_orgs && project.visible_to_orgs.length > 0
            ? supabase
                .from('diffuse_workspaces')
                .select('id, name')
                .in('id', project.visible_to_orgs)
            : Promise.resolve({ data: [] }),
        ])

        sharedProjectsWithDetails.push({
          ...project,
          input_count: inputCount || 0,
          output_count: outputCount || 0,
          author_name: authorResult.data?.full_name || 'Unknown',
          orgs: orgsResult.data?.map((org: { id: string; name: string }) => ({ id: org.id, name: org.name })) || [],
        })
      }

      setSharedProjects(sharedProjectsWithDetails)
    } catch (error) {
      console.error('Error fetching shared projects:', error)
      setSharedProjects([])
    } finally {
      setLoading(false)
    }
  }, [user, workspaces, supabase])

  useEffect(() => {
    if (user) {
      fetchSharedProjects()
    }
  }, [user, workspaces, fetchSharedProjects])

  if (authLoading || !user) {
    return <GridPageSkeleton viewMode={viewMode} />
  }

  const ViewOrgsButton = ({ className = '' }: { className?: string }) => (
    <a
      href="/dashboard/organization"
      className={`btn-primary px-4 py-2 flex items-center justify-center gap-2 text-body-sm ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
      View Organizations
    </a>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-heading-lg text-secondary-white">Shared With Me</h1>
        {/* Desktop button - hidden on mobile */}
        <div className="hidden md:flex items-center gap-3">
          <div className="flex w-[92px] items-center justify-end gap-3">
            <div className="h-10 w-10 flex-shrink-0" />
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
          </div>
          <ViewOrgsButton className="w-60 flex-shrink-0" />
        </div>
      </div>

      {/* Shared Projects Grid */}
      {loading ? (
        <GridPageSkeleton showHeader={false} viewMode={viewMode} />
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          }
          title="No Organizations"
          description="Join an organization to see shared projects."
        />
      ) : sharedProjects.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          }
          title="No Shared Projects"
          description="No projects have been shared with your organizations yet."
        />
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4' : 'flex flex-col gap-3'}>
          {/* Mobile button - full width at top of grid, hidden on desktop */}
          <ViewOrgsButton className="md:hidden col-span-1" />
          {sharedProjects.map((project) => {
            const workspaceIdSet = new Set(workspaces.map((w) => w.workspace.id))
            const orgsSharedWithUser = (project.orgs || []).filter((o) => workspaceIdSet.has(o.id))
            const orgNamesLabel = orgsSharedWithUser.map((o) => o.name).join(', ')

            if (viewMode === 'list') {
              // List view: compact horizontal layout
              return (
                <div
                  key={project.id}
                  onClick={() => router.push(`/dashboard/projects/${project.id}`)}
                  className="glass-container p-4 hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-4"
                >
                  {/* Project icon */}
                  <div className="flex-shrink-0 w-10 h-10 bg-white/5 rounded-glass flex items-center justify-center">
                    <svg className="w-5 h-5 text-cosmic-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  
                  {/* Project info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body-md text-secondary-white font-semibold truncate mb-1">
                      {project.name}
                    </h3>
                    <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider flex-wrap min-w-0">
                      <span className="text-accent-purple flex-shrink-0">{project.input_count} INPUT{project.input_count !== 1 ? 'S' : ''}</span>
                      <span className="flex-shrink-0">•</span>
                      <span className="text-cosmic-orange flex-shrink-0">{project.output_count} OUTPUT{project.output_count !== 1 ? 'S' : ''}</span>
                      <span className="flex-shrink-0">•</span>
                      <span className="min-w-0 truncate">{orgNamesLabel ? orgNamesLabel.toUpperCase() : '—'}</span>
                    </div>
                  </div>
                  
                  {/* Creator (replaces generic SHARED label) */}
                  <div className="flex-shrink-0 max-w-[40%] sm:max-w-[11rem] text-caption text-medium-gray uppercase tracking-wider px-2 py-1 bg-white/5 rounded">
                    <span className="block truncate">
                      {project.orgs && project.orgs.length > 0 ? project.author_name : 'PRIVATE'}
                    </span>
                  </div>
                  
                  {/* Arrow */}
                  <svg className="w-5 h-5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              )
            }
            
            // Grid view: original card layout
            return (
            <div
              key={project.id}
              onClick={() => router.push(`/dashboard/projects/${project.id}`)}
              className="glass-container p-6 hover:bg-white/10 transition-colors cursor-pointer"
            >
              {/* Project Name */}
              <h3 className="text-body-md text-secondary-white font-semibold mb-4">
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
                
                {/* Organization(s) you share with this project & date */}
                <div className="flex items-start gap-2 text-caption text-medium-gray uppercase tracking-wider">
                  <span className="flex items-center gap-1 flex-wrap min-w-0 flex-1">
                    {orgsSharedWithUser.length > 0 ? (
                      orgsSharedWithUser.map((org, index) => (
                        <span key={org.id} className="inline-flex items-center">
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/dashboard/organization/${org.id}`)
                            }}
                            className="text-medium-gray hover:text-gray-300 cursor-pointer transition-colors"
                          >
                            {org.name}
                          </span>
                          {index < orgsSharedWithUser.length - 1 && <span className="text-medium-gray">,&nbsp;</span>}
                        </span>
                      ))
                    ) : (
                      <span>—</span>
                    )}
                  </span>
                  <span className="flex-shrink-0">•</span>
                  <span className="flex-shrink-0">
                    {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                  </span>
                </div>
                
                {/* Creator */}
                <div className="text-caption text-medium-gray uppercase tracking-wider">
                  {project.orgs && project.orgs.length > 0 ? (
                    <span>CREATED BY: {project.author_name}</span>
                  ) : (
                    <span>PRIVATE</span>
                  )}
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

