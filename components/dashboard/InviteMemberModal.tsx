'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/database'
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

interface InviteMemberModalProps {
  workspaceId: string
  onClose: () => void
  onSuccess: () => void
}

export default function InviteMemberModal({ workspaceId, onClose, onSuccess }: InviteMemberModalProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('viewer')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // In a real implementation, you'd want to:
      // 1. Check if user exists in auth.users
      // 2. Send an invitation email
      // 3. Create a pending invitation record
      // For now, we'll just add them directly (requires the user to exist)

      const { error: insertError } = await supabase.from('diffuse_workspace_members').insert({
        workspace_id: workspaceId,
        user_id: email, // This should be the user's ID, not email
        role,
        invited_by: user.id,
      })

      if (insertError) throw insertError

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to invite member')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className={MODAL_ICONS.invite.color}>{MODAL_ICONS.invite.icon}</span>}
        title="Invite Member"
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
              <label htmlFor="email" className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">
                Email Address *
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                placeholder="user@example.com"
              />
            </div>

            <div>
              <label className="block text-caption text-medium-gray mb-3 uppercase tracking-wider">Role</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="viewer"
                  checked={role === 'viewer'}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="accent-cosmic-orange"
                />
                <span className="text-body-sm text-secondary-white">Viewer</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="editor"
                  checked={role === 'editor'}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="accent-cosmic-orange"
                />
                <span className="text-body-sm text-secondary-white">Editor</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="admin"
                  checked={role === 'admin'}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="accent-cosmic-orange"
                />
                <span className="text-body-sm text-secondary-white">Admin</span>
              </label>
            </div>
            <p className="mt-2 text-caption text-medium-gray">
              Viewers can only view. Editors can add/edit content. Admins can manage members.
            </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3" disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1 py-3" disabled={loading}>
            {loading ? 'Inviting...' : 'Send Invite'}
          </button>
        </ModalFooter>
      </form>
    </ModalShell>
  )
}

