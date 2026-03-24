'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { GridPageSkeleton } from '@/components/dashboard/Skeletons'
import EmptyState from '@/components/dashboard/EmptyState'

const planDetails = {
  enterprise_pro: { name: 'Enterprise Pro', projects: 50, price: '$100/mo' },
  enterprise_pro_max: { name: 'Enterprise Pro Max', projects: 'Unlimited', price: '$500/mo' },
}

type BulkOrgAction = 'delete' | 'leave'

export default function OrganizationPage() {
  const router = useRouter()
  const { user, currentWorkspace, workspaces, setCurrentWorkspace, fetchWorkspaces } = useAuth()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(new Set())
  const [selectedAction, setSelectedAction] = useState<BulkOrgAction | null>(null)
  const [isBulkActing, setIsBulkActing] = useState(false)
  const supabase = createClient()

  // Load view preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('organizationsViewMode')
    if (saved === 'list' || saved === 'grid') setViewMode(saved)
  }, [])

  // Save view preference to localStorage
  const toggleViewMode = () => {
    const newMode = viewMode === 'grid' ? 'list' : 'grid'
    setSelectedWorkspaceIds(new Set())
    setSelectedAction(null)
    setViewMode(newMode)
    localStorage.setItem('organizationsViewMode', newMode)
  }

  const getWorkspaceAction = (workspace: { id: string; name: string; owner_id: string }, role: string): BulkOrgAction | null => {
    const isOwner = workspace.owner_id === user?.id
    const canDelete = isOwner || role === 'admin'
    if (canDelete) return 'delete'
    return isOwner ? null : 'leave'
  }

  const toggleSelectWorkspace = (workspaceId: string, action: BulkOrgAction) => {
    setSelectedWorkspaceIds((prev) => {
      const next = new Set(prev)
      const isSelected = next.has(workspaceId)

      if (isSelected) {
        next.delete(workspaceId)
        setSelectedAction(next.size > 0 ? action : null)
        return next
      }

      if (selectedAction && selectedAction !== action) {
        return prev
      }

      next.add(workspaceId)
      setSelectedAction(action)
      return next
    })
  }

  const clearWorkspaceSelection = () => {
    setSelectedWorkspaceIds(new Set())
    setSelectedAction(null)
  }

  const handleBulkOrganizationAction = async () => {
    if (!user || selectedWorkspaceIds.size === 0 || !selectedAction) return

    const selectedWorkspaces = workspaces.filter(({ workspace, role }) => {
      if (!selectedWorkspaceIds.has(workspace.id)) return false
      return getWorkspaceAction(workspace, role) === selectedAction
    })

    if (selectedWorkspaces.length === 0) return

    const itemLabel =
      selectedAction === 'delete'
        ? `delete ${selectedWorkspaces.length} organization${selectedWorkspaces.length !== 1 ? 's' : ''}`
        : `leave ${selectedWorkspaces.length} organization${selectedWorkspaces.length !== 1 ? 's' : ''}`

    const confirmed = window.confirm(
      selectedAction === 'delete'
        ? `Are you sure you want to ${itemLabel}? This action cannot be undone. All members will be removed and all shared projects will become personal projects.`
        : `Are you sure you want to ${itemLabel}? You'll lose access to all shared projects in them.`
    )

    if (!confirmed) return

    setIsBulkActing(true)
    setMessage(null)

    try {
      for (const { workspace } of selectedWorkspaces) {
        if (selectedAction === 'delete') {
          const { error: projectsError } = await supabase
            .from('diffuse_projects')
            .update({ workspace_id: null })
            .eq('workspace_id', workspace.id)

          if (projectsError) {
            console.error('Error updating organization projects:', projectsError)
          }

          const { error: deleteError } = await supabase
            .from('diffuse_workspaces')
            .delete()
            .eq('id', workspace.id)

          if (deleteError) throw deleteError
        } else {
          const { error: leaveError } = await supabase
            .from('diffuse_workspace_members')
            .delete()
            .eq('workspace_id', workspace.id)
            .eq('user_id', user.id)

          if (leaveError) throw leaveError
        }
      }

      await fetchWorkspaces()
      clearWorkspaceSelection()
      setMessage({
        type: 'success',
        text:
          selectedAction === 'delete'
            ? `Deleted ${selectedWorkspaces.length} organization${selectedWorkspaces.length !== 1 ? 's' : ''}.`
            : `Left ${selectedWorkspaces.length} organization${selectedWorkspaces.length !== 1 ? 's' : ''}.`,
      })
    } catch (error: any) {
      console.error(`Failed to ${selectedAction} organizations:`, error)
      setMessage({
        type: 'error',
        text:
          error.message ||
          `Failed to ${selectedAction === 'delete' ? 'delete' : 'leave'} one or more organizations`,
      })
    } finally {
      setIsBulkActing(false)
    }
  }

  const copyInviteCode = (code: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row click
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  if (!user) {
    return <GridPageSkeleton />
  }

  const showBulkActions = viewMode === 'list' && selectedWorkspaceIds.size > 0 && !!selectedAction
  const bulkActionLabel = selectedAction === 'delete' ? 'Delete' : 'Leave'

  const CreateOrJoinButton = ({
    className = '',
    menuClassName = 'right-0 mt-2 w-56',
  }: {
    className?: string
    menuClassName?: string
  }) => {
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      if (!menuOpen) return

      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          setMenuOpen(false)
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [menuOpen])

    return (
      <div ref={menuRef} className={`relative ${className}`}>
        <button
          onClick={() => setMenuOpen((prev) => !prev)}
          className="btn-primary w-full px-4 py-2 flex items-center justify-center gap-2 text-body-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create or Join
          <svg
            className={`w-4 h-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {menuOpen && (
          <div className={`absolute z-20 overflow-hidden rounded-glass border border-white/10 bg-dark-gray shadow-lg ${menuClassName}`}>
            <button
              onClick={() => {
                setMenuOpen(false)
                router.push('/dashboard/organization/create')
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-body-sm text-secondary-white transition-colors hover:bg-white/10"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Organization
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                router.push('/dashboard/organization/join')
              }}
              className="flex w-full items-center gap-3 border-t border-white/10 px-4 py-3 text-left text-body-sm text-secondary-white transition-colors hover:bg-white/10"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Join Organization
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 data-walkthrough="page-title" className="text-heading-lg text-secondary-white">Organizations</h1>
        {/* Desktop buttons - hidden on mobile */}
        <div className="hidden md:flex items-center gap-3">
          {showBulkActions ? (
            <>
              <button
                onClick={handleBulkOrganizationAction}
                disabled={selectedWorkspaceIds.size === 0 || isBulkActing}
                className={`px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
                  selectedAction === 'delete'
                    ? 'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30'
                    : 'bg-white/5 border border-white/20 text-secondary-white hover:bg-white/10'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {selectedAction === 'delete' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
                  )}
                </svg>
                {isBulkActing ? `${bulkActionLabel}ing...` : `${bulkActionLabel} (${selectedWorkspaceIds.size})`}
              </button>
              <button
                onClick={clearWorkspaceSelection}
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
              <CreateOrJoinButton className="w-60 flex-shrink-0" />
            </>
          )}
        </div>
      </div>

      {/* Organizations Grid */}
      {workspaces.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
          title="No Organizations Yet"
          description="Join an existing organization with an invite code or create your own to collaborate with your team."
        />
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4' : 'flex flex-col gap-3'}>
          {/* Mobile buttons - stacked at top of grid, hidden on desktop */}
          {!showBulkActions ? (
            <div className="md:hidden col-span-1 flex flex-col gap-2">
              <CreateOrJoinButton className="w-full" menuClassName="left-0 right-0 mt-2" />
            </div>
          ) : (
            <div className="md:hidden col-span-1 flex gap-2">
              <button
                onClick={handleBulkOrganizationAction}
                disabled={selectedWorkspaceIds.size === 0 || isBulkActing}
                className={`flex-1 px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
                  selectedAction === 'delete'
                    ? 'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30'
                    : 'bg-white/5 border border-white/20 text-secondary-white hover:bg-white/10'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {selectedAction === 'delete' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
                  )}
                </svg>
                {isBulkActing ? `${bulkActionLabel}ing...` : `${bulkActionLabel} (${selectedWorkspaceIds.size})`}
              </button>
              <button
                onClick={clearWorkspaceSelection}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-medium-gray hover:bg-white/10 transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </div>
          )}
          {workspaces.map(({ workspace, role }) => {
            const plan = workspace.plan && planDetails[workspace.plan as keyof typeof planDetails]
            const rowAction = getWorkspaceAction(workspace, role)
            const isSelected = selectedWorkspaceIds.has(workspace.id)
            const canSelect = !!rowAction && (!selectedAction || selectedAction === rowAction)
            
            if (viewMode === 'list') {
              // List view: compact horizontal layout
              return (
                <div
                  key={workspace.id}
                  onClick={() => router.push(`/dashboard/organization/${workspace.id}`)}
                  className={`glass-container p-4 transition-colors cursor-pointer flex items-center gap-4 ${
                    isSelected
                      ? 'bg-cosmic-orange/10 border-cosmic-orange/50 hover:bg-cosmic-orange/15'
                      : 'hover:bg-white/10'
                  }`}
                >
                  {rowAction ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSelectWorkspace(workspace.id, rowAction)
                      }}
                      disabled={!canSelect}
                      className={`flex-shrink-0 w-10 h-10 rounded-glass border-2 flex items-center justify-center transition-all disabled:cursor-not-allowed ${
                        isSelected
                          ? 'bg-cosmic-orange border-cosmic-orange text-black'
                          : canSelect
                          ? 'bg-white/5 border-transparent text-cosmic-orange hover:border-white/30'
                          : 'bg-white/5 border-transparent text-cosmic-orange/50'
                      }`}
                      aria-label={
                        isSelected
                          ? `Deselect ${workspace.name}`
                          : `Select ${workspace.name} to ${rowAction}`
                      }
                    >
                      {isSelected ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-cosmic-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      )}
                    </button>
                  ) : (
                    <div className="flex-shrink-0 w-10 h-10 bg-white/5 rounded-glass flex items-center justify-center">
                      <svg className="w-5 h-5 text-cosmic-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                  )}
                  
                  {/* Organization info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body-md text-secondary-white font-semibold truncate mb-1">
                      {workspace.name}
                    </h3>
                    <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider flex-wrap">
                      {plan && (
                        <>
                          <span className="text-accent-purple">{plan.name}</span>
                          <span>•</span>
                        </>
                      )}
                      <span className="text-cosmic-orange">{role}</span>
                      {workspace.invite_code && (
                        <>
                          <span>•</span>
                          <span>CODE: {workspace.invite_code}</span>
                        </>
                      )}
                    </div>
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
                key={workspace.id}
                onClick={() => router.push(`/dashboard/organization/${workspace.id}`)}
                className="glass-container p-6 hover:bg-white/10 transition-colors cursor-pointer"
              >
                {/* Organization Name */}
                <h3 className="text-body-md text-secondary-white font-semibold mb-4">
                  {workspace.name}
                </h3>
                
                {/* Details */}
                <div className="space-y-2">
                  {/* Plan & Role */}
                  <div className="flex items-center gap-2">
                    {plan && (
                      <span className="text-caption text-accent-purple uppercase tracking-wider">
                        {plan.name}
                      </span>
                    )}
                    {plan && <span className="text-caption text-medium-gray">•</span>}
                    <span className="text-caption text-cosmic-orange uppercase tracking-wider">
                      {role}
                    </span>
                  </div>
                  
                  {/* Invite Code */}
                  {workspace.invite_code && (
                    <button
                      onClick={(e) => copyInviteCode(workspace.invite_code!, e)}
                      className="text-caption text-medium-gray uppercase tracking-wider hover:text-secondary-white transition-colors"
                    >
                      {copiedCode === workspace.invite_code ? (
                        <span>COPIED!</span>
                      ) : (
                        <>INVITE CODE: {workspace.invite_code}</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Message */}
      {message && (
        <div
          className={`mt-6 p-4 rounded-glass border ${
            message.type === 'error'
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-cosmic-orange/10 border-cosmic-orange/30 text-cosmic-orange'
          }`}
        >
          <p className="text-body-sm">{message.text}</p>
        </div>
      )}
    </div>
  )
}

