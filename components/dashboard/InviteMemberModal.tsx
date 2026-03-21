'use client'

import { useState } from 'react'
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

interface InviteMemberModalProps {
  onClose: () => void
  onSuccess: () => void
}

export default function InviteMemberModal({ onClose, onSuccess }: InviteMemberModalProps) {
  const [emailsText, setEmailsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setConfirmation(null)

    try {
      const emails = emailsText
        .split(/[,;\n]+/g)
        .flatMap((chunk) => chunk.split(/\s+/g))
        .map((s) => s.trim())
        .filter(Boolean)

      if (emails.length === 0) {
        throw new Error('Please enter at least one email address.')
      }

      const res = await fetch('/api/platform/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails,
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const message = data?.message || data?.error || 'Failed to send invites'
        throw new Error(message)
      }

      const invitedCount = data?.invited ?? emails.length
      setConfirmation(`Invites sent to ${invitedCount} email${invitedCount === 1 ? '' : 's'}.`)

      // Step 3/4: confirm, then close the pop-up.
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 900)
    } catch (err: any) {
      setError(err.message || 'Failed to invite user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className={MODAL_ICONS.invite.color}>{MODAL_ICONS.invite.icon}</span>}
        title="Invite user"
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
            {confirmation && (
              <div className="mb-6 p-4 rounded-glass border border-cosmic-orange/30 bg-cosmic-orange/10 text-cosmic-orange text-body-sm flex-shrink-0">
                {confirmation}
              </div>
            )}

            <div>
              <label
                htmlFor="emails"
                className="block text-caption text-medium-gray mb-2 uppercase tracking-wider"
              >
                Email address(es) *
              </label>
              <textarea
                id="emails"
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                required
                rows={4}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                placeholder="user1@example.com, user2@example.com"
              />
              <p className="mt-2 text-caption text-medium-gray">
                Separate multiple emails with commas, spaces, or new lines.
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          {confirmation ? (
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 py-3"
              disabled={loading}
            >
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3" disabled={loading}>
                Cancel
              </button>
              <button type="submit" className="btn-primary flex-1 py-3" disabled={loading}>
                {loading ? 'Sending...' : 'Send Invite'}
              </button>
            </>
          )}
        </ModalFooter>
      </form>
    </ModalShell>
  )
}

