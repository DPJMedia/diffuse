'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

export default function JoinOrganizationPage() {
  const router = useRouter()
  const { user, setCurrentWorkspace, fetchWorkspaces } = useAuth()
  const supabase = createClient()
  
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (!user) throw new Error('Not authenticated')

      const codeToFind = code.toUpperCase().trim()
      
      // Find organization by invite code
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
        .eq('user_id', user.id)
        .maybeSingle()

      if (existingMember) {
        throw new Error('You are already a member of this organization')
      }

      // Add user as viewer
      const { error: memberError } = await supabase
        .from('diffuse_workspace_members')
        .insert({
          workspace_id: org.id,
          user_id: user.id,
          role: 'viewer',
        })

      if (memberError) {
        console.error('Error adding member:', memberError)
        throw new Error(`Failed to join: ${memberError.message}`)
      }

      // Refresh workspaces list and set the joined org as current
      await fetchWorkspaces()
      setCurrentWorkspace(org)

      router.push(`/dashboard/organization/${org.id}`)
    } catch (err: any) {
      setError(err.message || 'Failed to join organization')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
      <div className="w-full max-w-2xl">
        <h1 className="text-heading-lg text-secondary-white mb-8">Join an organization</h1>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 rounded-glass border border-red-500/30 bg-red-500/10 text-red-400 text-body-sm">
              {error}
            </div>
          )}

          {/* Invite Code */}
          <div>
            <label htmlFor="code" className="block text-body-sm text-medium-gray mb-2">
              Invite code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors placeholder:text-medium-gray/50 uppercase tracking-wider"
              placeholder="ABC12345"
              autoFocus
              maxLength={8}
            />
            <p className="text-caption text-medium-gray mt-2">
              Enter the 8-character code provided by the organization admin
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.push('/dashboard/organization')}
              className="btn-secondary px-6 py-3"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary px-6 py-3"
              disabled={loading || !code.trim()}
            >
              {loading ? 'Joining...' : 'Join organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
