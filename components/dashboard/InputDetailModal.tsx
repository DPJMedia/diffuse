'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, formatDuration, sanitizeStorageFilename } from '@/lib/utils/format'
import type { DiffuseProjectInput } from '@/types/database'
import { ModalShell, ModalHeader, ModalMetadataRow, ModalBody, ModalScrollRegion, ModalFooter } from './ModalShell'
import RegenerateImageModal from './RegenerateImageModal'
import CoverRegenerationLayer, { type CoverRegenPhase } from './CoverRegenerationLayer'
import HighlightedDiff from './HighlightedDiff'

interface InputDetailModalProps {
  input: DiffuseProjectInput
  onClose: () => void
  onSave?: (id: string, title: string, content: string, metadata?: Record<string, unknown>) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onUpdate?: () => void
  canEdit?: boolean
  canDelete?: boolean
}

export default function InputDetailModal({ input, onClose, onSave, onDelete, onUpdate, canEdit = true, canDelete = true }: InputDetailModalProps) {
  const [title, setTitle] = useState(input.file_name || '')
  const [content, setContent] = useState(input.content || '')
  const [photoCaption, setPhotoCaption] = useState((input.metadata?.photo_caption as string) ?? '')
  const [photoCredit, setPhotoCredit] = useState((input.metadata?.photo_credit as string) ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [showRegenImageModal, setShowRegenImageModal] = useState(false)
  const [uploadingCoverFile, setUploadingCoverFile] = useState(false)
  const [organizing, setOrganizing] = useState(false)
  const [organizedContent, setOrganizedContent] = useState<string | null>(null)
  const [hasApprovedOrganizedPendingSave, setHasApprovedOrganizedPendingSave] = useState(false)
  const [regenPhase, setRegenPhase] = useState<CoverRegenPhase>('idle')
  const [regenSnapshotUrl, setRegenSnapshotUrl] = useState<string | null>(null)
  const [sharpCacheKey, setSharpCacheKey] = useState(0)
  const [regenReviewState, setRegenReviewState] = useState<{
    proposedCaption: string | null
    proposedCredit: string | null
    previousCaption: string | null
    previousCredit: string | null
    pendingImagePath: string
  } | null>(null)
  const [regenFieldApprovals, setRegenFieldApprovals] = useState<Partial<Record<'cover_image', boolean>>>({})
  const [applyingRegen, setApplyingRegen] = useState(false)

  // Content search state
  const [contentSearchQuery, setContentSearchQuery] = useState('')
  const [contentSearchCurrentMatch, setContentSearchCurrentMatch] = useState(0)
  const [contentSearchMatchCount, setContentSearchMatchCount] = useState(0)
  const [showContentSearch, setShowContentSearch] = useState(false)
  const contentSearchInputRef = useRef<HTMLInputElement>(null)

  const coverUploadInputRef = useRef<HTMLInputElement>(null)
  const scrapedContentRef = useRef<HTMLDivElement>(null)
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const isFromRecording = input.metadata?.source === 'recording'
  const isWebScrape = input.type === 'web_scrape'
  const hasBeenOrganized = input.metadata?.organized_with_ai === true
  const isFromUpload = input.metadata?.source === 'upload'
  const isImage = input.type === 'image'
  const isCoverPhoto = input.type === 'cover_photo'
  const isDocument = input.type === 'document'
  const isAudio = input.type === 'audio'
  const showSaveButton = canEdit && (onSave || isImage)
  const showDeleteButton = canDelete && onDelete
  
  // Get type info for display (accent colors match project page cards: no orange/purple)
  const getTypeInfo = () => {
    if (isFromRecording) {
      return { label: 'RECORDING', color: 'text-rose-400', icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )}
    }
    switch (input.type) {
      case 'audio':
        return { label: 'AUDIO', color: 'text-fuchsia-400', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        )}
      case 'document':
        return { label: 'DOCUMENT', color: 'text-emerald-400', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )}
      case 'image':
        return { label: 'IMAGE', color: 'text-yellow-400', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      case 'cover_photo':
        return { label: 'COVER PHOTO', color: 'text-lime-400', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      case 'web_scrape':
        return { label: 'WEB SCRAPE', color: 'text-sky-400', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        )}
      default:
        return { label: 'TEXT', color: 'text-indigo-400', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )}
    }
  }
  
  const typeInfo = getTypeInfo()

  // Sync title, content, photo caption, and photo credit when input is updated from parent or when opening a different input
  useEffect(() => {
    setTitle(input.file_name || '')
    setContent(input.content || '')
    setPhotoCaption((input.metadata?.photo_caption as string) ?? '')
    setPhotoCredit((input.metadata?.photo_credit as string) ?? '')
    setOrganizedContent(null)
    setHasApprovedOrganizedPendingSave(false)
  }, [input.id, input.file_name, input.content, input.metadata?.photo_caption, input.metadata?.photo_credit])

  // Content search: compute match count when query or content changes
  const isTextContent = !isImage && !isCoverPhoto
  useEffect(() => {
    if (!contentSearchQuery.trim() || !content) {
      setContentSearchMatchCount(0)
      setContentSearchCurrentMatch(0)
      return
    }
    const escaped = contentSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const matches = content.match(regex)
    setContentSearchMatchCount(matches ? matches.length : 0)
    setContentSearchCurrentMatch(0)
  }, [contentSearchQuery, content])

  // Scroll to current match when index changes
  useEffect(() => {
    if (!contentSearchQuery.trim() || contentSearchMatchCount === 0) return
    const el = document.querySelector(`[data-content-match="${contentSearchCurrentMatch}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [contentSearchCurrentMatch, contentSearchQuery, contentSearchMatchCount])

  // Keyboard shortcut: Cmd/Ctrl+F opens content search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        if (isTextContent && content) {
          e.preventDefault()
          setShowContentSearch(true)
          setTimeout(() => contentSearchInputRef.current?.focus(), 50)
        }
      }
      if (e.key === 'Escape' && showContentSearch) {
        setShowContentSearch(false)
        setContentSearchQuery('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showContentSearch, isTextContent, content])

  function renderContentWithHighlights(text: string, query: string, currentMatch: number): React.ReactNode {
    if (!query.trim()) return text
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const nodes: React.ReactNode[] = []
    let lastIndex = 0
    let count = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
      nodes.push(
        <mark
          key={`cm-${count}`}
          data-content-match={count}
          className={`rounded px-0.5 ${count === currentMatch ? 'bg-cosmic-orange text-black' : 'bg-cosmic-orange/30 text-secondary-white'}`}
        >
          {match[0]}
        </mark>
      )
      count++
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
    return nodes.length > 0 ? nodes : text
  }

  const handleOrganize = async () => {
    if (!content?.trim() || organizing) return
    setOrganizing(true)
    setOrganizedContent(null)
    try {
      const res = await fetch('/api/organize-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || `Failed to organize (${res.status})`)
      }
      const next = data?.organizedContent
      if (typeof next !== 'string' || !next.trim()) {
        throw new Error(data?.error || 'No organized content returned. Try again.')
      }
      setOrganizedContent(next.trim())
      setTimeout(() => scrapedContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Failed to organize content')
    } finally {
      setOrganizing(false)
    }
  }

  const handleAcceptOrganized = () => {
    if (!organizedContent) return
    setContent(organizedContent)
    setOrganizedContent(null)
    setHasApprovedOrganizedPendingSave(true)
  }

  const handleDeclineOrganized = () => {
    setOrganizedContent(null)
  }

  // Cover photo: use API so anyone with project access can load it (no signed-URL encoding issues)
  const coverPhotoApiUrl = isCoverPhoto && input.file_path
    ? `/api/project-file?path=${encodeURIComponent(input.file_path)}`
    : null
  const coverDisplayUrl = coverImageUrl ?? coverPhotoApiUrl
  const canRefineCoverInput = !!(input.file_path || input.metadata?.storage_url)
  const displayCoverForRegen = coverDisplayUrl ?? (input.metadata?.storage_url as string | undefined) ?? ''

  const regenPendingPath =
    (input.metadata?.regen_image as { pending?: { cover_photo_path?: string } } | undefined)?.pending
      ?.cover_photo_path ?? null
  const pendingCoverUrl = regenPendingPath
    ? `/api/project-file?path=${encodeURIComponent(regenPendingPath)}`
    : null

  const sharpRevealBase =
    regenPhase === 'check' && sharpCacheKey
      ? (pendingCoverUrl ?? displayCoverForRegen)
      : null
  const sharpRevealUrl =
    sharpRevealBase
      ? `${sharpRevealBase}${sharpRevealBase.includes('?') ? '&' : '?'}cb=${sharpCacheKey}`
      : null
  const regenSharpUrl = regenFieldApprovals.cover_image === false ? null : sharpRevealUrl

  const showRegenDiff = !!regenReviewState && isCoverPhoto
  const hasRegenCaptionChange =
    !!regenReviewState &&
    (regenReviewState.previousCaption ?? '') !== (regenReviewState.proposedCaption ?? '')
  const hasRegenCreditChange =
    !!regenReviewState &&
    (regenReviewState.previousCredit ?? '') !== (regenReviewState.proposedCredit ?? '')

  // Image inputs (e.g. workflow-generated): same retrieval as output section; use project-file API when we have file_path
  const imageInputDisplayUrl = isImage && input.file_path
    ? `/api/project-file?path=${encodeURIComponent(input.file_path)}`
    : (isImage && input.metadata?.storage_url ? input.metadata.storage_url as string : null)

  useEffect(() => {
    setCoverImageUrl(null)
  }, [input.id, input.file_path])

  useEffect(() => {
    setRegenPhase('idle')
    setRegenSnapshotUrl(null)
    setSharpCacheKey(0)
    setRegenReviewState(null)
    setRegenFieldApprovals({})
  }, [input.id])

  /** Regen complete (sync API): show review (check). From `processing`, blur fades to the new image. */
  useEffect(() => {
    const st = (input.metadata?.regen_image as { status?: string; pending?: unknown } | undefined)?.status
    const pending = (input.metadata?.regen_image as { pending?: unknown } | undefined)?.pending
    if (st !== 'complete' || !pending) return
    if (regenPhase === 'check') return
    if (regenPhase !== 'idle' && regenPhase !== 'processing') return
    const snap = displayCoverForRegen || pendingCoverUrl
    if (!snap) return
    setRegenSnapshotUrl((s) => s ?? snap)
    setSharpCacheKey(Date.now())
    setRegenPhase('check')
  }, [input.metadata?.regen_image, displayCoverForRegen, pendingCoverUrl, regenPhase, input.id])

  useEffect(() => {
    const ri = input.metadata?.regen_image as {
      status?: string
      pending?: {
        cover_photo_path: string
        photo_caption: string | null
        photo_credit: string | null
      }
    } | undefined
    const p = ri?.pending?.cover_photo_path
    if (ri?.status !== 'complete' || !ri.pending || !p) {
      setRegenReviewState(null)
      setRegenFieldApprovals({})
      return
    }
    setRegenReviewState((prev) => {
      if (prev?.pendingImagePath === p) return prev
      return {
        proposedCaption: ri.pending!.photo_caption,
        proposedCredit: ri.pending!.photo_credit,
        previousCaption: (input.metadata?.photo_caption as string) ?? null,
        previousCredit: (input.metadata?.photo_credit as string) ?? null,
        pendingImagePath: ri.pending!.cover_photo_path,
      }
    })
  }, [input.metadata?.regen_image, input.id, input.metadata?.photo_caption, input.metadata?.photo_credit])

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(field)
      setTimeout(() => setCopied(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const handleReplaceCoverPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !canEdit || !isCoverPhoto) return
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg']
    if (!validTypes.includes(file.type)) {
      alert('Please select a JPG or PNG image.')
      e.target.value = ''
      return
    }
    const maxSize = 20 * 1024 * 1024
    if (file.size > maxSize) {
      alert('Image is too large. Maximum size is 20MB.')
      e.target.value = ''
      return
    }
    setUploadingCoverFile(true)
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser) throw new Error('Not authenticated')
      const filePath = `${currentUser.id}/${input.project_id}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(filePath, file, {
          contentType: (file.type && /^image\/(jpeg|png|jpg)$/i.test(file.type)) ? file.type : 'image/jpeg',
          upsert: false,
        })
      if (uploadError) throw uploadError
      const { data: signedData } = await supabase.storage
        .from('project-files')
        .createSignedUrl(filePath, 60 * 60 * 24 * 365)
      const { error: updateError } = await supabase
        .from('diffuse_project_inputs')
        .update({
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          metadata: {
            ...input.metadata,
            source: 'upload',
            storage_url: signedData?.signedUrl ?? null,
            photo_credit: photoCredit?.trim() || undefined,
          },
        })
        .eq('id', input.id)
      if (updateError) throw updateError
      // Attach cover to all existing outputs so image section shows it
      await supabase
        .from('diffuse_project_outputs')
        .update({ cover_photo_path: filePath })
        .eq('project_id', input.project_id)
        .is('deleted_at', null)
      setCoverImageUrl(filePath ? `/api/project-file?path=${encodeURIComponent(filePath)}` : null)
      onUpdate?.()
    } catch (err) {
      console.error('Replace cover photo failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to replace cover photo')
    } finally {
      setUploadingCoverFile(false)
      e.target.value = ''
    }
  }

  const handleRegenImageSubmit = async ({ mode, comments }: { mode: 'scratch' | 'update'; comments: string }) => {
    if (!displayCoverForRegen) {
      throw new Error('Add or upload a cover image first.')
    }
    const snap =
      typeof displayCoverForRegen === 'string' && displayCoverForRegen.startsWith('/')
        ? displayCoverForRegen
        : coverDisplayUrl ?? (input.metadata?.storage_url as string | undefined) ?? displayCoverForRegen
    setRegenSnapshotUrl(snap)
    setRegenPhase('processing')
    try {
      const res = await fetch('/api/workflow/regen-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_id: input.id, mode, comments }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as {
          error?: string
          message?: string
          n8n_status?: number
          n8n_detail?: string
        }
        const parts = [
          data?.message || data?.error || 'Request failed',
          data?.n8n_status != null ? `n8n HTTP ${data.n8n_status}` : null,
          data?.n8n_detail,
        ].filter(Boolean)
        throw new Error(parts.join(' — '))
      }
    } catch (e) {
      setRegenPhase('idle')
      setRegenSnapshotUrl(null)
      throw e
    }
  }

  const getRegenCreditDisplay = () => {
    if (!regenReviewState) return photoCredit
    return regenReviewState.proposedCredit ?? ''
  }

  const handleDenyRegenField = (field: 'cover_image') => {
    if (!regenReviewState) return
    setRegenFieldApprovals((prev) => ({ ...prev, [field]: false }))
  }

  const handleApplyRegenReview = async () => {
    if (!regenReviewState) return
    setApplyingRegen(true)
    try {
      const res = await fetch('/api/workflow/regen-image/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_id: input.id,
          approvals: {
            cover_image: regenFieldApprovals.cover_image !== false,
            photo_caption: true,
            photo_credit: true,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to apply')
      setRegenPhase('idle')
      setRegenSnapshotUrl(null)
      setRegenReviewState(null)
      setRegenFieldApprovals({})
      onUpdate?.()
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Failed to apply')
    } finally {
      setApplyingRegen(false)
    }
  }

  const handleRejectRegenReview = async () => {
    setApplyingRegen(true)
    try {
      const res = await fetch('/api/workflow/regen-image/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_id: input.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Failed to discard')
      }
      setRegenPhase('idle')
      setRegenSnapshotUrl(null)
      setRegenReviewState(null)
      setRegenFieldApprovals({})
      onUpdate?.()
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Failed to discard')
    } finally {
      setApplyingRegen(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isImage) {
        // Image inputs: persist title, photo_caption, photo_credit (no content)
        const { error } = await supabase
          .from('diffuse_project_inputs')
          .update({
            file_name: title?.trim() || null,
            metadata: {
              ...input.metadata,
              photo_caption: photoCaption?.trim() || undefined,
              photo_credit: photoCredit?.trim() || undefined,
            },
          })
          .eq('id', input.id)
        if (error) throw error
        onUpdate?.()
        onClose()
        return
      }
      if (isCoverPhoto && (photoCredit !== ((input.metadata?.photo_credit as string) ?? ''))) {
        const { error: metaError } = await supabase
          .from('diffuse_project_inputs')
          .update({
            metadata: { ...input.metadata, photo_credit: photoCredit?.trim() || undefined },
          })
          .eq('id', input.id)
        if (metaError) throw metaError
      }
      if (onSave) {
        const metadata = hasApprovedOrganizedPendingSave
          ? { ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}), organized_with_ai: true }
          : undefined
        await onSave(input.id, title, content, metadata)
        setHasApprovedOrganizedPendingSave(false)
        onUpdate?.()
        onClose()
      }
    } catch (error) {
      console.error('Error saving input:', error)
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    if (!confirm('Are you sure you want to delete this input?')) return
    setDeleting(true)
    try {
      await onDelete(input.id)
      onClose()
    } catch (error) {
      console.error('Error deleting input:', error)
    } finally {
      setDeleting(false)
    }
  }

  const getSaveButtonText = () => {
    return saving ? 'Saving...' : 'Save Changes'
  }

  const headerActions = (
    <>
      {isCoverPhoto && showRegenDiff && regenReviewState && regenFieldApprovals.cover_image === undefined && (
        <>
          <button
            type="button"
            onClick={() => void handleApplyRegenReview()}
            disabled={applyingRegen}
            className="p-2 rounded-full text-medium-gray hover:text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50"
            title="Apply new cover"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => handleDenyRegenField('cover_image')}
            disabled={applyingRegen}
            className="p-2 rounded-full text-medium-gray hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
            title="Keep previous image"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
      {isCoverPhoto && canEdit && (
        <button
          onClick={() => setShowRegenImageModal(true)}
          className="p-2 rounded-full text-medium-gray hover:text-lime-400 hover:bg-lime-400/10 transition-colors"
          title="Regenerate image"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      )}
      {/* Search button for text content */}
      {isTextContent && content && (
        <button
          onClick={() => {
            setShowContentSearch(true)
            setTimeout(() => contentSearchInputRef.current?.focus(), 50)
          }}
          className="p-2 rounded-full text-medium-gray hover:text-secondary-white hover:bg-white/10 transition-colors"
          title="Search content (⌘F)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      )}
      {isWebScrape && canEdit && (
        hasBeenOrganized || organizedContent != null || hasApprovedOrganizedPendingSave ? (
          <span className="inline-flex items-center gap-2 text-body-sm text-medium-gray cursor-default" title="Organized">
            <span>Organized</span>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
        ) : (
          <button
            type="button"
            onClick={handleOrganize}
            disabled={organizing || !content?.trim()}
            className="inline-flex items-center gap-2 px-2 py-2 text-body-sm text-medium-gray hover:text-cosmic-orange transition-colors disabled:opacity-50 focus:outline-none focus:ring-0"
            title="Organize"
          >
            <span>Organize</span>
            {organizing ? (
              <svg className="w-5 h-5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </button>
        )
      )}
      {showDeleteButton && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-2 rounded-full text-medium-gray hover:text-red-400 transition-colors disabled:opacity-50 focus:outline-none focus:ring-0"
          title="Delete"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </>
  )

  return (
    <>
    {showRegenImageModal && (
      <RegenerateImageModal
        onClose={() => setShowRegenImageModal(false)}
        canRefineCurrent={canRefineCoverInput}
        inputId={input.id}
        onSubmit={handleRegenImageSubmit}
        onComplete={() => onUpdate?.()}
      />
    )}
    <ModalShell onClose={onClose} maxWidth="max-w-4xl" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className={typeInfo.color}>{typeInfo.icon}</span>}
        title="Input Details"
        actions={headerActions}
        onClose={onClose}
      />
      <ModalMetadataRow>
        <span className={`uppercase font-medium tracking-wider ${typeInfo.color}`}>
          {typeInfo.label}
        </span>
        {isFromRecording && input.metadata?.recording_duration && (
          <>
            <span>•</span>
            <span>{formatDuration(input.metadata.recording_duration)}</span>
          </>
        )}
        {isFromUpload && input.file_size && (
          <>
            <span>•</span>
            <span>{(input.file_size / 1024).toFixed(0)} KB</span>
          </>
        )}
        <span>•</span>
        <span>{formatDateTime(input.created_at)}</span>
        {showRegenDiff && regenReviewState && (
          <>
            <span>•</span>
            <button
              type="button"
              onClick={() => void handleApplyRegenReview()}
              disabled={applyingRegen}
              className="text-cosmic-orange hover:text-secondary-white underline disabled:opacity-50"
            >
              {applyingRegen ? 'Applying…' : 'Apply cover'}
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => void handleRejectRegenReview()}
              disabled={applyingRegen}
              className="text-medium-gray hover:text-secondary-white underline disabled:opacity-50"
            >
              Discard review
            </button>
          </>
        )}
      </ModalMetadataRow>
      <ModalBody>
        <ModalScrollRegion>
          <div className="flex flex-col gap-6">
          {/* Title Field (not for image inputs; they use the layout below) */}
          {!isImage && (
            <div className="shrink-0">
              <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">TITLE</label>
              <input
                type="text"
                value={title}
                onChange={(e) => canEdit && setTitle(e.target.value)}
                placeholder={isFromRecording ? 'Recording' : isCoverPhoto ? 'Cover Photo' : isDocument ? 'Document' : isAudio ? 'Audio' : input.type === 'web_scrape' ? 'Web Page' : 'Text Input'}
                readOnly={!canEdit || (isImage && !isCoverPhoto)}
                className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                  canEdit && !isImage
                    ? 'focus:outline-none focus:border-cosmic-orange'
                    : 'cursor-default opacity-75'
                }`}
              />
            </div>
          )}

          {/* Image input: image left (title + download + copy), title/caption/credit right; same style as output popup */}
          {isImage && imageInputDisplayUrl && (
            <div className="flex flex-col md:flex-row md:gap-5 md:items-stretch shrink-0">
              <div className="flex flex-col flex-shrink-0 md:h-full w-full md:w-80 md:max-w-[340px] mb-4 md:mb-0 min-h-0">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch(imageInputDisplayUrl, { credentials: 'include' })
                          if (!res.ok) throw new Error('Download failed')
                          const blob = await res.blob()
                          const ext = (res.headers.get('content-type') || '').includes('webp') ? 'webp' : (res.headers.get('content-type') || '').includes('jpeg') || (res.headers.get('content-type') || '').includes('jpg') ? 'jpg' : 'png'
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `${(input.file_name || 'image').replace(/\s+/g, '-')}.${ext}`
                          a.click()
                          URL.revokeObjectURL(url)
                        } catch (e) {
                          console.error('Image download failed:', e)
                          alert('Failed to download image')
                        }
                      }}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                      title="Download image"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(imageInputDisplayUrl, 'photo')}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                      title="Copy image URL"
                    >
                      {copied === 'photo' ? (
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="min-h-[140px] flex-1 border border-white/10 rounded-glass overflow-hidden bg-white/5 relative">
                  <Image
                    src={imageInputDisplayUrl}
                    alt={input.file_name || 'Image'}
                    fill
                    sizes="(max-width: 768px) 100vw, 220px"
                    className="object-contain object-center"
                    unoptimized={imageInputDisplayUrl.startsWith('/api/')}
                  />
                </div>
              </div>
              {/* Title, Photo caption, Photo credit: label + copy above each field */}
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">TITLE</label>
                    <button
                      type="button"
                      onClick={() => handleCopy(title, 'title')}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                      title="Copy title"
                    >
                      {copied === 'title' ? (
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => canEdit && setTitle(e.target.value)}
                    placeholder="Image"
                    readOnly={!canEdit}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit ? 'focus:outline-none focus:border-cosmic-orange' : 'cursor-default opacity-75'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">PHOTO CAPTION</label>
                    <button
                      type="button"
                      onClick={() => handleCopy(photoCaption, 'photo_caption')}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                      title="Copy caption"
                    >
                      {copied === 'photo_caption' ? (
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={photoCaption}
                    onChange={(e) => canEdit && setPhotoCaption(e.target.value)}
                    placeholder="Optional caption"
                    readOnly={!canEdit}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit ? 'focus:outline-none focus:border-cosmic-orange' : 'cursor-default opacity-75'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">PHOTO CREDIT</label>
                    <button
                      type="button"
                      onClick={() => handleCopy(photoCredit, 'photo_credit')}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                      title="Copy credit"
                    >
                      {copied === 'photo_credit' ? (
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={photoCredit}
                    onChange={(e) => canEdit && setPhotoCredit(e.target.value)}
                    placeholder="e.g. Jane Smith"
                    readOnly={!canEdit}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit ? 'focus:outline-none focus:border-cosmic-orange' : 'cursor-default opacity-75'
                    }`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Cover Photo: preview, Replace in header, Photo credit (optional) */}
          {isCoverPhoto && (
            <div className="space-y-4 shrink-0">
              <input
                ref={coverUploadInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                className="hidden"
                onChange={handleReplaceCoverPhoto}
              />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-caption text-medium-gray uppercase tracking-wider">COVER PHOTO</label>
                </div>
                {(coverDisplayUrl ?? input.metadata?.storage_url) ? (
                  <div className="bg-white/5 border border-white/10 rounded-glass p-4 relative w-full h-[300px]">
                    <CoverRegenerationLayer
                      phase={regenPhase}
                      snapshotUrl={regenSnapshotUrl ?? displayCoverForRegen}
                      sharpUrl={regenSharpUrl}
                      alt={input.file_name || 'Cover photo'}
                      sizes="(max-width: 768px) 100vw, 600px"
                      className="relative w-full h-full min-h-[240px]"
                      imageClassName="object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-body-sm text-medium-gray italic">
                      No image yet. Upload a JPG or PNG below, or use Regenerate image in the header to create one with Diffuse.
                    </p>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => coverUploadInputRef.current?.click()}
                        disabled={uploadingCoverFile}
                        className="btn-secondary text-body-sm py-2 px-4 disabled:opacity-50"
                      >
                        {uploadingCoverFile ? 'Uploading…' : 'Upload image'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {showRegenDiff && regenReviewState && hasRegenCaptionChange && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-caption text-medium-gray uppercase tracking-wider">IMAGE CAPTION (OPTIONAL)</label>
                  </div>
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff
                      oldStr={regenReviewState.previousCaption ?? ''}
                      newStr={regenReviewState.proposedCaption ?? ''}
                    />
                  </div>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-caption text-medium-gray uppercase tracking-wider">PHOTO CREDIT (OPTIONAL)</label>
                </div>
                {showRegenDiff && regenReviewState && hasRegenCreditChange ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff
                      oldStr={regenReviewState.previousCredit ?? ''}
                      newStr={regenReviewState.proposedCredit ?? ''}
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={showRegenDiff ? getRegenCreditDisplay() : photoCredit}
                    onChange={(e) => canEdit && setPhotoCredit(e.target.value)}
                    placeholder="e.g. Jane Smith / Spring-Ford Press"
                    readOnly={!canEdit || showRegenDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit && !showRegenDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
                <p className="text-body-sm text-medium-gray mt-1 italic">Used when publishing to integrations. Leave blank if no credit.</p>
              </div>
            </div>
          )}

          {/* Web scrape: show source URL as link */}
          {input.type === 'web_scrape' && input.metadata?.url && (
            <div className="shrink-0">
              <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">SOURCE</label>
              <a
                href={input.metadata.url as string}
                target="_blank"
                rel="noopener noreferrer"
                className="text-body-sm text-sky-400 hover:text-sky-300 hover:underline break-all uppercase tracking-wider"
              >
                {(input.metadata.url as string).toUpperCase()}
              </a>
            </div>
          )}

          {/* Content Field (not shown for images or cover photo): transcription for recording, etc. */}
          {!isImage && !isCoverPhoto && (
            <div ref={isWebScrape ? scrapedContentRef : undefined}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-caption text-medium-gray uppercase tracking-wider">
                  {isFromRecording ? 'TRANSCRIPTION' : isAudio ? 'TRANSCRIPTION' : isDocument ? 'EXTRACTED TEXT' : input.type === 'web_scrape' ? 'SCRAPED CONTENT' : 'CONTENT'}
                </label>
                <div className="flex items-center gap-1">
                  {isWebScrape && organizedContent != null && (
                    <>
                      <button
                        type="button"
                        onClick={handleAcceptOrganized}
                        className="p-1.5 rounded text-medium-gray hover:text-green-400 hover:bg-green-400/10 transition-colors"
                        title="Approve changes (save with Save Changes or when closing)"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={handleDeclineOrganized}
                        className="p-1.5 rounded text-medium-gray hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Keep original content"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Content Search Bar */}
              {showContentSearch && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-glass focus-within:border-cosmic-orange/50 transition-colors">
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      ref={contentSearchInputRef}
                      type="text"
                      value={contentSearchQuery}
                      onChange={(e) => setContentSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (contentSearchMatchCount > 0) {
                            setContentSearchCurrentMatch((prev) => (prev + 1) % contentSearchMatchCount)
                          }
                        }
                        if (e.key === 'Escape') {
                          setShowContentSearch(false)
                          setContentSearchQuery('')
                        }
                      }}
                      placeholder="Search..."
                      className="flex-1 bg-transparent text-secondary-white text-body-sm focus:outline-none placeholder:text-medium-gray/50 min-w-0"
                    />
                    {contentSearchQuery && (
                      <span className="text-caption text-medium-gray flex-shrink-0 whitespace-nowrap">
                        {contentSearchMatchCount === 0
                          ? 'No matches'
                          : `${contentSearchCurrentMatch + 1} / ${contentSearchMatchCount}`}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (contentSearchMatchCount > 0) {
                        setContentSearchCurrentMatch((prev) => (prev - 1 + contentSearchMatchCount) % contentSearchMatchCount)
                      }
                    }}
                    disabled={contentSearchMatchCount === 0}
                    className="p-2 text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-40"
                    title="Previous match"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      if (contentSearchMatchCount > 0) {
                        setContentSearchCurrentMatch((prev) => (prev + 1) % contentSearchMatchCount)
                      }
                    }}
                    disabled={contentSearchMatchCount === 0}
                    className="p-2 text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-40"
                    title="Next match"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setShowContentSearch(false)
                      setContentSearchQuery('')
                    }}
                    className="p-2 text-medium-gray hover:text-secondary-white transition-colors"
                    title="Close search"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {isWebScrape && organizedContent != null ? (
                <textarea
                  value={organizedContent}
                  readOnly
                  rows={10}
                  className="w-full min-h-[180px] max-h-[40vh] px-4 py-3 bg-white/5 border border-cosmic-orange/30 rounded-glass text-secondary-white text-body-sm resize-none overflow-y-auto custom-scrollbar cursor-default"
                  aria-label="Organized content (accept or decline)"
                />
              ) : showContentSearch && contentSearchQuery.trim() ? (
                <div className="w-full min-h-[180px] max-h-[40vh] px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm overflow-y-auto custom-scrollbar whitespace-pre-wrap leading-relaxed">
                  {renderContentWithHighlights(content, contentSearchQuery, contentSearchCurrentMatch)}
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => canEdit && setContent(e.target.value)}
                  placeholder="Enter content..."
                  readOnly={!canEdit}
                  rows={10}
                  className={`w-full min-h-[180px] max-h-[40vh] px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none overflow-y-auto custom-scrollbar ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              )}
            </div>
          )}
          </div>
        </ModalScrollRegion>
      </ModalBody>
      <ModalFooter>
        <button onClick={onClose} className={`btn-secondary py-3 ${showSaveButton ? 'flex-1' : 'w-full'}`} disabled={saving}>
          Close
        </button>
        {showSaveButton && (
          <button onClick={handleSave} className="btn-primary flex-1 py-3 disabled:opacity-50" disabled={saving}>
            {getSaveButtonText()}
          </button>
        )}
      </ModalFooter>
    </ModalShell>
    </>
  )
}
