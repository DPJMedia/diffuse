'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { GridPageSkeleton } from '@/components/dashboard/Skeletons'
import EmptyState from '@/components/dashboard/EmptyState'
import UpgradeCodeModal from '@/components/dashboard/UpgradeCodeModal'
import { useBodyScrollLock } from '@/components/dashboard/ModalShell'
import type { OrganizationPlan } from '@/types/database'

const planDetails = {
  enterprise_pro: { name: 'Enterprise Pro', projects: 50, price: '$100/mo' },
  enterprise_pro_max: { name: 'Enterprise Pro Max', projects: 'Unlimited', price: '$500/mo' },
}

// Upgrade codes for enterprise plans
const ENTERPRISE_CODES: Record<OrganizationPlan, string> = {
  enterprise_pro: '', // No code needed
  enterprise_pro_max: 'entpromax',
}

type BulkOrgAction = 'delete' | 'leave'

export default function OrganizationPage() {
  const router = useRouter()
  const { user, currentWorkspace, workspaces, setCurrentWorkspace, fetchWorkspaces } = useAuth()
  const [loading, setLoading] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [orgName, setOrgName] = useState('')
  const [orgDescription, setOrgDescription] = useState('')
  const [orgPlan, setOrgPlan] = useState<OrganizationPlan>('enterprise_pro')
  const [selectedPlan, setSelectedPlan] = useState<OrganizationPlan | null>(null)
  const [pendingOrgData, setPendingOrgData] = useState<{name: string, description: string} | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
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

  const generateOrgCode = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
  }

  const handleJoinOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const codeToFind = joinCode.toUpperCase().trim()
      
      // Find organization by invite code - use maybeSingle to handle no results gracefully
      const { data: org, error: orgError } = await supabase
        .from('diffuse_workspaces')
        .select('*')
        .eq('invite_code', codeToFind)
        .maybeSingle()

      if (orgError) {
        console.error('Error finding organization:', orgError)
        if (orgError.code === '42703') {
          throw new Error('Organization invite codes not yet configured in database')
        }
        if (orgError.code === 'PGRST116') {
          throw new Error('Invalid organization code')
        }
        throw new Error(`Error: ${orgError.message}`)
      }

      if (!org) {
        throw new Error('Invalid organization code - no organization found with this code')
      }

      // Check if user is already a member
      const { data: existingMember } = await supabase
        .from('diffuse_workspace_members')
        .select('id')
        .eq('workspace_id', org.id)
        .eq('user_id', user?.id)
        .maybeSingle()

      if (existingMember) {
        throw new Error('You are already a member of this organization')
      }

      // Add user as viewer (pending approval)
      const { error: memberError } = await supabase
        .from('diffuse_workspace_members')
        .insert({
          workspace_id: org.id,
          user_id: user?.id,
          role: 'viewer',
        })

      if (memberError) {
        console.error('Error adding member:', memberError)
        throw new Error(`Failed to join: ${memberError.message}`)
      }

      // Refresh workspaces list and set the joined org as current
      await fetchWorkspaces()
      setCurrentWorkspace(org)

      setMessage({ type: 'success', text: `Successfully joined ${org.name}!` })
      setJoinCode('')
      setShowJoinModal(false)
      router.push(`/dashboard/organization/${org.id}`)
    } catch (error: any) {
      console.error('Join organization error:', error)
      setMessage({ type: 'error', text: error.message || 'Failed to join organization' })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Enterprise Pro doesn't need code verification
    if (orgPlan === 'enterprise_pro') {
      await createOrganizationWithPlan(orgPlan)
    } else {
      // Enterprise Pro Max needs code verification
      setPendingOrgData({ name: orgName, description: orgDescription })
      setSelectedPlan(orgPlan)
      setShowUpgradeModal(true)
    }
  }

  const handleVerifyPlanCode = async (code: string): Promise<boolean> => {
    if (!selectedPlan) return false

    const expectedCode = ENTERPRISE_CODES[selectedPlan]
    if (code.toLowerCase() !== expectedCode.toLowerCase()) {
      return false
    }

    // Code is valid, proceed with organization creation
    await createOrganizationWithPlan(selectedPlan)
    return true
  }

  const createOrganizationWithPlan = async (plan: OrganizationPlan) => {
    setLoading(true)
    setMessage(null)

    try {
      const inviteCode = generateOrgCode()
      const name = pendingOrgData?.name || orgName
      const description = pendingOrgData?.description || orgDescription

      // Create organization with plan
      const { data: newOrg, error: orgError } = await supabase
        .from('diffuse_workspaces')
        .insert({
          name,
          description,
          invite_code: inviteCode,
          plan,
          owner_id: user?.id,
        })
        .select()
        .single()

      if (orgError) {
        if (orgError.code === '42703') {
          throw new Error('Organization fields not yet configured in database. Please contact support.')
        }
        throw orgError
      }

      // Add creator as admin
      const { error: memberError } = await supabase
        .from('diffuse_workspace_members')
        .insert({
          workspace_id: newOrg.id,
          user_id: user?.id,
          role: 'admin',
        })

      if (memberError) throw memberError

      // Refresh workspaces list and set the new org as current
      await fetchWorkspaces()
      setCurrentWorkspace(newOrg)

      setMessage({ 
        type: 'success', 
        text: `Organization created! Invite code: ${inviteCode}` 
      })
      setOrgName('')
      setOrgDescription('')
      setOrgPlan('enterprise_pro')
      setPendingOrgData(null)
      setSelectedPlan(null)
      setShowCreateModal(false)
      setShowUpgradeModal(false)
      router.push(`/dashboard/organization/${newOrg.id}`)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to create organization' })
      throw error
    } finally {
      setLoading(false)
    }
  }

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      // In a real app, you'd send an email with the invite code
      // For now, just show the code
      if (!currentWorkspace) throw new Error('No organization selected')

      const { data: org, error: orgError } = await supabase
        .from('diffuse_workspaces')
        .select('invite_code')
        .eq('id', currentWorkspace.id)
        .single()

      if (orgError || !org?.invite_code) {
        throw new Error('Organization invite codes not yet configured. Please contact support.')
      }

      setMessage({ 
        type: 'success', 
        text: `Share this code with ${inviteEmail}: ${org.invite_code}` 
      })
      setInviteEmail('')
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to generate invite' })
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return <GridPageSkeleton />
  }

  const showBulkActions = viewMode === 'list' && selectedWorkspaceIds.size > 0 && !!selectedAction
  const bulkActionLabel = selectedAction === 'delete' ? 'Delete' : 'Leave'

  const JoinButton = ({ className = '' }: { className?: string }) => (
    <button
      onClick={() => setShowJoinModal(true)}
      className={`btn-secondary px-4 py-2 flex items-center justify-center gap-2 text-body-sm ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
      Join
    </button>
  )

  const CreateButton = ({ className = '' }: { className?: string }) => (
    <button
      onClick={() => setShowCreateModal(true)}
      className={`btn-primary px-4 py-2 flex items-center justify-center gap-2 text-body-sm ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      Create
    </button>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 data-walkthrough="page-title" className="text-display-sm text-secondary-white">Organizations</h1>
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
              {workspaces.length > 0 && (
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
              )}
              <JoinButton />
              <CreateButton />
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
              <JoinButton className="w-full" />
              <CreateButton className="w-full" />
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
                    <h3 className="text-body-md text-secondary-white font-medium truncate mb-1">
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
                <h3 className="text-body-md text-secondary-white font-medium mb-4">
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

      {/* Join Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-hidden">
          <div className="glass-container p-4 sm:p-8 max-w-md w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-heading-lg text-secondary-white mb-6">Join Organization</h2>
            <form onSubmit={handleJoinOrganization} className="space-y-4">
              <div>
                <label className="block text-body-sm text-secondary-white mb-2">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="ABC12345"
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors uppercase"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="btn-secondary flex-1 py-3 w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex-1 py-3 disabled:opacity-50 w-full sm:w-auto"
                >
                  {loading ? 'Joining...' : 'Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-hidden">
          <div className="glass-container p-4 sm:p-8 max-w-md w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-heading-lg text-secondary-white mb-6">Create Organization</h2>
            <form onSubmit={handleCreateOrganization} className="space-y-4">
              <div>
                <label className="block text-body-sm text-secondary-white mb-2">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme News Corp"
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                />
              </div>
              <div>
                <label className="block text-body-sm text-secondary-white mb-2">
                  Description (optional)
                </label>
                <textarea
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  placeholder="Local news organization..."
                  rows={3}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                />
              </div>
              <div>
                <label className="block text-body-sm text-secondary-white mb-3">
                  Enterprise Plan
                </label>
                <div className="space-y-3">
                  {Object.entries(planDetails).map(([key, plan]) => (
                    <label
                      key={key}
                      className={`flex items-center justify-between p-4 rounded-glass border cursor-pointer transition-colors ${
                        orgPlan === key
                          ? 'border-purple-500/50 bg-purple-500/10'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="plan"
                          value={key}
                          checked={orgPlan === key}
                          onChange={() => setOrgPlan(key as OrganizationPlan)}
                          className="w-4 h-4 accent-purple-500"
                        />
                        <div>
                          <p className="text-body-md text-secondary-white font-medium">{plan.name}</p>
                          <p className="text-caption text-medium-gray">Organization plan</p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary flex-1 py-3 w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex-1 py-3 disabled:opacity-50 w-full sm:w-auto"
                >
                  {loading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upgrade Code Modal for Enterprise Plans */}
      {selectedPlan && (
        <UpgradeCodeModal
          isOpen={showUpgradeModal}
          onClose={() => {
            setShowUpgradeModal(false)
            setSelectedPlan(null)
            setPendingOrgData(null)
          }}
          onVerify={handleVerifyPlanCode}
          planName={planDetails[selectedPlan].name}
          loading={loading}
        />
      )}
    </div>
  )
}

