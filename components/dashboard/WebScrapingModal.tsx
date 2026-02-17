'use client'

import { useState } from 'react'
import { ModalShell, ModalHeader, ModalBody, ModalFooter } from './ModalShell'

const GlobeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
)

export interface WebScrapingModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (data: {
    title: string
    content: string
    url: string
    description?: string
    scrapedAt?: string
  }) => void | Promise<void>
  projectId?: string
}

export default function WebScrapingModal({
  isOpen,
  onClose,
  onSuccess,
}: WebScrapingModalProps) {
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleScrape = async () => {
    setError(null)
    const trimmed = url.trim()
    if (!trimmed) {
      setError('Please enter a URL')
      return
    }
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setError('URL must start with http:// or https://')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      const result = await response.json()

      if (!result.success) {
        setError(result.error || 'Failed to scrape content')
        return
      }

      try {
        await Promise.resolve(onSuccess(result.data))
        handleClose()
      } catch (saveErr) {
        console.error('Save scraped content error:', saveErr)
        setError(saveErr instanceof Error ? saveErr.message : 'Failed to save scraped content')
      }
    } catch (err) {
      console.error('Scraping error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setUrl('')
    setError(null)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleScrape()
    }
  }

  if (!isOpen) return null

  return (
    <ModalShell onClose={handleClose} maxWidth="max-w-lg" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className="text-sky-400"><GlobeIcon className="w-6 h-6" /></span>}
        title="Scrape Web Content"
        onClose={handleClose}
      />
      <ModalBody>
        <p className="text-body-sm text-medium-gray mb-4">
          Enter a URL to extract content from a public webpage. The content will be saved as a project input.
        </p>
        <div className="space-y-2 mb-4">
          <label htmlFor="web-scrape-url" className="block text-caption text-medium-gray uppercase tracking-wider">
            Website URL
          </label>
          <input
            id="web-scrape-url"
            type="url"
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-glass border border-red-500/30 bg-red-500/10 text-red-400 text-body-sm">
            {error}
          </div>
        )}

        <p className="text-caption text-medium-gray">
          By providing a URL, you confirm you have permission to access and use this content. We cannot scrape sites that require authentication or block automated access.
        </p>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={handleClose}
          disabled={isLoading}
          className="btn-secondary flex-1 py-3 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleScrape}
          disabled={isLoading}
          className="btn-primary flex-1 py-3 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2 align-middle" />
              Scraping...
            </>
          ) : (
            'Scrape Content'
          )}
        </button>
      </ModalFooter>
    </ModalShell>
  )
}
