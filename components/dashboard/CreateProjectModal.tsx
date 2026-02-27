'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { ProjectType } from '@/types/database'
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

interface CreateProjectModalProps {
  workspaceId?: string | null
  projectType?: ProjectType
  onClose: () => void
  onSuccess: () => void
  // When provided, the project will be pre-shared with this org
  shareWithOrgId?: string
  shareWithOrgName?: string
}

export default function CreateProjectModal({ 
  workspaceId, 
  projectType = 'project', 
  onClose, 
  onSuccess,
  shareWithOrgId,
  shareWithOrgName 
}: CreateProjectModalProps) {
  const { workspaces } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([])
  const [showOrgDropdown, setShowOrgDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  
  const isAdvertisement = projectType === 'advertisement'
  const typeLabel = isAdvertisement ? 'Advertisement' : 'Project'
  
  // Check if we're creating from an organization context
  const isOrgContext = !!shareWithOrgId && !!shareWithOrgName
  
  // Get all workspaces the user belongs to
  const allWorkspaces = workspaces?.map(({ workspace }) => workspace) || []

  // Initialize selected orgs when in org context
  useEffect(() => {
    if (isOrgContext && shareWithOrgId) {
      setSelectedOrgIds([shareWithOrgId])
    }
  }, [isOrgContext, shareWithOrgId])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowOrgDropdown(false)
      }
    }

    if (showOrgDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showOrgDropdown])

  const toggleOrgSelection = (orgId: string) => {
    setSelectedOrgIds(prev => {
      if (prev.includes(orgId)) {
        return prev.filter(id => id !== orgId)
      } else {
        return [...prev, orgId]
      }
    })
  }

  const getSelectedOrgNames = () => {
    if (selectedOrgIds.length === 0) return 'None selected'
    const names = selectedOrgIds
      .map(id => allWorkspaces.find(w => w.id === id)?.name)
      .filter(Boolean)
    if (names.length === 1) return names[0]
    if (names.length === 2) return names.join(' and ')
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Determine visibility settings
      let finalVisibleOrgs: string[] = []
      let finalVisibility: 'private' | 'public' = visibility
      
      if (isOrgContext) {
        // Use selected organizations
        finalVisibleOrgs = selectedOrgIds
        finalVisibility = selectedOrgIds.length > 0 ? 'public' : 'private'
      } else if (visibility === 'public') {
        finalVisibleOrgs = allWorkspaces.map(w => w.id)
      }

      const { error: insertError } = await supabase.from('diffuse_projects').insert({
        workspace_id: workspaceId || null,
        name,
        description: description || null,
        visibility: finalVisibility,
        visible_to_orgs: finalVisibleOrgs,
        status: 'active',
        project_type: projectType,
        created_by: user.id,
      })

      if (insertError) throw insertError

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" maxHeight="max-h-[90vh]">
      <ModalHeader
        title={`Create New ${typeLabel}`}
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ModalBody>
          {error && (
            <div className="mb-6 p-4 rounded-glass border border-red-500/30 bg-red-500/10 text-red-400 text-body-sm flex-shrink-0">
              {error}
            </div>
          )}
          <div className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">
                {typeLabel} Name *
              </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
              placeholder={isAdvertisement ? "My Ad Campaign" : "My Project"}
            />
          </div>

            <div>
              <label htmlFor="description" className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">
                Description
              </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors resize-none"
              placeholder={isAdvertisement ? "Describe the product or service to promote..." : "Describe your project..."}
            />
          </div>

            {isOrgContext ? (
            <div>
              <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">Share with Organizations</label>
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                  className="w-full flex items-center justify-between gap-3 p-4 bg-white/5 border border-white/10 rounded-glass hover:bg-white/10 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <svg className="w-5 h-5 text-accent-purple flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="text-body-md text-secondary-white truncate">
                      {selectedOrgIds.length === 0 ? (
                        <span className="text-medium-gray">Select organizations...</span>
                      ) : (
                        <>Shared with <span className="text-accent-purple font-medium">{getSelectedOrgNames()}</span></>
                      )}
                    </span>
                  </div>
                  <svg 
                    className={`w-4 h-4 text-medium-gray flex-shrink-0 transition-transform ${showOrgDropdown ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown */}
                {showOrgDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-dark-gray border border-white/10 rounded-glass shadow-lg z-10 max-h-48 overflow-y-auto">
                    {allWorkspaces.length === 0 ? (
                      <div className="px-4 py-3 text-body-sm text-medium-gray">
                        No organizations available
                      </div>
                    ) : (
                      allWorkspaces.map((workspace) => {
                        const isSelected = selectedOrgIds.includes(workspace.id)
                        const isCurrentOrg = workspace.id === shareWithOrgId
                        return (
                          <button
                            key={workspace.id}
                            type="button"
                            onClick={() => toggleOrgSelection(workspace.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                          >
                            <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                              isSelected 
                                ? 'bg-accent-purple border-accent-purple' 
                                : 'border-white/20 bg-white/5'
                            }`}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <span className={`text-body-sm ${isSelected ? 'text-secondary-white' : 'text-medium-gray'}`}>
                              {workspace.name}
                              {isCurrentOrg && <span className="text-accent-purple ml-2">(current)</span>}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
              <p className="text-caption text-medium-gray mt-2">
                Select which organizations can see this project
              </p>
            </div>
            ) : (
            <div>
              <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">Visibility</label>
              <p className="text-caption text-medium-gray mb-3">
                Public projects are shared with all your organizations. Private projects are only visible to you.
              </p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="private"
                    checked={visibility === 'private'}
                    onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}
                    className="accent-cosmic-orange"
                  />
                  <span className="text-body-sm text-secondary-white flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Private
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}
                    className="accent-cosmic-orange"
                  />
                  <span className="text-body-sm text-secondary-white flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Public
                  </span>
                </label>
              </div>
            </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3" disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1 py-3" disabled={loading}>
            {loading ? 'Creating...' : `Create ${typeLabel}`}
          </button>
        </ModalFooter>
      </form>
    </ModalShell>
  )
}
