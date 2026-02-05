'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import UpgradeCodeModal from '@/components/dashboard/UpgradeCodeModal'

type SubscriptionTier = 'free' | 'pro' | 'pro_max'

interface UserProfile {
  id: string
  full_name: string | null
  subscription_tier: SubscriptionTier
  user_level: string
}

// Individual plans
const individualPlans = {
  free: { name: 'Free', projects: 3, price: '$0/mo', isEnterprise: false },
  pro: { name: 'Pro', projects: 15, price: '$20/mo', isEnterprise: false },
  pro_max: { name: 'Pro Max', projects: 40, price: '$60/mo', isEnterprise: false },
}

// Enterprise plans (for organizations) - based on projects
const enterprisePlans = {
  enterprise_pro: { name: 'Enterprise Pro', projects: 50, price: '$100/mo' },
  enterprise_pro_max: { name: 'Enterprise Pro Max', projects: 'Unlimited', price: '$500/mo' },
}

// Upgrade codes for each plan
const UPGRADE_CODES: Record<SubscriptionTier, string> = {
  free: '', // No code needed for free
  pro: 'diffusepro',
  pro_max: 'diffusepromax',
}

// Enterprise upgrade codes
const ENTERPRISE_UPGRADE_CODES: Record<string, string> = {
  enterprise_pro: '', // No code needed
  enterprise_pro_max: 'entpromax',
}

type EnterprisePlan = 'enterprise_pro' | 'enterprise_pro_max'

