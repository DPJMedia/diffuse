'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { ProjectType } from '@/types/database'

export default function CreateProjectPage() {
  const router = useRouter()
  const { workspaces } = useAuth()
  const supabase = createClient()
  
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const allWorkspaces = workspaces?.map(({ workspace }) => workspace) || []

  const toggleOrgSelection = (orgId: string) => {
    setSelectedOrgIds(prev => {
      if (prev.includes(orgId)) {
        return prev.filter(id => id !== orgId)
      } else {
        return [...prev, orgId]
      }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      let finalVisibleOrgs: string[] = []
      let finalVisibility: 'private' | 'public' = visibility
      
      if (visibility === 'public') {
        finalVisibleOrgs = selectedOrgIds
      }

      const { error: insertError } = await supabase.from('diffuse_projects').insert({
        workspace_id: null,
        name,
        description: description || null,
        visibility: finalVisibility,
        visible_to_orgs: finalVisibleOrgs,
        status: 'active',
        project_type: 'project',
        created_by: user.id,
      })

      if (insertError) throw insertError

      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
      <div className="w-full max-w-2xl">
        <h1 className="text-heading-lg text-secondary-white mb-8">Create a project</h1>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 rounded-glass border border-red-500/30 bg-red-500/10 text-red-400 text-body-sm">
              {error}
            </div>
          )}

          {/* Project Title */}
          <div>
            <label htmlFor="name" className="block text-body-sm text-medium-gray mb-2">
              Project title
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors placeholder:text-medium-gray/50"
              placeholder="Name your project"
              autoFocus
            />
          </div>

          {/* Project Description */}
          <div>
            <label htmlFor="description" className="block text-body-sm text-medium-gray mb-2">
              Project description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors resize-none placeholder:text-medium-gray/50"
              placeholder="Describe your project, goals, subject, etc..."
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-body-sm text-medium-gray mb-2">
              Visibility
            </label>
            <div className="bg-white/5 border border-white/10 rounded-glass p-6">
              <div className="flex gap-6">
                {/* Left Column - Visibility Options */}
                <div className="flex flex-col gap-2 min-w-[140px]">
                  <button
                    type="button"
                    onClick={() => setVisibility('private')}
                    className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <span className="text-body-sm text-secondary-white flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Private
                    </span>
                    {visibility === 'private' && (
                      <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility('public')}
                    className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <span className="text-body-sm text-secondary-white flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Public
                    </span>
                    {visibility === 'public' && (
                      <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Right Column - Organization List (only when Public is selected) */}
                {visibility === 'public' && (
                  <div className="flex-1 border-l border-white/10 pl-6">
                    {allWorkspaces.length === 0 ? (
                      <p className="text-body-sm text-medium-gray">
                        No organizations available. Join an organization to share this project.
                      </p>
                    ) : (
                      <div className="max-h-[200px] overflow-y-auto space-y-2 pr-2">
                        {allWorkspaces.map((workspace) => {
                          const isSelected = selectedOrgIds.includes(workspace.id)
                          return (
                            <button
                              key={workspace.id}
                              type="button"
                              onClick={() => toggleOrgSelection(workspace.id)}
                              className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                            >
                              <span className="text-body-sm text-secondary-white truncate">
                                {workspace.name}
                              </span>
                              {isSelected && (
                                <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="btn-secondary px-6 py-3"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary px-6 py-3"
              disabled={loading || !name.trim()}
            >
              {loading ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
