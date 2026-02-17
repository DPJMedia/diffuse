'use client'

import { useState } from 'react'
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

export interface QuickGenerateModalProps {
  onClose: () => void
  onGenerate: (outputType: 'article' | 'ad') => void
}

const optionRowClass =
  'w-full px-4 py-3 flex items-center gap-3 text-left rounded-glass border transition-colors text-body-sm'

const checkIcon = (
  <svg className="w-5 h-5 text-cosmic-orange flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

export default function QuickGenerateModal({ onClose, onGenerate }: QuickGenerateModalProps) {
  const [outputType, setOutputType] = useState<'article' | 'ad'>('article')

  const handleGenerate = () => {
    onGenerate(outputType)
    onClose()
  }

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className={MODAL_ICONS.generate.color}>{MODAL_ICONS.generate.icon}</span>}
        title="Choose output type"
        onClose={onClose}
      />
      <ModalBody>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setOutputType('article')}
            className={`${optionRowClass} ${
              outputType === 'article'
                ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                : 'border-white/10 hover:bg-white/5 text-secondary-white'
            }`}
          >
            {outputType === 'article' ? (
              checkIcon
            ) : (
              <svg className="w-5 h-5 text-accent-purple flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            <span>Article</span>
          </button>
          <button
            type="button"
            onClick={() => setOutputType('ad')}
            className={`${optionRowClass} ${
              outputType === 'ad'
                ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                : 'border-white/10 hover:bg-white/5 text-secondary-white'
            }`}
          >
            {outputType === 'ad' ? (
              checkIcon
            ) : (
              <svg className="w-5 h-5 text-cosmic-orange flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            )}
            <span>Advertisement</span>
          </button>
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3">
          Cancel
        </button>
        <button type="button" onClick={handleGenerate} className="btn-primary flex-1 py-3">
          Generate
        </button>
      </ModalFooter>
    </ModalShell>
  )
}
