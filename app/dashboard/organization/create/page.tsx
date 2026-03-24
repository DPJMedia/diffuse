'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
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

export default function CreateOrganizationPage() {
  const router = useRouter()
  const { user, setCurrentWorkspace, fetchWorkspaces } = useAuth()
  const supabase = createClient()
  
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [plan, setPlan] = useState<OrganizationPlan>('enterprise_pro')
  const [upgradeCode, setUpgradeCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showUpgradeCodeInput, setShowUpgradeCodeInput] = useState(false)

  const generateOrgCode = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // If Enterprise Pro Max is selected, show upgrade code input
    if (plan === 'enterprise_pro_max' && !showUpgradeCodeInput) {
      setShowUpgradeCodeInput(true)
      return
    }

    // Verify upgrade code if needed
    if (plan === 'enterprise_pro_max') {
      const expectedCode = ENTERPRISE_CODES[plan]
      if (upgradeCode.toLowerCase() !== expectedCode.toLowerCase()) {
        setError('Invalid upgrade code')
        return
      }
    }

    setLoading(true)
    setError('')

    try {
      if (!user) throw new Error('Not authenticated')

      const inviteCode = generateOrgCode()

      // Create organization with plan
      const { data: newOrg, error: orgError } = await supabase
        .from('diffuse_workspaces')
        .insert({
          name,
          description: description || null,
          invite_code: inviteCode,
          plan,
          owner_id: user.id,
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
          user_id: user.id,
          role: 'admin',
        })

      if (memberError) throw memberError

      // Refresh workspaces list and set the new org as current
      await fetchWorkspaces()
      setCurrentWorkspace(newOrg)

      router.push(`/dashboard/organization/${newOrg.id}`)
    } catch (err: any) {
      setError(err.message || 'Failed to create organization')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
      <div className="w-full max-w-2xl">
        <h1 className="text-heading-lg text-secondary-white mb-8">Create an organization</h1>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 rounded-glass border border-red-500/30 bg-red-500/10 text-red-400 text-body-sm">
              {error}
            </div>
          )}

          {/* Organization Name */}
          <div>
            <label htmlFor="name" className="block text-body-sm text-medium-gray mb-2">
              Organization name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors placeholder:text-medium-gray/50"
              placeholder="Acme News Corp"
              autoFocus
            />
          </div>

          {/* Organization Description */}
          <div>
            <label htmlFor="description" className="block text-body-sm text-medium-gray mb-2">
              Description (optional)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors resize-none placeholder:text-medium-gray/50"
              placeholder="Local news organization..."
            />
          </div>

          {/* Enterprise Plan */}
          <div>
            <label className="block text-body-sm text-medium-gray mb-2">
              Enterprise plan
            </label>
            <div className="bg-white/5 border border-white/10 rounded-glass p-6">
              <div className="space-y-2">
                {Object.entries(planDetails).map(([key, planDetail]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPlan(key as OrganizationPlan)
                      setShowUpgradeCodeInput(false)
                      setUpgradeCode('')
                      setError('')
                    }}
                    className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <div className="flex flex-col">
                      <span className="text-body-sm text-secondary-white">{planDetail.name}</span>
                      <span className="text-caption text-medium-gray">
                        {typeof planDetail.projects === 'number' ? `${planDetail.projects} projects` : planDetail.projects}
                      </span>
                    </div>
                    {plan === key && (
                      <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Upgrade Code Input (only for Enterprise Pro Max) */}
          {showUpgradeCodeInput && plan === 'enterprise_pro_max' && (
            <div>
              <label htmlFor="upgrade-code" className="block text-body-sm text-medium-gray mb-2">
                Upgrade code
              </label>
              <input
                id="upgrade-code"
                type="text"
                value={upgradeCode}
                onChange={(e) => {
                  setUpgradeCode(e.target.value)
                  setError('')
                }}
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors placeholder:text-medium-gray/50"
                placeholder="Enter upgrade code"
              />
            </div>
          )}

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
              disabled={loading || !name.trim()}
            >
              {loading ? 'Creating...' : showUpgradeCodeInput && plan === 'enterprise_pro_max' ? 'Verify & Create' : 'Create organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
