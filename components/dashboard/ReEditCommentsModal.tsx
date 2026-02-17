'use client'

import { useState, useEffect } from 'react'
import { ModalShell, ModalHeader, ModalMetadataRow, ModalBody, ModalScrollRegion, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

const EDIT_STATUS_MESSAGES = [
  'Applying your feedback…',
  'Revising content…',
  'Updating article…',
  'Polishing edits…',
  'Almost there…',
]
const EDIT_STATUS_INTERVAL_MS = 3_000

export interface ReEditCommentsModalProps {
  onClose: () => void
  onSubmit: (comments: string) => Promise<void>
}

export default function ReEditCommentsModal({ onClose, onSubmit }: ReEditCommentsModalProps) {
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [statusIndex, setStatusIndex] = useState(0)

  useEffect(() => {
    if (!submitting) return
    setStatusIndex(0)
    const id = setInterval(() => {
      setStatusIndex((i) => (i + 1) % EDIT_STATUS_MESSAGES.length)
    }, EDIT_STATUS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [submitting])

  const handleSubmit = async () => {
    if (!comments.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(comments.trim())
      onClose()
    } catch (err) {
      console.error('Edit with Diffuse submit failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-4xl" maxHeight="max-h-[90vh]" overlayClassName="z-[60]">
      <ModalHeader
        icon={<span className={MODAL_ICONS.output.color}>{MODAL_ICONS.output.icon}</span>}
        title="Edit with Diffuse"
        onClose={onClose}
      />
      <ModalMetadataRow>
        <span className="text-medium-gray">Describe what you&apos;d like changed.</span>
      </ModalMetadataRow>
      <ModalBody>
        <ModalScrollRegion>
          <label htmlFor="reedit-comments" className="block text-caption text-medium-gray uppercase tracking-wider mb-2">
            Feedback & changes
          </label>
          <textarea
            id="reedit-comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="e.g. Make the tone more conversational, shorten the excerpt, add a section about..."
            rows={8}
            autoFocus
            tabIndex={0}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md placeholder:text-medium-gray/60 focus:outline-none focus:border-cosmic-orange transition-colors resize-none cursor-text"
            disabled={submitting}
            aria-label="Feedback and changes"
          />
        </ModalScrollRegion>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3" disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!comments.trim() || submitting}
          className="btn-primary flex-1 py-3 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <svg className="w-5 h-5 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {EDIT_STATUS_MESSAGES[statusIndex]}
            </>
          ) : (
            'Edit'
          )}
        </button>
      </ModalFooter>
    </ModalShell>
  )
}
