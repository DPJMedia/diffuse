'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'

interface WalkthroughContextType {
  isWalkthroughOpen: boolean
  currentStep: number
  hasCompletedWalkthrough: boolean
  openWalkthrough: () => void
  closeWalkthrough: () => void
  nextStep: () => void
  prevStep: () => void
  goToStep: (step: number) => void
  completeWalkthrough: () => void
  resetWalkthrough: () => void
}

const WalkthroughContext = createContext<WalkthroughContextType | undefined>(undefined)

const WALKTHROUGH_STORAGE_KEY = 'diffuse_walkthrough_completed'

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const supabase = createClient()
  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [hasCompletedWalkthrough, setHasCompletedWalkthrough] = useState(true) // Default true to prevent flash
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false)

  // Fetch walkthrough_dismissed from DB when user changes
  useEffect(() => {
    if (authLoading) return

    const getLocalCompleted = () => {
      if (typeof window === 'undefined') return false
      try {
        return localStorage.getItem(WALKTHROUGH_STORAGE_KEY) === 'true'
      } catch {
        return false
      }
    }

    const setLocalCompleted = (value: boolean) => {
      if (typeof window === 'undefined') return
      try {
        if (value) {
          localStorage.setItem(WALKTHROUGH_STORAGE_KEY, 'true')
        } else {
          localStorage.removeItem(WALKTHROUGH_STORAGE_KEY)
        }
      } catch {
        // ignore
      }
    }

    const checkDismissed = async () => {
      try {
        if (user) {
          // Skip walkthrough entirely if account is older than 24 hours
          const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0
          const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
          if (createdAt > 0 && createdAt < twentyFourHoursAgo) {
            setHasCompletedWalkthrough(true)
            setLocalCompleted(true)
            // Persist so we don't need to check again
            try {
              await supabase
                .from('user_profiles')
                .upsert({ id: user.id, walkthrough_dismissed: true }, { onConflict: 'id' })
            } catch {
              // ignore
            }
            setHasCheckedStorage(true)
            return
          }

          try {
            const { data, error } = await supabase
              .from('user_profiles')
              .select('walkthrough_dismissed')
              .eq('id', user.id)
              .single()

            if (!error && data?.walkthrough_dismissed === true) {
              setHasCompletedWalkthrough(true)
              setLocalCompleted(true)
            } else if (!error) {
              setHasCompletedWalkthrough(false)
            } else {
              setHasCompletedWalkthrough(getLocalCompleted())
            }
          } catch {
            setHasCompletedWalkthrough(getLocalCompleted())
          }
        } else {
          setHasCompletedWalkthrough(getLocalCompleted())
        }
      } catch {
        setHasCompletedWalkthrough(true) // Safe default on any error
      } finally {
        setHasCheckedStorage(true)
      }
    }

    checkDismissed()
  }, [user, authLoading, supabase])

  // Auto-open walkthrough when appropriate (after we've checked). Disabled on mobile.
  useEffect(() => {
    if (!hasCheckedStorage || hasCompletedWalkthrough) return

    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && window.innerWidth >= 768) {
        setIsWalkthroughOpen(true)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [hasCheckedStorage, hasCompletedWalkthrough])

  const openWalkthrough = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return // disabled on mobile
    setCurrentStep(0)
    setIsWalkthroughOpen(true)
  }

  const closeWalkthrough = () => {
    setIsWalkthroughOpen(false)
  }

  const nextStep = () => {
    setCurrentStep((prev) => prev + 1)
  }

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1))
  }

  const goToStep = (step: number) => {
    setCurrentStep(step)
  }

  const completeWalkthrough = async () => {
    // Persist to database when user is authenticated (upsert handles missing rows)
    if (user) {
      try {
        await supabase
          .from('user_profiles')
          .upsert({ id: user.id, walkthrough_dismissed: true }, { onConflict: 'id' })
      } catch (err) {
        console.warn('Could not update walkthrough_dismissed in DB:', err)
      }
    }

    // Always persist to localStorage as backup
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(WALKTHROUGH_STORAGE_KEY, 'true')
      } catch {
        // ignore
      }
    }
    setHasCompletedWalkthrough(true)
    setIsWalkthroughOpen(false)
  }

  const resetWalkthrough = () => {
    if (user) {
      Promise.resolve(
        supabase
          .from('user_profiles')
          .update({ walkthrough_dismissed: false })
          .eq('id', user.id)
      ).then(() => {}).catch(() => {})
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(WALKTHROUGH_STORAGE_KEY)
      } catch {
        // ignore
      }
    }
    setHasCompletedWalkthrough(false)
    setCurrentStep(0)
  }

  // Always render children - we default hasCompletedWalkthrough to true so we won't
  // auto-open until we've checked. This avoids a blank screen during init.
  return (
    <WalkthroughContext.Provider
      value={{
        isWalkthroughOpen,
        currentStep,
        hasCompletedWalkthrough,
        openWalkthrough,
        closeWalkthrough,
        nextStep,
        prevStep,
        goToStep,
        completeWalkthrough,
        resetWalkthrough,
      }}
    >
      {children}
    </WalkthroughContext.Provider>
  )
}

export function useWalkthrough() {
  const context = useContext(WalkthroughContext)
  if (context === undefined) {
    throw new Error('useWalkthrough must be used within a WalkthroughProvider')
  }
  return context
}
