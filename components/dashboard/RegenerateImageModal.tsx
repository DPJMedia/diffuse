'use client'

import { useState, useCallback } from 'react'
import { ModalShell, ModalHeader, ModalMetadataRow, ModalBody, ModalScrollRegion, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

export type RegenerateImageMode = 'scratch' | 'update'

export interface RegenerateImageModalProps {
  onClose: () => void
  /** When false, only “Start Fresh” is available (no image to refine). */
  canRefineCurrent: boolean
  /** Exactly one must be set — used to validate before POST. */
  outputId?: string
  inputId?: string
  /** POST `/api/workflow/regen-image` — server waits for n8n and writes pending image before resolving. */
  onSubmit: (args: { mode: RegenerateImageMode; comments: string }) => Promise<void>
  /** After successful regen; use to refetch output/input. */
  onComplete?: () => void
}

type Step = 'choose' | 'feedback'

export default function RegenerateImageModal({
  onClose,
  canRefineCurrent,
  outputId,
  inputId,
  onSubmit,
  onComplete,
}: RegenerateImageModalProps) {
  const [step, setStep] = useState<Step>('choose')
  const [mode, setMode] = useState<RegenerateImageMode | null>(null)
  const [comments, setComments] = useState('')

  const hasTargetId =
    (outputId != null && outputId !== '') || (inputId != null && inputId !== '')

  const handleCloseAttempt = useCallback(() => {
    onClose()
  }, [onClose])

  const chooseScratch = () => {
    setMode('scratch')
    setStep('feedback')
  }

  const chooseUpdate = () => {
    if (!canRefineCurrent) return
    setMode('update')
    setStep('feedback')
  }

  const handleBack = () => {
    setStep('choose')
    setMode(null)
    setComments('')
  }

  /** Same tokens as `btn-secondary` in globals.css (outline glass button) for both choices. */
  const choiceTileClassName =
    'w-full flex flex-col items-stretch text-left px-5 py-4 rounded-glass-sm border border-secondary-white/25 bg-dark-gray text-secondary-white font-medium transition-all duration-300 hover:brightness-[1.12] focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100'

  const handleSubmit = async () => {
    if (!mode || !comments.trim()) return
    if (!hasTargetId) {
      alert('Missing output or input id for regeneration.')
      return
    }
    onClose()
    try {
      await onSubmit({ mode, comments: comments.trim() })
      onComplete?.()
    } catch (err) {
      console.error('Regenerate image submit failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to submit')
    }
  }

  return (
    <ModalShell onClose={handleCloseAttempt} maxWidth="max-w-4xl" maxHeight="max-h-[90vh]" overlayClassName="z-[60]">
      <ModalHeader
        icon={<span className={MODAL_ICONS.generate.color}>{MODAL_ICONS.generate.icon}</span>}
        title="Regenerate Image"
        onClose={handleCloseAttempt}
      />
      {step === 'choose' ? (
        <>
          <ModalMetadataRow>
            <span className="text-medium-gray">Pick how you want the new cover image created.</span>
          </ModalMetadataRow>
          <ModalBody>
            <div className="flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={chooseScratch} className={`flex-1 ${choiceTileClassName}`}>
                <span className="block text-body-md font-medium text-secondary-white">Start Fresh</span>
                <span className="block text-body-sm font-normal text-medium-gray mt-1.5">
                  Generate a new image from your directions only, without using the current cover as reference.
                </span>
              </button>
              <button
                type="button"
                onClick={chooseUpdate}
                disabled={!canRefineCurrent}
                title={!canRefineCurrent ? 'Add or upload a cover image first' : undefined}
                className={`flex-1 ${choiceTileClassName}`}
              >
                <span className="block text-body-md font-medium text-secondary-white">Build on This Image</span>
                <span className="block text-body-sm font-normal text-medium-gray mt-1.5">
                  Use the existing cover as a starting point and revise it with your feedback.
                </span>
              </button>
            </div>
          </ModalBody>
          <ModalFooter>
            <button type="button" onClick={handleCloseAttempt} className="btn-secondary w-full py-3">
              Cancel
            </button>
          </ModalFooter>
        </>
      ) : (
        <>
          <ModalMetadataRow>
            <span className="text-medium-gray">
              {mode === 'scratch' ? (
                <>Starting fresh — describe what you want the new image to look like.</>
              ) : (
                <>Refining the current cover — describe what to change.</>
              )}
            </span>
          </ModalMetadataRow>
          <ModalBody>
            <ModalScrollRegion>
              <label htmlFor="regen-comments" className="block text-caption text-medium-gray uppercase tracking-wider mb-2">
                Feedback & directions
              </label>
              <textarea
                id="regen-comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="e.g. Warmer lighting, more editorial, less text in frame, swap background for a soft gradient…"
                rows={8}
                autoFocus
                tabIndex={0}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md placeholder:text-medium-gray/60 focus:outline-none focus:border-cosmic-orange transition-colors resize-none cursor-text"
                aria-label="Feedback and directions for image regeneration"
              />
            </ModalScrollRegion>
          </ModalBody>
          <ModalFooter>
            <button type="button" onClick={handleBack} className="btn-secondary flex-1 py-3">
              Back
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!comments.trim()}
              className="btn-primary flex-1 py-3 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              Send request
            </button>
          </ModalFooter>
        </>
      )}
    </ModalShell>
  )
}
