'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { DiffuseWorkspace, UserRole } from '@/types/database'

type SubscriptionTier = 'free' | 'pro' | 'pro_max' | 'contractor_pro'

interface UserProfile {
  id: string
  full_name: string | null
  subscription_tier: SubscriptionTier
  user_level: string
}

interface AuthContextType {
  user: User | null
  userProfile: UserProfile | null
  loading: boolean
  workspaces: Array<{ workspace: DiffuseWorkspace; role: UserRole }>
  currentWorkspace: DiffuseWorkspace | null
  setCurrentWorkspace: (workspace: DiffuseWorkspace) => void
  signOut: () => Promise<void>
  fetchWorkspaces: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [workspaces, setWorkspaces] = useState<Array<{ workspace: DiffuseWorkspace; role: UserRole }>>([])
  const [currentWorkspace, setCurrentWorkspace] = useState<DiffuseWorkspace | null>(null)
  const supabase = createClient()

  const fetchUserProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.warn('Could not fetch user profile:', error)
        setUserProfile({
          id: userId,
          full_name: null,
          subscription_tier: 'free',
          user_level: 'individual',
        })
        return
      }

      if (data) {
        setUserProfile(data)
      } else {
        // Create default profile if none exists
        const defaultProfile: UserProfile = {
          id: userId,
          full_name: null,
          subscription_tier: 'free',
          user_level: 'individual',
        }
        setUserProfile(defaultProfile)
      }
    } catch (error) {
      console.error('Error fetching user profile:', error)
      setUserProfile({
        id: userId,
        full_name: null,
        subscription_tier: 'free',
        user_level: 'individual',
      })
    }
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchWorkspaces(session.user.id)
        fetchUserProfile(session.user.id)
      }
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Keep the same `user` object reference across token refreshes and tab-focus events.
      // Supabase re-emits auth events (TOKEN_REFRESHED, and again on visibility change), and
      // handing out a fresh user object each time re-runs every effect that depends on `user`
      // (e.g. the recording page refetches and reloads the audio, which stops playback).
      setUser((prev) => {
        const next = session?.user ?? null
        if (prev && next && prev.id === next.id && event !== 'USER_UPDATED') {
          return prev
        }
        return next
      })
      if (session?.user) {
        // Only refetch on initial sign in, not on token refresh
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          fetchWorkspaces(session.user.id)
          fetchUserProfile(session.user.id)
        }
      } else {
        setWorkspaces([])
        setCurrentWorkspace(null)
        setUserProfile(null)
      }
      setLoading(false)
    })

    // Periodic session refresh every 10 minutes to keep tokens fresh
    // This ensures the user stays logged in even during long periods of inactivity
    const refreshInterval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        // Attempt to refresh the session
        await supabase.auth.refreshSession()
      }
    }, 10 * 60 * 1000) // 10 minutes

    return () => {
      subscription.unsubscribe()
      clearInterval(refreshInterval)
    }
  }, [])

  const fetchWorkspaces = async (userId: string) => {
    try {
      // First get the memberships
      const { data: memberships, error: memberError } = await supabase
        .from('diffuse_workspace_members')
        .select('role, workspace_id')
        .eq('user_id', userId)

      if (memberError) {
        console.error('Error fetching memberships:', memberError)
        setWorkspaces([])
        return
      }

      if (!memberships || memberships.length === 0) {
        setWorkspaces([])
        return
      }

      // Then get the workspaces separately
      const workspaceIds = memberships.map(m => m.workspace_id)
      const { data: workspacesData, error: workspaceError } = await supabase
        .from('diffuse_workspaces')
        .select('*')
        .in('id', workspaceIds)

      if (workspaceError) {
        console.error('Error fetching workspaces:', workspaceError)
        setWorkspaces([])
        return
      }

      if (workspacesData && workspacesData.length > 0) {
        const workspaceData = memberships.map((m: any) => ({
          workspace: workspacesData.find(w => w.id === m.workspace_id),
          role: m.role as UserRole,
        })).filter(w => w.workspace) // Filter out any null workspaces
        
        setWorkspaces(workspaceData)
        
        // Update currentWorkspace with fresh data, or set first if none selected
        if (currentWorkspace) {
          // Find the updated workspace data for the current workspace
          const updatedCurrentWorkspace = workspacesData.find(w => w.id === currentWorkspace.id)
          if (updatedCurrentWorkspace) {
            setCurrentWorkspace(updatedCurrentWorkspace)
          }
        } else if (workspaceData.length > 0) {
          setCurrentWorkspace(workspaceData[0].workspace)
        }
      } else {
        setWorkspaces([])
      }
    } catch (error) {
      console.error('Error in fetchWorkspaces:', error)
      setWorkspaces([])
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setUserProfile(null)
    setWorkspaces([])
    setCurrentWorkspace(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        loading,
        workspaces,
        currentWorkspace,
        setCurrentWorkspace,
        signOut,
        fetchWorkspaces: () => fetchWorkspaces(user?.id || ''),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

