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

export default function AdvertisementsPage() {
  const router = useRouter()
  const { user, currentWorkspace, loading: authLoading } = useAuth()
  const [advertisements, setAdvertisements] = useState<ProjectWithCounts[]>([])
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

  const fetchAdvertisements = useCallback(async () => {
    if (!user) return

    setLoading(true)
    try {
      // Build base query - get all projects, then filter for advertisements
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

      // Filter for advertisements only
      const adsData = filteredProjects.filter(
        p => p.project_type === 'advertisement'
      )

      if (!adsData || adsData.length === 0) {
        setAdvertisements([])
        return
      }

      // Extract unique IDs for batch queries
      const adIds = adsData.map(a => a.id)
      const creatorIds = [...new Set(adsData.map(a => a.created_by).filter(Boolean))]
      const allOrgIds = [...new Set(adsData.flatMap(a => a.visible_to_orgs || []).filter(Boolean))]

      // Batch fetch all data in parallel (5 queries instead of 4N queries)
      const [inputsResult, outputsResult, creatorsResult, orgsResult] = await Promise.all([
        // Get all inputs for all ads
        adIds.length > 0
          ? supabase
              .from('diffuse_project_inputs')
              .select('project_id')
              .in('project_id', adIds)
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
        // Get all outputs for all ads
        adIds.length > 0
          ? supabase
              .from('diffuse_project_outputs')
              .select('project_id')
              .in('project_id', adIds)
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

      // Count inputs per ad
      const inputsData = inputsResult.data || []
      inputsData.forEach((input: { project_id: string }) => {
        inputCounts.set(input.project_id, (inputCounts.get(input.project_id) || 0) + 1)
      })

      // Count outputs per ad
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
      const adsWithCounts: ProjectWithCounts[] = adsData.map(ad => ({
        ...ad,
        input_count: inputCounts.get(ad.id) || 0,
        output_count: outputCounts.get(ad.id) || 0,
        creator_name: creatorNames.get(ad.created_by) || 'Unknown',
        orgs: (ad.visible_to_orgs || [])
          .map((orgId: string) => orgNames.get(orgId))
          .filter(Boolean) as OrgInfo[],
      }))
      
      setAdvertisements(adsWithCounts)
    } catch (error) {
      console.error('Error fetching advertisements:', error)
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
      fetchAdvertisements()
      fetchUserProfile()
    }
  }, [user, currentWorkspace, fetchAdvertisements, fetchUserProfile])

  // Supabase Realtime subscriptions for instant updates
  useEffect(() => {
    if (!user) return

    // Subscribe to project changes (advertisements are stored as projects)
    const projectsChannel = supabase
      .channel('ads-projects-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_projects',
        },
        () => {
          fetchAdvertisements()
        }
      )
      .subscribe()

    // Subscribe to input changes (for counts)
    const inputsChannel = supabase
      .channel('ads-inputs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_project_inputs',
        },
        () => {
          fetchAdvertisements()
        }
      )
      .subscribe()

    // Subscribe to output changes (for counts)
    const outputsChannel = supabase
      .channel('ads-outputs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_project_outputs',
        },
        () => {
          fetchAdvertisements()
        }
      )
      .subscribe()

    // Cleanup subscriptions on unmount
    return () => {
      supabase.removeChannel(projectsChannel)
      supabase.removeChannel(inputsChannel)
      supabase.removeChannel(outputsChannel)
    }
  }, [user, supabase, fetchAdvertisements])

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const projectLimit = subscriptionLimits[subscriptionTier]
  const hasReachedLimit = totalCountForLimit >= projectLimit

  const CreateAdButton = ({ className = '' }: { className?: string }) => (
    <button
      onClick={() => {
        if (hasReachedLimit) {
          router.push('/dashboard/subscription')
          return
        }
        setShowCreateModal(true)
      }}
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
          Create Advertisement
        </>
      )}
    </button>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 data-walkthrough="page-title" className="text-display-sm text-secondary-white">Advertisements</h1>
        {/* Desktop button - hidden on mobile */}
        <CreateAdButton className="hidden md:flex" />
      </div>

      {/* Advertisements Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : advertisements.length === 0 ? (
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
                d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
              />
            </svg>
          }
          title="No Advertisements Yet"
          description="Create your first advertisement to generate sponsored content that looks like a news article."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {/* Mobile button - full width at top of grid, hidden on desktop */}
          <CreateAdButton className="md:hidden col-span-1" />
          {advertisements.map((ad) => (
            <div
              key={ad.id}
              onClick={() => router.push(`/dashboard/projects/${ad.id}`)}
              className="glass-container p-6 hover:bg-white/10 transition-colors cursor-pointer"
            >
              {/* Name */}
              <h3 className="text-heading-md text-secondary-white font-medium mb-4">
                {ad.name}
              </h3>
              
              {/* Details */}
              <div className="space-y-2">
                {/* Inputs & Outputs */}
                <div className="flex items-center gap-2">
                  <span 
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/dashboard/projects/${ad.id}?tab=inputs`)
                    }}
                    className="text-caption text-accent-purple uppercase tracking-wider hover:text-accent-purple/70 cursor-pointer transition-colors"
                  >
                    {ad.input_count} INPUT{ad.input_count !== 1 ? 'S' : ''}
                  </span>
                  <span className="text-caption text-medium-gray">•</span>
                  <span 
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/dashboard/projects/${ad.id}?tab=outputs`)
                    }}
                    className="text-caption text-cosmic-orange uppercase tracking-wider hover:text-orange-300 cursor-pointer transition-colors"
                  >
                    {ad.output_count} OUTPUT{ad.output_count !== 1 ? 'S' : ''}
                  </span>
                </div>
                
                {/* Created By & Date */}
                <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider">
                  <span>CREATED BY: {ad.creator_name}</span>
                  <span>•</span>
                  <span>{new Date(ad.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
                </div>
                
                {/* Access */}
                <div className="text-caption text-medium-gray uppercase tracking-wider">
                  {ad.orgs && ad.orgs.length > 0 ? (
                    <span className="flex items-center gap-1 flex-wrap">
                      {ad.orgs.map((org, index) => (
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
                          {index < ad.orgs!.length - 1 && <span className="text-medium-gray">,&nbsp;</span>}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span>PRIVATE</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Advertisement Modal */}
      {showCreateModal && (
        <CreateProjectModal
          workspaceId={currentWorkspace?.id || null}
          projectType="advertisement"
          onClose={() => setShowCreateModal(false)}
          onSuccess={fetchAdvertisements}
        />
      )}
    </div>
  )
}
