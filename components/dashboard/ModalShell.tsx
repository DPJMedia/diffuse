'use client'

import type { ReactNode } from 'react'

export interface ModalShellProps {
  /** Click overlay to close */
  onClose: () => void
  /** Modal content (body). Shell has overflow-hidden; put scroll only on inner regions. */
  children: ReactNode
  /** Optional max width class, e.g. max-w-4xl, max-w-md */
  maxWidth?: string
  /** Optional max height class, e.g. max-h-[90vh] */
  maxHeight?: string
  /** Optional extra class on the inner glass container */
  className?: string
  /** Optional extra class on the overlay (e.g. z-[60] for nested modals) */
  overlayClassName?: string
}

/**
 * Shared modal shell: overlay + glass container, overflow-hidden (no shell scroll).
 * Use for structure only; header/metadata/footer are composed by each modal.
 */
export function ModalShell({
  onClose,
  children,
  maxWidth = 'max-w-4xl',
  maxHeight = 'max-h-[90vh]',
  className = '',
  overlayClassName = '',
}: ModalShellProps) {
  return (
    <div
      className={`fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${overlayClassName}`.trim()}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`glass-container p-8 w-full ${maxWidth} ${maxHeight} overflow-hidden flex flex-col ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export interface ModalHeaderProps {
  /** Icon element (e.g. from MODAL_ICONS), already w-6 h-6 and colored */
  icon: ReactNode
  title: string
  /** Optional badge next to title, e.g. "Editable" */
  badge?: ReactNode
  /** Top-right actions: custom buttons + close. Pass array of buttons; close is appended if not included. */
  actions?: ReactNode
  onClose: () => void
}

export function ModalHeader({ icon, title, badge, actions, onClose }: ModalHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        {icon}
        <h2 className="text-heading-lg text-secondary-white">{title}</h2>
        {badge}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full text-medium-gray hover:text-secondary-white hover:bg-white/10 transition-colors"
          title="Close"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export interface ModalMetadataRowProps {
  /** e.g. STATUS • Date/time - use orange for type/status, medium-gray for date */
  children: ReactNode
}

export function ModalMetadataRow({ children }: ModalMetadataRowProps) {
  return (
    <div className="flex items-center gap-2 text-body-sm text-medium-gray mb-6 flex-shrink-0">
      {children}
    </div>
  )
}

/** Body wrapper: flex-1 min-h-0, no overflow (so shell never scrolls). Put overflow-y-auto on inner content that should scroll. */
export function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex-1 min-h-0 flex flex-col ${className}`}>
      {children}
    </div>
  )
}

/** Inner scroll region: use for long content so only this box scrolls */
export function ModalScrollRegion({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2 -mr-2 ${className}`}>
      {children}
    </div>
  )
}

export interface ModalFooterProps {
  /** Left/center secondary buttons, then right primary. Use btn-secondary and btn-primary. */
  children: ReactNode
}

export function ModalFooter({ children }: ModalFooterProps) {
  return (
    <div className="mt-6 flex gap-3 flex-shrink-0 flex-wrap items-center justify-end">
      {children}
    </div>
  )
}
