'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, sanitizeStorageFilename } from '@/lib/utils/format'
import type { DiffuseProjectOutput } from '@/types/database'
import { ModalShell, ModalHeader, ModalMetadataRow, ModalBody, ModalScrollRegion, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'
import ReEditCommentsModal from './ReEditCommentsModal'
import RegenerateImageModal from './RegenerateImageModal'
import CoverRegenerationLayer, { type CoverRegenPhase } from './CoverRegenerationLayer'
import HighlightedDiff from './HighlightedDiff'
import {
  mergeStructuredArticleIntoContent,
  parseOutputContentToStructuredArticle,
  type StructuredArticle,
} from '@/lib/output-content'

export interface OutputDetailViewProps {
  output: DiffuseProjectOutput
  onDismiss: () => void
  onUpdate?: () => void
  onDelete?: (id: string) => Promise<void>
  /** Called when re-edit completes with the updated output; use to refresh the modal's output. */
  onReeditComplete?: (updatedOutput: DiffuseProjectOutput) => void
  canEdit?: boolean
  canDelete?: boolean
  /** When output has no cover_photo_path, use project cover photo input so it still displays */
  fallbackCoverPhotoPath?: string | null
  /** Fallback for accent color when output has no output_type (teal = article, amber = advertisement). Prefer output.output_type when present. */
  projectType?: 'article' | 'advertisement'
  /** Modal overlay (default) vs full-page glass panel */
  layout?: 'modal' | 'page'
  /** Notifies parent (e.g. full-page header) when local edit state changes */
  onEditingChange?: (editing: boolean) => void
  /** When a cover regen is waiting for accept/reject — parent can match pending status styling */
  onRegenPendingChange?: (pending: boolean) => void
}

export default function OutputDetailView({ 
  output, 
  onDismiss, 
  onUpdate,
  onDelete,
  onReeditComplete,
  canEdit = true,
  canDelete = true,
  fallbackCoverPhotoPath = null,
  projectType,
  layout = 'modal',
  onEditingChange,
  onRegenPendingChange,
}: OutputDetailViewProps) {
  // Use output's own type (article vs ad) for label/icon; fall back to project type for older data
  const displayAsAd = output.output_type === 'ad' || projectType === 'advertisement'
  const outputAccentColor = displayAsAd ? 'text-amber-400' : 'text-teal-400'
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [article, setArticle] = useState<StructuredArticle | null>(null)
  const [rawContent, setRawContent] = useState(output.content)
  const [isEditing, setIsEditing] = useState(false)
  const [uploadedCoverPath, setUploadedCoverPath] = useState<string | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [photoLightboxOpen, setPhotoLightboxOpen] = useState(false)
  const [showReEditModal, setShowReEditModal] = useState(false)
  const [showRegenImageModal, setShowRegenImageModal] = useState(false)
  const [regenPhase, setRegenPhase] = useState<CoverRegenPhase>('idle')
  /** URL frozen when user (or DB) starts cover regeneration — blur layer source */
  const [regenSnapshotUrl, setRegenSnapshotUrl] = useState<string | null>(null)
  const [sharpCacheKey, setSharpCacheKey] = useState(0)
  /** Optimistic reedit count so the label updates immediately after apply */
  const [optimisticReeditCount, setOptimisticReeditCount] = useState<number | null>(null)
  const [reeditState, setReeditState] = useState<{
    proposedArticle: StructuredArticle
    previousArticle: StructuredArticle
    previousContent: string
  } | null>(null)
  const [fieldApprovals, setFieldApprovals] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState(false)
  /** Pending regen review (check/X per field, then apply — mirrors Edit with Diffuse). */
  const [regenReviewState, setRegenReviewState] = useState<{
    proposedCaption: string | null
    proposedCredit: string | null
    previousCaption: string | null
    previousCredit: string | null
    pendingImagePath: string
    imagePrompt: string | null
    previousCoverPath: string | null
  } | null>(null)
  const [regenFieldApprovals, setRegenFieldApprovals] = useState<Partial<Record<'cover_image', boolean>>>({})
  const [applyingRegen, setApplyingRegen] = useState(false)
  /** Re-edit workflow POST in flight (modal closes first; overlay covers content like image regen). */
  const [reeditProcessing, setReeditProcessing] = useState(false)
  /** Page layout: right sidebar Settings section (same pattern as recordings detail) */
  const [sidebarSettingsOpen, setSidebarSettingsOpen] = useState(false)
  const coverPhotoInputRef = useRef<HTMLInputElement>(null)
  /** Desktop: image frame height = top(caption input/diff) → bottom(credit input/diff); labels excluded; remeasure on resize / structural changes only. */
  const coverCaptionFieldRef = useRef<HTMLDivElement>(null)
  const coverCreditFieldRef = useRef<HTMLDivElement>(null)
  const [coverImageFrameHeightPx, setCoverImageFrameHeightPx] = useState<number | null>(null)

  useEffect(() => {
    onEditingChange?.(isEditing)
  }, [isEditing, onEditingChange])

  useEffect(() => {
    onRegenPendingChange?.(!!regenReviewState)
  }, [regenReviewState, onRegenPendingChange])

  useEffect(() => {
    setIsEditing(false)
  }, [output.id])

  const DIFF_FIELDS = ['title', 'author', 'subtitle', 'excerpt', 'content', 'category', 'suggested_sections', 'tags', 'meta_title', 'meta_description'] as const

  const getFieldVal = (a: StructuredArticle | null, field: (typeof DIFF_FIELDS)[number]): string => {
    if (!a) return ''
    const v = a[field]
    if (Array.isArray(v)) return v.join(', ')
    return String(v ?? '')
  }

  const hasFieldChanged = (prev: StructuredArticle, next: StructuredArticle, field: (typeof DIFF_FIELDS)[number]): boolean => {
    return getFieldVal(prev, field) !== getFieldVal(next, field)
  }

  /** Re-edit workflow: one edit per diff field that changed and was not denied. */
  const countAcceptedReeditFields = (
    previous: StructuredArticle,
    proposed: StructuredArticle,
    approvals: Record<string, boolean>
  ): number => {
    let n = 0
    for (const field of DIFF_FIELDS) {
      if (!hasFieldChanged(previous, proposed, field)) continue
      if (approvals[field] === false) continue
      n++
    }
    return n
  }

  /** Manual save: one edit per structured field that differs from last saved `output.content`. */
  const countManualFieldChanges = (baseline: StructuredArticle, current: StructuredArticle): number => {
    let n = 0
    for (const field of DIFF_FIELDS) {
      if (hasFieldChanged(baseline, current, field)) n++
    }
    for (const field of ['photo_caption', 'photo_credit'] as const) {
      const b = baseline[field] ?? ''
      const c = current[field] ?? ''
      if (String(b) !== String(c)) n++
    }
    return n
  }

  // Display value: when in reedit mode use proposed (synced with previous for resolved fields)
  const getDisplayVal = (field: (typeof DIFF_FIELDS)[number]) =>
    reeditState && article ? getFieldVal(reeditState.proposedArticle, field) : getFieldVal(article, field)

  const showDiff = !!reeditState && !!article
  /** Regen review uses regenReviewState; do not require article so caption/credit UI still shows if parse lags. */
  const showRegenDiff = !!regenReviewState

  useEffect(() => {
    if (layout === 'page' && showDiff) setSidebarSettingsOpen(true)
  }, [layout, showDiff])

  useEffect(() => {
    if (layout === 'page' && showRegenDiff) setSidebarSettingsOpen(true)
  }, [layout, showRegenDiff])

  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const showDeleteButton = canDelete && onDelete

  // Normalize external image URL so it always has https (use <img>, not next/image; avoids next/image 500 / ERR_NAME_NOT_RESOLVED)
  const normalizeImageUrl = (url: string | undefined): string | undefined => {
    if (!url || typeof url !== 'string') return undefined
    const t = url.trim()
    if (t.startsWith('https://')) return t
    if (t.startsWith('http://')) return t
    if (t.startsWith('//')) return `https:${t}`
    if (t.includes('.') && (t.includes('blob.') || t.includes('amazonaws.') || t.startsWith('www.') || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t))) return `https://${t}`
    return undefined
  }
  // Cover photo: user-uploaded > workflow-generated image URL (DB or parsed from content) > output/project file path
  const generatedImageUrlFromDb = normalizeImageUrl(output.workflow_metadata?.generated_image_url as string | undefined)
  const generatedImageUrlFromContent = (() => {
    try {
      let raw = typeof output.content === 'string' ? output.content.trim() : ''
      if (!raw) return undefined
      let parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      let url: string | undefined
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>
            const u = o.generated_image_url ?? o.url ?? o.image_url ?? o.image
            if (typeof u === 'string' && u.trim()) {
              url = u.trim()
              break
            }
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>
        const u = p.generated_image_url ?? p.url ?? p.image_url ?? p.image
        if (typeof u === 'string' && u.trim()) url = u.trim()
      }
      return normalizeImageUrl(url)
    } catch {
      /* ignore */
    }
    return undefined
  })()
  const generatedImageUrl = generatedImageUrlFromDb ?? generatedImageUrlFromContent
  // When the output came with a workflow image (URL or path), never show the project cover; only workflow image or stored path.
  const effectiveCoverPath = output.cover_photo_path ?? (generatedImageUrl ? null : fallbackCoverPhotoPath ?? null)
  // Prefer stored path; for external URLs use proxy so browser never hits Azure (avoids ERR_NAME_NOT_RESOLVED)
  const coverPhotoUrl = (uploadedCoverPath ? `/api/project-file?path=${encodeURIComponent(uploadedCoverPath)}` : null)
    ?? (effectiveCoverPath ? `/api/project-file?path=${encodeURIComponent(effectiveCoverPath)}` : null)
    ?? (generatedImageUrl ? `/api/proxy-image?url=${encodeURIComponent(generatedImageUrl)}` : null)

  const regenPendingPath =
    (output.workflow_metadata?.regen_image as { pending?: { cover_photo_path?: string } } | undefined)?.pending
      ?.cover_photo_path ?? null
  const pendingCoverUrl = regenPendingPath
    ? `/api/project-file?path=${encodeURIComponent(regenPendingPath)}`
    : null

  /** Refine mode requires a stored project-files path on this output (not external URL-only covers). */
  const canRefineOutputCover = !!(output.cover_photo_path || uploadedCoverPath)

  useEffect(() => {
    setUploadedCoverPath(null)
  }, [output.id, effectiveCoverPath])

  useEffect(() => {
    setRegenPhase('idle')
    setRegenSnapshotUrl(null)
    setSharpCacheKey(0)
    setRegenReviewState(null)
    setRegenFieldApprovals({})
  }, [output.id])

  /** When regen completes (sync API + DB): transition to review (check). From `processing`, blur fades to the new image. */
  useEffect(() => {
    const st = (output.workflow_metadata?.regen_image as { status?: string; pending?: unknown } | undefined)?.status
    const pending = (output.workflow_metadata?.regen_image as { pending?: unknown } | undefined)?.pending
    if (st !== 'complete' || !pending) return
    if (regenPhase === 'check') return
    if (regenPhase !== 'idle' && regenPhase !== 'processing') return

    const snap = coverPhotoUrl ?? pendingCoverUrl
    if (!snap) return
    setRegenSnapshotUrl((s) => s ?? snap)
    setSharpCacheKey(Date.now())
    setRegenPhase('check')
  }, [
    output.workflow_metadata,
    output.id,
    coverPhotoUrl,
    pendingCoverUrl,
    regenPhase,
  ])

  useEffect(() => {
    const ri = output.workflow_metadata?.regen_image as {
      status?: string
      pending?: {
        cover_photo_path: string
        photo_caption: string | null
        photo_credit: string | null
        image_prompt: string | null
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
        previousCaption: article?.photo_caption ?? null,
        previousCredit: article?.photo_credit ?? null,
        pendingImagePath: ri.pending!.cover_photo_path,
        imagePrompt: ri.pending!.image_prompt,
        previousCoverPath: output.cover_photo_path ?? null,
      }
    })
  }, [
    output.workflow_metadata?.regen_image,
    output.cover_photo_path,
    article?.photo_caption,
    article?.photo_credit,
    output.id,
  ])

  const handleUploadCoverPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !canEdit) return
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg']
    if (!validTypes.includes(file.type)) {
      alert('Please select a JPG or PNG image.')
      e.target.value = ''
      return
    }
    const maxSize = 20 * 1024 * 1024 // 20MB
    if (file.size > maxSize) {
      alert('Image is too large. Maximum size is 20MB.')
      e.target.value = ''
      return
    }
    setUploadingCover(true)
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser) throw new Error('Not authenticated')
      const ext = file.name.split('.').pop() || 'jpg'
      const filePath = `${currentUser.id}/${output.project_id}/cover-${output.id}-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(filePath, file, {
          contentType: (file.type && /^image\/(jpeg|png|jpg)$/i.test(file.type)) ? file.type : 'image/jpeg',
          upsert: true,
        })
      if (uploadError) throw uploadError
      const { error: updateError } = await supabase
        .from('diffuse_project_outputs')
        .update({ cover_photo_path: filePath })
        .eq('id', output.id)
      if (updateError) {
        console.error('Output cover_photo_path update failed:', updateError)
        throw new Error(updateError.message || 'Failed to save cover photo to output. Make sure the database has the cover_photo_path column (run the migration).')
      }
      setUploadedCoverPath(filePath)
      onUpdate?.()
    } catch (err) {
      console.error('Cover photo upload failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to upload cover photo')
    } finally {
      setUploadingCover(false)
      e.target.value = ''
    }
  }

  // Clear reedit state and optimistic count when switching to a different output
  const reeditOutputIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (reeditState && reeditOutputIdRef.current && output.id !== reeditOutputIdRef.current) {
      setReeditState(null)
      setFieldApprovals({})
      setOptimisticReeditCount(null)
    }
    if (reeditState) reeditOutputIdRef.current = output.id
  }, [output.id, reeditState])

  // Use server reedit_count when it catches up (e.g. after fetchProjectData)
  useEffect(() => {
    const serverCount = output.reedit_count ?? 0
    if (optimisticReeditCount != null && serverCount >= optimisticReeditCount) {
      setOptimisticReeditCount(null)
    }
  }, [output.reedit_count, optimisticReeditCount])

  // Parse structured content when output changes
  useEffect(() => {
    const parsedArticle = parseOutputContentToStructuredArticle(output.content)
    setArticle(parsedArticle)
    setRawContent(output.content)
  }, [output.content])

  /** Commit pending cover regen (also invoked at start of Save when review is open). */
  const applyPendingRegenReview = async (): Promise<DiffuseProjectOutput | false | null> => {
    if (!regenReviewState) return null
    setApplyingRegen(true)
    try {
      const res = await fetch('/api/workflow/regen-image/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          output_id: output.id,
          approvals: {
            cover_image: regenFieldApprovals.cover_image !== false,
            photo_caption: true,
            photo_credit: true,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to apply')
      }
      const nextOut = (data as { output?: DiffuseProjectOutput }).output
      if (!nextOut) {
        alert('Failed to apply cover')
        return false
      }
      onReeditComplete?.(nextOut)
      setRegenPhase('idle')
      setRegenSnapshotUrl(null)
      setRegenReviewState(null)
      setRegenFieldApprovals({})
      onUpdate?.()
      return nextOut
    } catch (err) {
      console.error('Apply regen failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to apply')
      return false
    } finally {
      setApplyingRegen(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      let effectiveOutput = output
      if (regenReviewState) {
        const applied = await applyPendingRegenReview()
        if (applied === false) return
        if (applied) effectiveOutput = applied
      }

      let contentToSave: string
      let editIncrement = 0
      if (reeditState) {
        // Saving after reedit: use proposed content, with any denied fields reverted to previous
        const merged = { ...reeditState.proposedArticle }
        for (const field of DIFF_FIELDS) {
          if (fieldApprovals[field] === false) {
            (merged as Record<string, unknown>)[field] = reeditState.previousArticle[field]
          }
        }
        contentToSave = mergeStructuredArticleIntoContent(reeditState.previousContent, merged)
        editIncrement = countAcceptedReeditFields(
          reeditState.previousArticle,
          reeditState.proposedArticle,
          fieldApprovals
        )
      } else {
        contentToSave = article ? mergeStructuredArticleIntoContent(rawContent, article) : rawContent
        const baseline = parseOutputContentToStructuredArticle(effectiveOutput.content)
        editIncrement =
          article && baseline ? countManualFieldChanges(baseline, article) : 0
      }

      const newReeditCount = (effectiveOutput.reedit_count ?? 0) + editIncrement

      const { data: updatedOutput, error: updateError } = await supabase
        .from('diffuse_project_outputs')
        .update({
          content: contentToSave,
          updated_at: new Date().toISOString(),
          reedit_count: newReeditCount,
        })
        .eq('id', output.id)
        .select()
        .single()

      if (updateError) throw updateError

      setIsEditing(false)
      if (reeditState) {
        setReeditState(null)
        setFieldApprovals({})
      }
      setOptimisticReeditCount(newReeditCount)
      const newArticle = parseOutputContentToStructuredArticle(contentToSave)
      if (newArticle) setArticle(newArticle)
      setRawContent(contentToSave)

      if (onUpdate) onUpdate()
      onReeditComplete?.(
        updatedOutput ? { ...updatedOutput, reedit_count: newReeditCount } : effectiveOutput
      )
    } catch (error) {
      console.error('Error saving output:', error)
      alert('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    if (!confirm('Are you sure you want to delete this output?')) return
    setDeleting(true)
    try {
      await onDelete(output.id)
      onDismiss()
    } catch (error) {
      console.error('Error deleting output:', error)
    } finally {
      setDeleting(false)
    }
  }

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(field)
      setTimeout(() => setCopied(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const handleDownloadCoverImage = async () => {
    if (!coverPhotoUrl) return
    try {
      const res = await fetch(coverPhotoUrl, { credentials: 'include' })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const ct = res.headers.get('content-type') || ''
      const ext = ct.includes('webp') ? 'webp' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : 'png'
      const rawCaption = regenReviewState
        ? (regenReviewState.proposedCaption ?? article?.photo_caption ?? '').trim()
        : (article?.photo_caption ?? '').trim()
      const baseName = rawCaption
        ? sanitizeStorageFilename(rawCaption.slice(0, 200))
        : `cover-${output.id}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Cover download failed:', e)
      alert('Failed to download image')
    }
  }

  const handleRegenImageSubmit = async ({ mode, comments }: { mode: 'scratch' | 'update'; comments: string }) => {
    if (!coverPhotoUrl) {
      throw new Error('Add or generate a cover image first.')
    }
    setRegenSnapshotUrl(coverPhotoUrl)
    setRegenPhase('processing')
    try {
      const res = await fetch('/api/workflow/regen-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: output.id, mode, comments }),
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

  const handleReeditSubmit = async (comments: string) => {
    setReeditProcessing(true)
    try {
      const res = await fetch('/api/workflow/reedit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: output.id, comments }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || data?.message || 'Re-edit failed')
      }
      const { proposed_content, previous_content } = await res.json()
      const proposedArticle = parseOutputContentToStructuredArticle(proposed_content)
      const previousArticle = parseOutputContentToStructuredArticle(previous_content)
      if (!proposedArticle || !previousArticle) {
        throw new Error('Could not parse workflow response')
      }
      setReeditState({ proposedArticle, previousArticle, previousContent: previous_content })
      setFieldApprovals({})
    } finally {
      setReeditProcessing(false)
    }
  }

  const handleApplyReedit = async () => {
    if (!reeditState) return
    setApplying(true)
    try {
      // Anything denied stays denied; anything approved or not yet chosen defaults to approved (use proposed)
      const merged = { ...reeditState.proposedArticle }
      for (const field of DIFF_FIELDS) {
        if (fieldApprovals[field] === false) {
          (merged as Record<string, unknown>)[field] = reeditState.previousArticle[field]
        }
        // fieldApprovals[field] === true or undefined → use proposed (already in merged)
      }
      const contentToSave = mergeStructuredArticleIntoContent(reeditState.previousContent, merged)
      const acceptedCount = countAcceptedReeditFields(
        reeditState.previousArticle,
        reeditState.proposedArticle,
        fieldApprovals
      )
      const res = await fetch('/api/workflow/reedit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          output_id: output.id,
          content: contentToSave,
          accepted_edit_count: acceptedCount,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || data?.message || 'Failed to apply')
      }
      const { output: updatedOutput } = await res.json()
      const newCount = updatedOutput?.reedit_count ?? (output.reedit_count ?? 0) + 1
      setOptimisticReeditCount(newCount)
      setReeditState(null)
      setFieldApprovals({})
      onUpdate?.()
      onReeditComplete?.({ ...updatedOutput, reedit_count: newCount })
    } catch (err) {
      console.error('Apply reedit failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to apply changes')
    } finally {
      setApplying(false)
    }
  }

  const handleApproveField = (field: (typeof DIFF_FIELDS)[number]) => {
    if (!reeditState) return
    setFieldApprovals(prev => ({ ...prev, [field]: true }))
    // Update display immediately: sync previous to proposed so this field shows the new version
    setReeditState(prev => prev ? { ...prev, previousArticle: { ...prev.previousArticle, [field]: prev.proposedArticle[field] } } : null)
  }

  const handleDenyField = (field: (typeof DIFF_FIELDS)[number]) => {
    if (!reeditState) return
    setFieldApprovals(prev => ({ ...prev, [field]: false }))
    // Update display immediately: sync proposed to previous so this field shows the old version
    setReeditState(prev => prev ? { ...prev, proposedArticle: { ...prev.proposedArticle, [field]: prev.previousArticle[field] } } : null)
  }

  const hasRegenCaptionChange =
    !!regenReviewState &&
    (regenReviewState.previousCaption ?? '') !== (regenReviewState.proposedCaption ?? '')
  const hasRegenCreditChange =
    !!regenReviewState &&
    (regenReviewState.previousCredit ?? '') !== (regenReviewState.proposedCredit ?? '')

  /** Boolean so deps stay stable while `article` object identity changes on every field edit. */
  const structuredArticleReady = article != null

  useLayoutEffect(() => {
    if (!structuredArticleReady) {
      setCoverImageFrameHeightPx(null)
      return
    }

    const measure = () => {
      if (typeof window === 'undefined') return
      if (window.innerWidth < 768) {
        setCoverImageFrameHeightPx(null)
        return
      }
      const topEl = coverCaptionFieldRef.current
      const bottomEl = coverCreditFieldRef.current
      if (!topEl || !bottomEl) return
      const top = topEl.getBoundingClientRect().top
      const bottom = bottomEl.getBoundingClientRect().bottom
      setCoverImageFrameHeightPx(Math.max(140, Math.round(bottom - top)))
    }

    const schedule = () => {
      requestAnimationFrame(() => requestAnimationFrame(measure))
    }
    schedule()

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [
    output.id,
    output.content,
    structuredArticleReady,
    showRegenDiff,
    hasRegenCaptionChange,
    hasRegenCreditChange,
    regenPhase,
    layout,
  ])

  const getRegenCaptionDisplay = () => {
    if (!regenReviewState) return article?.photo_caption ?? ''
    return regenReviewState.proposedCaption ?? ''
  }

  const getRegenCreditDisplay = () => {
    if (!regenReviewState) return article?.photo_credit ?? ''
    return regenReviewState.proposedCredit ?? ''
  }

  const handleDenyRegenField = (field: 'cover_image') => {
    if (!regenReviewState) return
    setRegenFieldApprovals((prev) => ({ ...prev, [field]: false }))
  }

  const handleRejectRegenReview = async () => {
    setApplyingRegen(true)
    try {
      const res = await fetch('/api/workflow/regen-image/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: output.id }),
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
      console.error('Reject regen failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to discard')
    } finally {
      setApplyingRegen(false)
    }
  }

  const handleCopyAll = async () => {
    if (article) {
      const sections = [
        article.title && `${article.title}`,
        article.subtitle && `${article.subtitle}`,
        article.photo_caption && `Image caption: ${article.photo_caption}`,
        article.photo_credit && `Image credit: ${article.photo_credit}`,
        article.author && `By ${article.author}`,
        article.excerpt && `${article.excerpt}`,
        article.content && `${article.content}`,
        article.category && `Category: ${article.category}`,
        article.suggested_sections?.length && `Sections: ${article.suggested_sections.join(', ')}`,
        article.tags?.length && `Tags: ${article.tags.join(', ')}`,
        article.meta_title && `Meta Title: ${article.meta_title}`,
        article.meta_description && `Meta Description: ${article.meta_description}`,
      ].filter(Boolean)

      const allContent = sections.join('\n\n')
      handleCopy(allContent, 'all')
      return
    }
    
    handleCopy(rawContent, 'all')
  }

  const handleFieldChange = (field: keyof StructuredArticle, value: string | string[]) => {
    if (article) {
      setArticle(prev => prev ? { ...prev, [field]: value } : null)
      if (!isEditing) setIsEditing(true)
    }
  }

  const statusColors: Record<string, string> = {
    pending: 'text-pale-blue',
    processing: 'text-cosmic-orange',
    completed: outputAccentColor,
    failed: 'text-red-400',
  }
  const reeditCount = optimisticReeditCount ?? output.reedit_count ?? 0
  const ws = output.workflow_status
  const workflowAwaitingRemote =
    ws === 'pending' || ws === 'processing'
  const statusLabel =
    ws === 'completed'
      ? `COMPLETED (${reeditCount} EDIT${reeditCount !== 1 ? 'S' : ''})`
      : (ws && String(ws).toUpperCase()) || 'UNKNOWN'
  /** While editing or cover regen is unaccepted, show the same pending copy as the page header. */
  const hasPendingStatusSurface = isEditing || showRegenDiff
  const displayStatusLabel = hasPendingStatusSurface ? 'UNSAVED CHANGES (PENDING EDITS)' : statusLabel
  const displayStatusClassName = hasPendingStatusSurface
    ? 'uppercase font-medium tracking-wider text-cosmic-orange'
    : `uppercase font-medium tracking-wider ${statusColors[ws] ?? 'text-medium-gray'}`

  /** Full-area blur + spinner: async workflow still running, re-edit request, or apply only (image regen uses cover layer + Regenerate row). */
  const contentWorkflowOverlay = workflowAwaitingRemote || reeditProcessing || applying

  const workflowOverlayNode = contentWorkflowOverlay ? (
    <div
      className="absolute inset-0 z-[25] flex items-center justify-center rounded-glass bg-black/35 backdrop-blur-md"
      aria-busy="true"
      aria-label="Loading"
    >
      <svg
        className="h-10 w-10 text-cosmic-orange animate-spin"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  ) : null

  const actionSpinnerIcon = (className = 'w-3.5 h-3.5') => (
    <svg
      className={`${className} text-cosmic-orange flex-shrink-0 animate-spin`}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )

  const headerActions = (
    <>
      <button
        type="button"
        onClick={() => setShowReEditModal(true)}
        disabled={!canEdit || reeditProcessing}
        className="inline-flex items-center gap-2 px-2 py-2 rounded-full text-medium-gray hover:text-cosmic-orange transition-colors focus:outline-none focus:ring-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-medium-gray"
        title="Edit Content"
      >
        <span className="text-body-sm hidden sm:inline">Edit Content</span>
        {reeditProcessing ? (
          actionSpinnerIcon('w-5 h-5')
        ) : (
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={handleCopyAll}
        className="inline-flex items-center justify-center p-2 rounded-full text-medium-gray hover:text-cosmic-orange transition-colors focus:outline-none focus:ring-0"
        title="Copy All Fields"
      >
        {copied === 'all' ? (
          <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      {showDeleteButton && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center justify-center p-2 rounded-full text-medium-gray hover:text-red-400 transition-colors disabled:opacity-50 focus:outline-none focus:ring-0"
          title="Delete"
        >
          {deleting ? (
            actionSpinnerIcon('w-5 h-5')
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      )}
    </>
  )

  const sharpRevealBase =
    regenPhase === 'check' && sharpCacheKey
      ? (pendingCoverUrl ?? coverPhotoUrl)
      : null
  const sharpRevealUrl =
    sharpRevealBase
      ? `${sharpRevealBase}${sharpRevealBase.includes('?') ? '&' : '?'}cb=${sharpCacheKey}`
      : null
  const regenSharpUrl =
    regenFieldApprovals.cover_image === false ? null : sharpRevealUrl

  /** Full-size preview: pending regen image when reviewing, otherwise current cover */
  const lightboxImageUrl =
    showRegenDiff && pendingCoverUrl ? pendingCoverUrl : coverPhotoUrl

  const scrollableFields = (
    <>
          {/* Hidden file input for Replace (header) and Upload (below) - always in DOM when canEdit */}
          {canEdit && (
            <input
              ref={coverPhotoInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              className="hidden"
              onChange={handleUploadCoverPhoto}
            />
          )}
          {/* Cover Photo - at top only when raw view (no article). In article view, cover moves next to caption/credit (desktop) or below subtitle (mobile). */}
          {!article && coverPhotoUrl ? (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE</label>
                <div className="flex items-center gap-1">
                  {showRegenDiff && regenReviewState && regenFieldApprovals.cover_image === undefined && (
                    <>
                      <button
                        type="button"
                        onClick={() => void applyPendingRegenReview()}
                        disabled={applyingRegen}
                        className="p-1.5 rounded transition-colors text-medium-gray hover:text-green-400 hover:bg-green-400/10 disabled:opacity-50"
                        title="Accept new cover, caption, and credit"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDenyRegenField('cover_image')}
                        disabled={applyingRegen}
                        className="p-1.5 rounded transition-colors text-medium-gray hover:text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                        title="Keep previous image"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopy(coverPhotoUrl, 'photo')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                    title="Copy Image URL"
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
              <button
                type="button"
                onClick={() => lightboxImageUrl && setPhotoLightboxOpen(true)}
                className="relative w-full block p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-0"
                aria-label="View cover full size"
              >
                <CoverRegenerationLayer
                  phase={regenPhase}
                  snapshotUrl={regenSnapshotUrl ?? coverPhotoUrl}
                  sharpUrl={regenSharpUrl}
                  alt="Cover"
                  sizes="(max-width: 768px) 100vw, 800px"
                  className="relative w-full h-[40vh] min-h-[200px]"
                />
              </button>
            </div>
          ) : !article && canEdit ? (
            <div className="w-full rounded-glass border border-dashed border-white/20 bg-white/5 p-6 mb-5">
              <button
                type="button"
                onClick={() => coverPhotoInputRef.current?.click()}
                disabled={uploadingCover}
                className="w-full flex flex-col items-center justify-center gap-2 py-4 text-medium-gray hover:text-secondary-white hover:bg-white/5 rounded-glass transition-colors disabled:opacity-50"
              >
                {uploadingCover ? (
                  <>
                    <svg className="w-8 h-8 animate-spin text-cosmic-orange" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-caption uppercase tracking-wider">Uploading...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-8 h-8 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-body-sm font-medium">Upload cover photo</span>
                    <span className="text-caption text-medium-gray uppercase tracking-wider">JPG, PNG</span>
                  </>
                )}
              </button>
            </div>
          ) : null}
          {article ? (
            /* Structured Article View */
            <div className="space-y-5">
              {/* Title */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">TITLE</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'title') && (
                      <>
                        <button
                          onClick={() => handleApproveField('title')}
                          className={`p-1.5 rounded transition-colors ${fieldApprovals['title'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`}
                          title="Approve changes"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button
                          onClick={() => handleDenyField('title')}
                          className={`p-1.5 rounded transition-colors ${fieldApprovals['title'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`}
                          title="Reject changes"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleCopy((reeditState?.proposedArticle ?? article).title || '', 'title')}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                    >
                      {copied === 'title' ? (
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      )}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'title') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'title')} newStr={getFieldVal(reeditState.proposedArticle, 'title')} />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={getDisplayVal('title')}
                    onChange={(e) => handleFieldChange('title', e.target.value)}
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* Author */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">AUTHOR</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'author') && (
                      <>
                        <button onClick={() => handleApproveField('author')}  className={`p-1.5 rounded transition-colors ${fieldApprovals['author'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => handleDenyField('author')}  className={`p-1.5 rounded transition-colors ${fieldApprovals['author'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </>
                    )}
                    <button onClick={() => handleCopy((reeditState?.proposedArticle ?? article).author || '', 'author')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors">
                      {copied === 'author' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'author') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'author')} newStr={getFieldVal(reeditState.proposedArticle, 'author')} />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={getDisplayVal('author')}
                    onChange={(e) => handleFieldChange('author', e.target.value)}
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* Subtitle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">SUBTITLE</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'subtitle') && (
                      <>
                        <button onClick={() => handleApproveField('subtitle')}  className={`p-1.5 rounded ${fieldApprovals['subtitle'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => handleDenyField('subtitle')}  className={`p-1.5 rounded ${fieldApprovals['subtitle'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </>
                    )}
                    <button onClick={() => handleCopy((reeditState?.proposedArticle ?? article).subtitle || '', 'subtitle')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                      {copied === 'subtitle' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'subtitle') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'subtitle')} newStr={getFieldVal(reeditState.proposedArticle, 'subtitle')} />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={getDisplayVal('subtitle')}
                    onChange={(e) => handleFieldChange('subtitle', e.target.value)}
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* Cover image + caption/credit: desktop image height = measured caption→credit stack (resize / structural updates only; typing does not grow the image frame) */}
              <div className="flex flex-col md:flex-row md:items-start md:gap-5">
                <div className="mb-4 flex w-full min-w-0 flex-shrink-0 flex-col md:mb-0 md:w-52 md:max-w-[220px]">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE</label>
                    {coverPhotoUrl ? (
                      <div className="flex items-center gap-1">
                        {showRegenDiff && regenReviewState && regenFieldApprovals.cover_image === undefined && (
                          <>
                            <button
                              type="button"
                              onClick={() => void applyPendingRegenReview()}
                              disabled={applyingRegen}
                              className="p-1.5 rounded transition-colors text-medium-gray hover:text-green-400 hover:bg-green-400/10 disabled:opacity-50"
                              title="Accept new cover, caption, and credit"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDenyRegenField('cover_image')}
                              disabled={applyingRegen}
                              className="p-1.5 rounded transition-colors text-medium-gray hover:text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                              title="Keep previous image"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopy(coverPhotoUrl, 'photo')}
                          className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                          title="Copy Image URL"
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
                    ) : null}
                  </div>
                  <div
                    className={`flex w-full flex-shrink-0 flex-col overflow-hidden border border-white/10 rounded-glass bg-white/5 md:min-h-0 ${
                      coverImageFrameHeightPx == null ? 'min-h-[140px] aspect-[4/5] max-md:max-h-[min(70vh,520px)]' : ''
                    }`}
                    style={coverImageFrameHeightPx != null ? { height: coverImageFrameHeightPx } : undefined}
                  >
                    {coverPhotoUrl ? (
                      regenPhase === 'idle' ? (
                        <button
                          type="button"
                          onClick={() => setPhotoLightboxOpen(true)}
                          className="relative flex h-full min-h-[140px] w-full flex-1 flex-col overflow-hidden cursor-pointer focus:outline-none focus:ring-0"
                        >
                          <CoverRegenerationLayer
                            phase="idle"
                            snapshotUrl={coverPhotoUrl}
                            sharpUrl={null}
                            alt="Cover"
                            sizes="(max-width: 768px) 100vw, 400px"
                            className="absolute inset-0 h-full w-full min-h-[140px]"
                            imageClassName="object-cover object-center"
                          />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => lightboxImageUrl && setPhotoLightboxOpen(true)}
                          className="relative flex h-full min-h-[140px] w-full flex-1 flex-col self-stretch p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-0"
                          aria-label="View cover full size"
                        >
                          <CoverRegenerationLayer
                            phase={regenPhase}
                            snapshotUrl={regenSnapshotUrl ?? coverPhotoUrl}
                            sharpUrl={regenSharpUrl}
                            alt="Cover"
                            sizes="(max-width: 768px) 100vw, 400px"
                            className="h-full min-h-[140px] w-full flex-1"
                            imageClassName="object-cover object-center"
                          />
                        </button>
                      )
                    ) : canEdit ? (
                      <button
                        type="button"
                        onClick={() => coverPhotoInputRef.current?.click()}
                        disabled={uploadingCover}
                        className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-1.5 text-medium-gray hover:text-secondary-white hover:bg-white/5 rounded transition-colors disabled:opacity-50"
                      >
                        {uploadingCover ? (
                          <svg className="w-6 h-6 animate-spin text-cosmic-orange" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="w-6 h-6 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                        <span className="text-caption uppercase tracking-wider">{uploadingCover ? 'Uploading...' : 'Upload cover'}</span>
                      </button>
                    ) : (
                      <div className="flex-1 min-h-0 flex items-center justify-center text-medium-gray text-body-sm">No photo</div>
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex flex-col gap-5">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE CAPTION (OPTIONAL)</label>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCopy((showRegenDiff ? getRegenCaptionDisplay() : article?.photo_caption) || '', 'photo_caption')}
                          className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
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
                    </div>
                    <div ref={coverCaptionFieldRef} className="w-full min-w-0">
                    {showRegenDiff && regenReviewState && hasRegenCaptionChange ? (
                      <div className="w-full min-w-0 h-11 overflow-x-auto overflow-y-hidden flex items-center px-4 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm custom-scrollbar">
                        <HighlightedDiff
                          nowrap
                          oldStr={regenReviewState.previousCaption ?? ''}
                          newStr={regenReviewState.proposedCaption ?? ''}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={showRegenDiff ? getRegenCaptionDisplay() : article?.photo_caption || ''}
                        onChange={(e) => handleFieldChange('photo_caption', e.target.value)}
                        placeholder="Short description of the cover image, tied to the article"
                        readOnly={!canEdit || showDiff || showRegenDiff}
                        className={`w-full min-w-0 px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                          canEdit && !showDiff && !showRegenDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                        }`}
                      />
                    )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE CREDIT (OPTIONAL)</label>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCopy((showRegenDiff ? getRegenCreditDisplay() : article?.photo_credit) || '', 'photo_credit')}
                          className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
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
                    </div>
                    <div ref={coverCreditFieldRef} className="w-full min-w-0">
                    {showRegenDiff && regenReviewState && hasRegenCreditChange ? (
                      <div className="w-full min-w-0 h-11 overflow-x-auto overflow-y-hidden flex items-center px-4 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm custom-scrollbar">
                        <HighlightedDiff
                          nowrap
                          oldStr={regenReviewState.previousCredit ?? ''}
                          newStr={regenReviewState.proposedCredit ?? ''}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={showRegenDiff ? getRegenCreditDisplay() : article?.photo_credit || ''}
                        onChange={(e) => handleFieldChange('photo_credit', e.target.value)}
                        placeholder="e.g. Jane Smith / Spring-Ford Press"
                        readOnly={!canEdit || showDiff || showRegenDiff}
                        className={`w-full min-w-0 px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                          canEdit && !showDiff && !showRegenDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                        }`}
                      />
                    )}
                    </div>
                  </div>
                  </div>
                </div>
              </div>

              {/* Excerpt */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">EXCERPT</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'excerpt') && (
                      <>
                        <button onClick={() => handleApproveField('excerpt')}  className={`p-1.5 rounded ${fieldApprovals['excerpt'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => handleDenyField('excerpt')}  className={`p-1.5 rounded ${fieldApprovals['excerpt'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </>
                    )}
                    <button onClick={() => handleCopy((reeditState?.proposedArticle ?? article).excerpt || '', 'excerpt')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                      {copied === 'excerpt' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'excerpt') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[80px]">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'excerpt')} newStr={getFieldVal(reeditState.proposedArticle, 'excerpt')} useWords />
                  </div>
                ) : (
                  <textarea
                    value={getDisplayVal('excerpt')}
                    onChange={(e) => handleFieldChange('excerpt', e.target.value)}
                    rows={3}
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* Content */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">ARTICLE CONTENT</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'content') && (
                      <>
                        <button onClick={() => handleApproveField('content')}  className={`p-1.5 rounded ${fieldApprovals['content'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => handleDenyField('content')}  className={`p-1.5 rounded ${fieldApprovals['content'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </>
                    )}
                    <button onClick={() => handleCopy((reeditState?.proposedArticle ?? article).content || '', 'content')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                      {copied === 'content' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'content') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[200px] max-h-[40vh] overflow-y-auto custom-scrollbar">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'content')} newStr={getFieldVal(reeditState.proposedArticle, 'content')} useWords block />
                  </div>
                ) : (
                  <textarea
                    value={getDisplayVal('content')}
                    onChange={(e) => handleFieldChange('content', e.target.value)}
                    rows={8}
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none max-h-[40vh] overflow-y-auto custom-scrollbar ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* Category */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">CATEGORY</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'category') && (
                      <>
                        <button onClick={() => handleApproveField('category')}  className={`p-1.5 rounded ${fieldApprovals['category'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => handleDenyField('category')}  className={`p-1.5 rounded ${fieldApprovals['category'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </>
                    )}
                    <button onClick={() => handleCopy(getFieldVal(reeditState?.proposedArticle ?? article, 'category'), 'category')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                      {copied === 'category' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'category') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'category')} newStr={getFieldVal(reeditState.proposedArticle, 'category')} />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={getDisplayVal('category')}
                    onChange={(e) => handleFieldChange('category', e.target.value)}
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* Suggested Sections */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">SUGGESTED SECTIONS</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'suggested_sections') && (
                      <>
                        <button onClick={() => handleApproveField('suggested_sections')}  className={`p-1.5 rounded ${fieldApprovals['suggested_sections'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => handleDenyField('suggested_sections')}  className={`p-1.5 rounded ${fieldApprovals['suggested_sections'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </>
                    )}
                    <button onClick={() => handleCopy(getFieldVal(reeditState?.proposedArticle ?? article, 'suggested_sections'), 'sections')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                      {copied === 'sections' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'suggested_sections') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'suggested_sections')} newStr={getFieldVal(reeditState.proposedArticle, 'suggested_sections')} />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={getDisplayVal('suggested_sections')}
                    onChange={(e) => handleFieldChange('suggested_sections', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                    placeholder="Enter comma-separated sections"
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">TAGS</label>
                  <div className="flex items-center gap-1">
                    {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'tags') && (
                      <>
                        <button onClick={() => handleApproveField('tags')}  className={`p-1.5 rounded ${fieldApprovals['tags'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => handleDenyField('tags')}  className={`p-1.5 rounded ${fieldApprovals['tags'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </>
                    )}
                    <button onClick={() => handleCopy(getFieldVal(reeditState?.proposedArticle ?? article, 'tags'), 'tags')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                      {copied === 'tags' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    </button>
                  </div>
                </div>
                {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'tags') ? (
                  <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                    <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'tags')} newStr={getFieldVal(reeditState.proposedArticle, 'tags')} />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={getDisplayVal('tags')}
                    onChange={(e) => handleFieldChange('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                    placeholder="Enter comma-separated tags"
                    readOnly={!canEdit || showDiff}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                      canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                )}
              </div>

              {/* SEO Section */}
              <div className="pt-4 border-t border-white/10 space-y-5">
                <h3 className="text-body-sm text-secondary-white font-medium uppercase tracking-wider">SEO Settings</h3>
                
                {/* Meta Title */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">
                      META TITLE <span className="text-medium-gray/60">({getFieldVal(reeditState?.proposedArticle ?? article, 'meta_title').length}/60)</span>
                    </label>
                    <div className="flex items-center gap-1">
                      {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'meta_title') && (
                        <>
                          <button onClick={() => handleApproveField('meta_title')}  className={`p-1.5 rounded ${fieldApprovals['meta_title'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                          <button onClick={() => handleDenyField('meta_title')}  className={`p-1.5 rounded ${fieldApprovals['meta_title'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </>
                      )}
                      <button onClick={() => handleCopy(getFieldVal(reeditState?.proposedArticle ?? article, 'meta_title'), 'meta_title')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                        {copied === 'meta_title' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                      </button>
                    </div>
                  </div>
                  {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'meta_title') ? (
                    <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[44px]">
                      <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'meta_title')} newStr={getFieldVal(reeditState.proposedArticle, 'meta_title')} />
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={getDisplayVal('meta_title')}
                      onChange={(e) => handleFieldChange('meta_title', e.target.value)}
                      readOnly={!canEdit || showDiff}
                      className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                        canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                      }`}
                    />
                  )}
                </div>
                
                {/* Meta Description */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">
                      META DESCRIPTION <span className="text-medium-gray/60">({getDisplayVal('meta_description').length}/160)</span>
                    </label>
                    <div className="flex items-center gap-1">
                      {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'meta_description') && (
                        <>
                          <button onClick={() => handleApproveField('meta_description')}  className={`p-1.5 rounded ${fieldApprovals['meta_description'] === true ? 'text-green-400 bg-green-400/10' : 'text-medium-gray hover:text-green-400 hover:bg-green-400/10'} disabled:opacity-50`} title="Approve"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                          <button onClick={() => handleDenyField('meta_description')}  className={`p-1.5 rounded ${fieldApprovals['meta_description'] === false ? 'text-red-400 bg-red-400/10' : 'text-medium-gray hover:text-red-400 hover:bg-red-400/10'} disabled:opacity-50`} title="Reject"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </>
                      )}
                      <button onClick={() => handleCopy(getDisplayVal('meta_description'), 'meta_description')} className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded">
                        {copied === 'meta_description' ? <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                      </button>
                    </div>
                  </div>
                  {showDiff && reeditState && hasFieldChanged(reeditState.previousArticle, reeditState.proposedArticle, 'meta_description') ? (
                    <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm min-h-[60px]">
                      <HighlightedDiff oldStr={getFieldVal(reeditState.previousArticle, 'meta_description')} newStr={getFieldVal(reeditState.proposedArticle, 'meta_description')} useWords />
                    </div>
                  ) : (
                    <textarea
                      value={getDisplayVal('meta_description')}
                      onChange={(e) => handleFieldChange('meta_description', e.target.value)}
                      rows={2}
                      readOnly={!canEdit || showDiff}
                      className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none ${
                        canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                      }`}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Raw Content View (fallback) */
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-caption text-medium-gray uppercase tracking-wider">RAW CONTENT</label>
                <button
                  onClick={() => handleCopy(rawContent, 'raw')}
                  className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                >
                  {copied === 'raw' ? (
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
              <textarea
                value={rawContent}
                onChange={(e) => {
                  setRawContent(e.target.value)
                  if (!isEditing) setIsEditing(true)
                }}
                rows={12}
                readOnly={!canEdit || showDiff}
                className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none max-h-[50vh] overflow-y-auto custom-scrollbar ${
                  canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                }`}
              />
            </div>
          )}
    </>
  )

  const modalFooter = (
    <ModalFooter>
      <button onClick={onDismiss} className="btn-secondary flex-1 py-3">
        {isEditing ? 'Discard Changes' : 'Close'}
      </button>
      {canEdit && (
        <button
          onClick={handleSave}
          className="btn-primary flex-1 py-3 disabled:opacity-50 flex items-center justify-center gap-2"
          disabled={saving}
        >
          {saving ? actionSpinnerIcon('w-5 h-5') : null}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      )}
    </ModalFooter>
  )

  const detailColumn =
    layout === 'modal' ? (
      <>
        <ModalHeader
          icon={<span className={outputAccentColor}>{MODAL_ICONS.output.icon}</span>}
          title="Output Details"
          actions={headerActions}
          onClose={onDismiss}
        />
        <ModalMetadataRow>
          <span className={displayStatusClassName}>
            {displayStatusLabel}
          </span>
          <span>•</span>
          <span>{formatDateTime(output.created_at)}</span>
          {showDiff && (
            <>
              <span>•</span>
              <button
                type="button"
                onClick={() => { setReeditState(null); setFieldApprovals({}) }}
                className="text-medium-gray hover:text-secondary-white underline"
              >
                Dismiss Change Highlights
              </button>
            </>
          )}
          {showRegenDiff && (
            <>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  void handleRejectRegenReview()
                }}
                disabled={applyingRegen}
                className="text-medium-gray hover:text-secondary-white underline disabled:opacity-50"
              >
                Discard Review
              </button>
            </>
          )}
        </ModalMetadataRow>
        <ModalBody>
          <ModalScrollRegion>
            <div className="relative min-h-[min(40vh,480px)]">
              {scrollableFields}
              {workflowOverlayNode}
            </div>
          </ModalScrollRegion>
        </ModalBody>
        {modalFooter}
      </>
    ) : (
      <>
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0 flex flex-col h-[calc(100vh-200px)]">
            <div className="glass-container bg-dark-gray/95 backdrop-blur-glass p-5 flex-1 overflow-y-auto min-h-0 custom-scrollbar pr-3 -mr-1 relative">
              {scrollableFields}
              {workflowOverlayNode}
            </div>
          </div>
          <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 glass-container bg-dark-gray/95 backdrop-blur-glass overflow-hidden">
            {/* Actions — match recordings detail */}
            <div className="border-b border-white/10">
              <div className="px-4 py-3">
                <p className="text-body-sm text-secondary-white font-medium">Actions</p>
              </div>
              <div className="space-y-0.5 px-4 pb-3">
                <button
                  type="button"
                  onClick={() => setShowReEditModal(true)}
                  disabled={!canEdit || reeditProcessing}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {reeditProcessing ? (
                    actionSpinnerIcon()
                  ) : (
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  )}
                  <span className="text-body-sm text-secondary-white">Edit Content</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRegenImageModal(true)}
                  disabled={!canEdit || !coverPhotoUrl || regenPhase === 'processing'}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {regenPhase === 'processing' ? (
                    actionSpinnerIcon()
                  ) : (
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  <span className="text-body-sm text-secondary-white">Regenerate Image</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadCoverImage()}
                  disabled={!coverPhotoUrl}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="text-body-sm text-secondary-white">Download Image</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyAll}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  {copied === 'all' ? (
                    <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                  <span className="text-body-sm text-secondary-white">Copy All</span>
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    {saving ? (
                      actionSpinnerIcon()
                    ) : (
                      <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span className="text-body-sm text-secondary-white">{saving ? 'Saving…' : 'Save Changes'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Settings — collapsible (recordings detail pattern) */}
            <div>
              <button
                type="button"
                onClick={() => setSidebarSettingsOpen(!sidebarSettingsOpen)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <p className="text-body-sm text-secondary-white font-medium">Settings</p>
                <div className="w-6 flex items-center justify-center">
                  <svg className={`w-3.5 h-3.5 text-medium-gray transition-transform ${sidebarSettingsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {sidebarSettingsOpen && (showDiff || showDeleteButton) && (
                <div className="space-y-0.5 px-4 pb-3">
                  {showDiff && (
                    <button
                      type="button"
                      onClick={() => { setReeditState(null); setFieldApprovals({}) }}
                      className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-body-sm text-secondary-white">Dismiss Change Highlights</span>
                    </button>
                  )}
                  {showDeleteButton && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left disabled:opacity-50"
                    >
                      {deleting ? (
                        actionSpinnerIcon()
                      ) : (
                        <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                      <span className="text-body-sm text-red-400">Delete Output</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )

  return (
    <>
      {layout === 'modal' ? (
        <ModalShell onClose={onDismiss} maxWidth="max-w-4xl" maxHeight="max-h-[90vh]">
          {detailColumn}
        </ModalShell>
      ) : (
        <div className="w-full">{detailColumn}</div>
      )}

    {showReEditModal && (
      <ReEditCommentsModal
        onClose={() => setShowReEditModal(false)}
        onSubmit={handleReeditSubmit}
      />
    )}

    {showRegenImageModal && (
      <RegenerateImageModal
        onClose={() => setShowRegenImageModal(false)}
        canRefineCurrent={canRefineOutputCover}
        outputId={output.id}
        onSubmit={handleRegenImageSubmit}
        onComplete={() => onUpdate?.()}
      />
    )}

    {/* Full-size photo lightbox */}
    {photoLightboxOpen && lightboxImageUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPhotoLightboxOpen(false)}
          role="dialog"
          aria-label="Photo full size"
        >
          <button
            type="button"
            onClick={() => setPhotoLightboxOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors z-10"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="relative w-full max-w-6xl max-h-[90vh] h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <Image
              src={lightboxImageUrl}
              alt="Cover full size"
              fill
              sizes="100vw"
              className="object-contain"
              referrerPolicy={lightboxImageUrl.startsWith('/api/proxy-image') ? 'no-referrer' : undefined}
              unoptimized={lightboxImageUrl.startsWith('/api/')}
            />
          </div>
        </div>
    )}
    </>
  )
}
