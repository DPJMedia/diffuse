'use client'

import { useBodyScrollLock } from './ModalShell'

export interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning'
  isLoading?: boolean
}

/**
 * Reusable confirmation modal for destructive actions.
 * Matches the existing modal patterns in the dashboard.
 */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmModalProps) {
  useBodyScrollLock(isOpen)

  if (!isOpen) return null

  const confirmButtonClass =
    variant === 'danger' ? 'btn-primary !bg-red-600 hover:!bg-red-600' : 'btn-primary'

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="glass-container bg-dark-gray/95 backdrop-blur-glass p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-heading-md text-secondary-white font-medium mb-2">
          {title}
        </h2>
        <p className="text-body-sm text-medium-gray mb-6">
          {message}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="btn-secondary flex-1 py-3 disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            disabled={isLoading}
            className={`${confirmButtonClass} flex-1 py-3 disabled:opacity-50`}
          >
            {isLoading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
