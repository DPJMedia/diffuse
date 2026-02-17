'use client'

import { useState } from 'react'
import { ModalShell, ModalHeader, ModalMetadataRow, ModalBody, ModalScrollRegion, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

export interface ReEditCommentsModalProps {
  onClose: () => void
  onSubmit: (comments: string) => Promise<void>
}

export default function ReEditCommentsModal({ onClose, onSubmit }: ReEditCommentsModalProps) {
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
          className="btn-primary flex-1 py-3 disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Edit'}
        </button>
      </ModalFooter>
    </ModalShell>
  )
}
