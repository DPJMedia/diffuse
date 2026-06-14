'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import EmptyState from '@/components/dashboard/EmptyState'
import { GridPageSkeleton } from '@/components/dashboard/Skeletons'
import type { DiffuseProject } from '@/types/database'

type SubscriptionTier = 'free' | 'pro' | 'pro_max' | 'contractor_pro'

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
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>('free')
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const supabase = createClient()

  // Load view preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('advertisementsViewMode')
    if (saved === 'list' || saved === 'grid') setViewMode(saved)
  }, [])

  // Save view preference to localStorage
  const toggleViewMode = () => {
    const newMode = viewMode === 'grid' ? 'list' : 'grid'
    setIsEditMode(false)
    setSelectedIds(new Set())
    setViewMode(newMode)
    localStorage.setItem('advertisementsViewMode', newMode)
  }

  const subscriptionLimits: Record<SubscriptionTier, number> = {
    free: 3,
    pro: 15,
    pro_max: Infinity, // Pro Max: unlimited projects/generations
    contractor_pro: 40,
  }

  const fetchAdvertisements = useCallback(async () => {
    if (!user) return

    setLoading(true)
    try {
      // Only fetch advertisements created by this user — shared ones appear under Organizations
      const { data: allProjects, error } = await supabase
        .from('diffuse_projects')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      
      const filteredProjects = allProjects || []
      
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
        // Get all inputs for all ads (excluding images)
        adIds.length > 0
          ? supabase
              .from('diffuse_project_inputs')
              .select('project_id, type')
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

      // Count inputs per ad (excluding cover_photo and image types)
      const inputsData = inputsResult.data || []
      inputsData.forEach((input: { project_id: string; type: string }) => {
        if (input.type !== 'cover_photo' && input.type !== 'image') {
          inputCounts.set(input.project_id, (inputCounts.get(input.project_id) || 0) + 1)
        }
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
      fetchAdvertisements()
      fetchUserProfile()
    }
  }, [user, fetchAdvertisements, fetchUserProfile])

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

  const toggleSelectAd = (id: string) => {
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
    if (!confirm(`Delete ${selectedIds.size} advertisement${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return

    setIsDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      for (const id of ids) {
        await supabase.from('diffuse_project_inputs').delete().eq('project_id', id)
        await supabase.from('diffuse_project_outputs').delete().eq('project_id', id)
        await supabase.from('diffuse_projects').delete().eq('id', id)
      }
      exitEditMode()
      fetchAdvertisements()
    } catch (error) {
      console.error('Error bulk deleting advertisements:', error)
      alert('Failed to delete some advertisements')
    } finally {
      setIsDeleting(false)
    }
  }

  if (authLoading || !user) {
    return <GridPageSkeleton viewMode={viewMode} />
  }

  const projectLimit = subscriptionLimits[subscriptionTier]
  const hasReachedLimit = totalCountForLimit >= projectLimit
  const isListSelectionActive = viewMode === 'list' && selectedIds.size > 0
  const showBulkActions = isEditMode || isListSelectionActive

  const CreateAdButton = ({ className = '' }: { className?: string }) => (
    <button
      onClick={() => {
        if (hasReachedLimit) {
          router.push('/dashboard/subscription')
          return
        }
        router.push('/dashboard/advertisements/new')
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
        <h1 data-walkthrough="page-title" className="text-heading-lg text-secondary-white">Advertisements</h1>
        {/* Desktop buttons - hidden on mobile */}
        <div className="hidden md:flex items-center gap-3">
          {showBulkActions ? (
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
              <CreateAdButton className="w-60 flex-shrink-0" />
            </>
          )}
        </div>
      </div>

      {/* Advertisements Grid */}
      {loading ? (
        <GridPageSkeleton showHeader={false} viewMode={viewMode} />
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
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4' : 'flex flex-col gap-3'}>
          {/* Mobile buttons - full width at top of grid, hidden on desktop */}
          {!showBulkActions ? (
            <CreateAdButton className="md:hidden col-span-1" />
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
          {advertisements.map((ad) => {
            const isSelected = selectedIds.has(ad.id)
            
            if (viewMode === 'list') {
              // List view: compact horizontal layout
              return (
                <div
                  key={ad.id}
                  onClick={() => router.push(`/dashboard/projects/${ad.id}`)}
                  className={`glass-container p-4 transition-colors cursor-pointer flex items-center gap-4 ${
                    isSelected
                      ? 'bg-cosmic-orange/10 border-cosmic-orange/50 hover:bg-cosmic-orange/15'
                      : 'hover:bg-white/10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSelectAd(ad.id)
                    }}
                    className={`flex-shrink-0 w-10 h-10 rounded-glass border-2 flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-cosmic-orange border-cosmic-orange text-black'
                        : 'bg-white/5 border-transparent text-cosmic-orange hover:border-white/30'
                    }`}
                    aria-label={isSelected ? `Deselect ${ad.name}` : `Select ${ad.name}`}
                  >
                    {isSelected ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                      </svg>
                    )}
                  </button>
                  
                  {/* Ad info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body-md text-secondary-white font-semibold truncate mb-1">
                      {ad.name}
                    </h3>
                    <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider flex-wrap">
                      <span className="text-accent-purple">{ad.input_count} INPUT{ad.input_count !== 1 ? 'S' : ''}</span>
                      <span>•</span>
                      <span className="text-cosmic-orange">{ad.output_count} OUTPUT{ad.output_count !== 1 ? 'S' : ''}</span>
                      <span>•</span>
                      <span>{new Date(ad.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</span>
                    </div>
                  </div>
                  
                  {/* Status badge */}
                  <div className="flex-shrink-0 text-caption text-medium-gray uppercase tracking-wider px-2 py-1 bg-white/5 rounded">
                    {ad.orgs && ad.orgs.length > 0 ? 'PUBLIC' : 'PRIVATE'}
                  </div>
                  
                  {/* Arrow */}
                  {!isSelected && (
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
                key={ad.id}
                onClick={() => isEditMode ? toggleSelectAd(ad.id) : router.push(`/dashboard/projects/${ad.id}`)}
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
                {/* Name */}
                <h3 className={`text-body-md text-secondary-white font-semibold mb-4 ${isEditMode ? 'pr-8' : ''}`}>
                  {ad.name}
                </h3>
                
                {/* Details */}
                <div className="space-y-2">
                  {/* Inputs & Outputs */}
                  <div className="flex items-center gap-2">
                    <span 
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isEditMode) router.push(`/dashboard/projects/${ad.id}?tab=inputs`)
                      }}
                      className={`text-caption text-accent-purple uppercase tracking-wider transition-colors ${!isEditMode ? 'hover:text-accent-purple/70 cursor-pointer' : ''}`}
                    >
                      {ad.input_count} INPUT{ad.input_count !== 1 ? 'S' : ''}
                    </span>
                    <span className="text-caption text-medium-gray">•</span>
                    <span 
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isEditMode) router.push(`/dashboard/projects/${ad.id}?tab=outputs`)
                      }}
                      className={`text-caption text-cosmic-orange uppercase tracking-wider transition-colors ${!isEditMode ? 'hover:text-orange-300 cursor-pointer' : ''}`}
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
                                if (!isEditMode) router.push(`/dashboard/organization/${org.id}`)
                              }}
                              className={`text-medium-gray transition-colors ${!isEditMode ? 'hover:text-gray-300 cursor-pointer' : ''}`}
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
            )
          })}
        </div>
      )}
    </div>
  )
}