export default function SubscriptionPage() {
  const { user, currentWorkspace, fetchWorkspaces } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null)
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false)
  const [selectedEnterprisePlan, setSelectedEnterprisePlan] = useState<EnterprisePlan | null>(null)
  const supabase = createClient()

  const subscriptionDetails = individualPlans

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
        const defaultProfile = {
          id: user.id,
          full_name: null,
          subscription_tier: 'free' as SubscriptionTier,
          user_level: 'individual',
        }
        setProfile(defaultProfile)
        setLoading(false)
        return
      }

      if (data) {
        setProfile(data)
      } else {
        const newProfile = {
          id: user.id,
          full_name: null,
          subscription_tier: 'free' as SubscriptionTier,
          user_level: 'individual',
        }
        setProfile(newProfile)
      }
    } catch (error) {
      console.error('Error fetching profile:', error)
      setProfile({
        id: user.id,
        full_name: null,
        subscription_tier: 'free' as SubscriptionTier,
        user_level: 'individual',
      })
    } finally {
      setLoading(false)
    }
  }, [user, supabase])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const handleUpgradeClick = (tier: SubscriptionTier) => {
    const currentTierValue = getTierValue(currentTier)
    const newTierValue = getTierValue(tier)
    
    // Free tier doesn't need a code
    // Downgrades don't need a code
    if (tier === 'free' || newTierValue < currentTierValue) {
      handleChangeSubscription(tier)
      return
    }

    // Upgrades to Pro and Pro Max require code
    setSelectedTier(tier)
    setShowUpgradeModal(true)
  }

  // Helper function to determine tier hierarchy
  const getTierValue = (tier: SubscriptionTier): number => {
    const tierValues: Record<SubscriptionTier, number> = {
      free: 0,
      pro: 1,
      pro_max: 2,
    }
    return tierValues[tier] || 0
  }

  const handleVerifyCode = async (code: string): Promise<boolean> => {
    if (!selectedTier) return false

    const expectedCode = UPGRADE_CODES[selectedTier]
    if (code.toLowerCase() !== expectedCode.toLowerCase()) {
      return false
    }

    // Code is valid, proceed with upgrade
    await handleChangeSubscription(selectedTier)
    return true
  }

  const handleChangeSubscription = async (tier: SubscriptionTier) => {
    if (!user) return

    setSaving(true)
    setMessage(null)

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ subscription_tier: tier })
        .eq('id', user.id)

      if (error) throw error

      // Silently update - no success message
      fetchProfile()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to update plan' })
      throw error
    } finally {
      setSaving(false)
    }
  }

  const handleEnterpriseUpgradeClick = (plan: EnterprisePlan) => {
    if (!currentWorkspace) {
      setMessage({ type: 'error', text: 'Please create or join an organization first' })
      return
    }

    const currentEnterpriseTier = currentWorkspace.plan ? getEnterpriseTierValue(currentWorkspace.plan) : -1
    const targetEnterpriseTier = getEnterpriseTierValue(plan)
    
    // If downgrading or upgrading to enterprise_pro (no code needed), change immediately
    if (targetEnterpriseTier < currentEnterpriseTier || plan === 'enterprise_pro') {
      handleChangeEnterprisePlan(plan)
      return
    }

    // Otherwise, show modal for code verification
    setSelectedEnterprisePlan(plan)
    setShowEnterpriseModal(true)
  }

  const handleVerifyEnterpriseCode = async (code: string): Promise<boolean> => {
    if (!selectedEnterprisePlan) return false

    const expectedCode = ENTERPRISE_UPGRADE_CODES[selectedEnterprisePlan]
    if (code.toLowerCase() !== expectedCode.toLowerCase()) {
      return false
    }

    // Code is valid, proceed with upgrade
    await handleChangeEnterprisePlan(selectedEnterprisePlan)
    return true
  }

  const handleChangeEnterprisePlan = async (plan: EnterprisePlan) => {
    if (!currentWorkspace) return

    setSaving(true)
    setMessage(null)

    try {
      const { error } = await supabase
        .from('diffuse_workspaces')
        .update({ plan })
        .eq('id', currentWorkspace.id)

      if (error) throw error

      // Silently update - no success message
      await fetchWorkspaces()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to update organization plan' })
      throw error
    } finally {
      setSaving(false)
    }
  }

  const getEnterpriseTierValue = (planKey: string): number => {
    return planKey === 'enterprise_pro' ? 0 : 1
  }

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  // Ensure we have a valid subscription tier, default to 'free'
  const currentTier: SubscriptionTier = profile.subscription_tier && subscriptionDetails[profile.subscription_tier] 
    ? profile.subscription_tier 
    : 'free'

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 data-walkthrough="page-title" className="text-display-sm text-secondary-white">Plans</h1>
          <p className="text-body-md text-medium-gray mt-1">
            View and change your plan tier
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

      {/* Individual Plans */}
      <div className="mb-12">
        <h2 className="text-heading-lg text-secondary-white mb-6">Individual Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(Object.keys(subscriptionDetails) as SubscriptionTier[]).map((tier) => {
            const sub = subscriptionDetails[tier]
            const isCurrentPlan = tier === currentTier
            
            return (
              <div
                key={tier}
                className={`glass-container p-6 border ${isCurrentPlan ? 'border-cosmic-orange/50' : 'border-white/10'}`}
              >
                <h3 className="text-heading-md text-secondary-white mb-2">{sub.name}</h3>
                <p className="text-body-sm text-medium-gray mb-6">
                  {sub.name === 'Free' ? 'Get started with project capacity' : 'Includes project capacity'}
                </p>

                {isCurrentPlan ? (
                  <button
                    onClick={() => window.location.href = '/dashboard/projects'}
                    className="w-full py-3 text-body-md font-medium rounded-glass bg-cosmic-orange text-black hover:bg-rich-orange transition-colors cursor-pointer"
                  >
                    Active
                  </button>
                ) : (
                  <button
                    onClick={() => handleUpgradeClick(tier)}
                    disabled={saving}
                    className="btn-secondary w-full py-3 text-body-md disabled:opacity-50"
                  >
                    {getTierValue(tier) < getTierValue(currentTier) ? 'Downgrade' : 'Upgrade'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Enterprise Plans */}
      <div>
        <h2 className="text-heading-lg text-secondary-white mb-6">Enterprise Plans</h2>
        {!currentWorkspace ? (
          <div className="glass-container p-6 border border-white/10 mb-6">
            <p className="text-body-md text-medium-gray text-center">
              Please{' '}
              <a href="/dashboard/organization" className="text-cosmic-orange hover:underline">
                create or join an organization
              </a>{' '}
              to access enterprise plans.
            </p>
          </div>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.entries(enterprisePlans).map(([key, plan]) => {
            const isCurrentPlan = currentWorkspace?.plan === key
            
            const currentEnterpriseTier = currentWorkspace?.plan ? getEnterpriseTierValue(currentWorkspace.plan) : -1
            const targetEnterpriseTier = getEnterpriseTierValue(key)
            const isDowngrade = currentEnterpriseTier > targetEnterpriseTier
            
            return (
              <div
                key={key}
                className={`glass-container p-6 border ${isCurrentPlan ? 'border-cosmic-orange/50' : 'border-white/10'}`}
              >
                <h3 className="text-heading-md text-secondary-white mb-2">{plan.name}</h3>
                <p className="text-body-sm text-medium-gray mb-6">
                  Includes project capacity for your organization
                </p>

                {isCurrentPlan ? (
                  <button
                    onClick={() => window.location.href = '/dashboard/organization'}
                    className="w-full py-3 text-body-md font-medium rounded-glass bg-cosmic-orange text-black hover:bg-rich-orange transition-colors cursor-pointer"
                  >
                    Active
                  </button>
                ) : (
                  <button
                    onClick={() => handleEnterpriseUpgradeClick(key as EnterprisePlan)}
                    disabled={saving || !currentWorkspace}
                    className="btn-secondary w-full py-3 text-body-md disabled:opacity-50"
                  >
                    {isDowngrade ? 'Downgrade' : 'Upgrade'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Upgrade Code Modal - Individual Plans */}
      {selectedTier && (
        <UpgradeCodeModal
          isOpen={showUpgradeModal}
          onClose={() => {
            setShowUpgradeModal(false)
            setSelectedTier(null)
          }}
          onVerify={handleVerifyCode}
          planName={subscriptionDetails[selectedTier].name}
          loading={saving}
        />
      )}

      {/* Upgrade Code Modal - Enterprise Plans */}
      {selectedEnterprisePlan && (
        <UpgradeCodeModal
          isOpen={showEnterpriseModal}
          onClose={() => {
            setShowEnterpriseModal(false)
            setSelectedEnterprisePlan(null)
          }}
          onVerify={handleVerifyEnterpriseCode}
          planName={enterprisePlans[selectedEnterprisePlan].name}
          loading={saving}
        />
      )}
    </div>
  )
}

