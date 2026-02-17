'use client'

import { useState } from 'react'
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

interface UpgradeCodeModalProps {
  isOpen: boolean
  onClose: () => void
  onVerify: (code: string) => Promise<boolean>
  planName: string
  loading?: boolean
}

export default function UpgradeCodeModal({
  isOpen,
  onClose,
  onVerify,
  planName,
  loading = false,
}: UpgradeCodeModalProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setVerifying(true)

    try {
      const isValid = await onVerify(code.trim())
      if (!isValid) {
        setError('Invalid upgrade code. Please check and try again.')
      } else {
        setCode('')
        onClose()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify code')
    } finally {
      setVerifying(false)
    }
  }

  const handleClose = () => {
    setCode('')
    setError(null)
    onClose()
  }

  return (
    <ModalShell onClose={handleClose} maxWidth="max-w-md" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className={MODAL_ICONS.upgrade.color}>{MODAL_ICONS.upgrade.icon}</span>}
        title={`Upgrade to ${planName}`}
        onClose={handleClose}
      />
      <p className="text-body-sm text-medium-gray mb-6 flex-shrink-0">
        Enter your upgrade code to activate this plan
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label htmlFor="upgrade-code" className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">
                Upgrade Code
              </label>
              <input
                id="upgrade-code"
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setError(null)
                }}
                placeholder="Enter your code"
                required
                autoFocus
                className={`w-full px-4 py-3 bg-white/5 border rounded-glass text-secondary-white text-body-md focus:outline-none transition-colors ${
                  error ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-cosmic-orange'
                }`}
              />
              {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={handleClose}
            disabled={verifying || loading}
            className="btn-secondary flex-1 py-3 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={verifying || loading || !code.trim()}
            className="btn-primary flex-1 py-3 disabled:opacity-50"
          >
            {verifying || loading ? 'Upgrading...' : 'Upgrade'}
          </button>
        </ModalFooter>
      </form>
    </ModalShell>
  )
}
