'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useWalkthrough } from '@/contexts/WalkthroughContext'
import { createClient } from '@/lib/supabase/client'
import { SettingsPageSkeleton } from '@/components/dashboard/Skeletons'

type SubscriptionTier = 'free' | 'pro' | 'pro_max'

interface UserProfile {
  id: string
  full_name: string | null
  subscription_tier: SubscriptionTier
}

// Role badge colors matching the organization page
const getRoleBadgeClass = (role: string) => {
  switch (role) {
    case 'owner':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    case 'admin':
      return 'bg-cosmic-orange/20 text-cosmic-orange border-cosmic-orange/30'
    case 'editor':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    default: // viewer
      return 'bg-medium-gray/20 text-medium-gray border-medium-gray/30'
  }
}

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

export default function SettingsPage() {
  const router = useRouter()
  const { user, workspaces } = useAuth()
  const { openWalkthrough } = useWalkthrough()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [leavingOrg, setLeavingOrg] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const supabase = createClient()

  const fetchProfile = useCallback(async () => {
    if (!user) return

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') {
        // Table doesn't exist or other error - use default profile
        console.warn('user_profiles table not found, using default profile')
        const defaultProfile = {
          id: user.id,
          full_name: null,
          subscription_tier: 'free' as SubscriptionTier,
        }
        setProfile(defaultProfile)
        setLoading(false)
        return
      }

      if (data) {
        setProfile(data)
      } else {
        // Create default profile
        const newProfile = {
          id: user.id,
          full_name: null,
          subscription_tier: 'free' as SubscriptionTier,
        }
        
        const { error: insertError } = await supabase
          .from('user_profiles')
          .insert(newProfile)

        if (insertError) {
          console.warn('Could not insert profile, using default')
          setProfile(newProfile)
        } else {
          setProfile(newProfile)
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error)
      // Use default profile on error
      setProfile({
        id: user.id,
        full_name: null,
        subscription_tier: 'free' as SubscriptionTier,
      })
    } finally {
      setLoading(false)
    }
  }, [user, supabase])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const handleLeaveOrganization = async (workspaceId: string, workspaceName: string) => {
    if (!user) return

    const confirmLeave = window.confirm(
      `Are you sure you want to leave "${workspaceName}"? You will lose access to all shared projects.`
    )
    
    if (!confirmLeave) return

    setLeavingOrg(workspaceId)
    try {
      const { error } = await supabase
        .from('diffuse_workspace_members')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)

      if (error) throw error

      // Reload page to refresh workspaces
      window.location.reload()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to leave organization' })
      setLeavingOrg(null)
    }
  }

  const handleDeleteAccount = async () => {
    if (!user) return

    const confirmation = prompt('Type "DELETE" to confirm account deletion:')
    if (confirmation !== 'DELETE') return

    setSaving(true)
    try {
      // In a real app, you'd have a secure backend endpoint for this
      // For now, we'll just sign out
      alert('Account deletion would be processed here. For now, signing out.')
      await supabase.auth.signOut()
      window.location.href = '/'
    } catch (error) {
      console.error('Error deleting account:', error)
      alert('Failed to delete account')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !profile) {
    return <SettingsPageSkeleton />
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 data-walkthrough="page-title" className="text-heading-lg text-secondary-white">Settings</h1>
          <p className="text-body-md text-medium-gray mt-1">
            Manage your account and preferences
          </p>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-6 p-4 rounded-glass border ${
            message.type === 'error'
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-cosmic-orange/10 border-cosmic-orange/30 text-cosmic-orange'
          }`}
        >
          <p className="text-body-sm">{message.text}</p>
        </div>
      )}

      <div className="w-full max-w-4xl">
        {/* Organizations */}
        {workspaces.length > 0 && (
        <div className="glass-container p-6 mb-6">
          <h2 className="text-heading-md text-secondary-white mb-4">Organizations</h2>
          <div className="divide-y divide-white/10">
            {workspaces.map(({ workspace, role }) => {
              // Check if user is owner (owners can't leave)
              const isOwner = role === 'owner'
              
              return (
                <div key={workspace.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <p className="text-body-md text-secondary-white font-medium">{workspace.name}</p>
                    <span className={`px-3 py-1 text-caption font-medium rounded-full border ${getRoleBadgeClass(role)}`}>
                      {roleLabels[role] || role}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={() => router.push(`/dashboard/organization/${workspace.id}`)}
                      className="w-full sm:w-auto px-4 py-2 text-body-sm text-secondary-white bg-white/5 border border-white/10 rounded-glass hover:bg-white/10 transition-colors"
                    >
                      Go to Organization
                    </button>
                    {!isOwner && (
                      <button
                        onClick={() => handleLeaveOrganization(workspace.id, workspace.name)}
                        disabled={leavingOrg === workspace.id}
                        className="w-full sm:w-auto px-4 py-2 text-body-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-glass hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        {leavingOrg === workspace.id ? 'Leaving...' : 'Leave Organization'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Profile Settings */}
      <div className="glass-container p-6 mb-6">
        <h2 className="text-heading-md text-secondary-white mb-6">Profile</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-caption text-medium-gray mb-1">Email</label>
            <p className="text-body-md text-secondary-white">{user?.email}</p>
          </div>
          <div>
            <label className="block text-caption text-medium-gray mb-1">Full Name</label>
            <p className="text-body-md text-secondary-white">
              {profile?.full_name || <span className="text-medium-gray italic">Not set</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Help & Support */}
      <div className="glass-container p-6 mb-6">
        <h2 className="text-heading-md text-secondary-white mb-4">Help & Support</h2>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-body-md text-secondary-white mb-1">Platform Walkthrough</p>
            <p className="text-body-sm text-medium-gray">
              Learn how to use Diffuse.ai with a quick guided tour. Available on desktop.
            </p>
          </div>
          <button
            onClick={openWalkthrough}
            data-walkthrough="walkthrough-button"
            className="hidden md:flex btn-secondary px-4 py-2 items-center gap-2 text-body-sm w-full sm:w-auto shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            View Walkthrough
          </button>
        </div>
      </div>

      {/* Delete Account */}
      <div className="glass-container p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <p className="text-body-sm text-medium-gray">
          Once you delete your account, there is no going back.
        </p>
        <button
          onClick={handleDeleteAccount}
          disabled={saving}
          className="w-full sm:w-auto shrink-0 px-4 py-2 text-body-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-glass hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          Delete Account
        </button>
      </div>
      </div>
    </div>
  )
}
