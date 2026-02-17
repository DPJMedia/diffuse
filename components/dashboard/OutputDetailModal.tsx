'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils/format'
import type { DiffuseProjectOutput } from '@/types/database'
import { ModalShell, ModalHeader, ModalMetadataRow, ModalBody, ModalScrollRegion, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'
import ReEditCommentsModal from './ReEditCommentsModal'
import HighlightedDiff from './HighlightedDiff'

interface OutputDetailModalProps {
  output: DiffuseProjectOutput
  onClose: () => void
  onUpdate?: () => void
  onDelete?: (id: string) => Promise<void>
  /** Called when re-edit completes with the updated output; use to refresh the modal's output. */
  onReeditComplete?: (updatedOutput: DiffuseProjectOutput) => void
  canEdit?: boolean
  canDelete?: boolean
  /** When output has no cover_photo_path, use project cover photo input so it still displays */
  fallbackCoverPhotoPath?: string | null
  /** Project type for accent color: teal = article, amber = advertisement (matches card previews) */
  projectType?: 'article' | 'advertisement'
}

interface StructuredArticle {
  title: string
  author: string
  subtitle?: string | null
  excerpt: string
  content: string
  /** Short description of cover image, tied to article (for integration Image caption) */
  photo_caption?: string | null
  /** Credit for cover photo; only include when provided (for integration Photo credit) */
  photo_credit?: string | null
  suggested_sections?: string[]
  category?: string
  tags?: string[]
  meta_title?: string
  meta_description?: string
}

// Helper to extract field from JSON-like string using regex
const extractField = (content: string, field: string): string | null => {
  const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]*(?:\\\\"[^"]*)*)"`, 's')
  const match = content.match(regex)
  if (match) {
    return match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }
  return null
}

// Helper to extract array field
const extractArrayField = (content: string, field: string): string[] => {
  const regex = new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`, 's')
  const match = content.match(regex)
  if (match) {
    const arrayContent = match[1]
    const items = arrayContent.match(/"([^"]*)"/g)
    if (items) {
      return items.map(item => item.replace(/"/g, ''))
    }
  }
  return []
}

// Parse output content to StructuredArticle (used for display and diff)
function parseContentToArticle(content: string): StructuredArticle | null {
  try {
    let parsed: Record<string, unknown> | null = null
    let jsonString = (content || '').trim()
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
        try {
          jsonString = JSON.parse(jsonString)
          parsed = JSON.parse(jsonString)
        } catch {
          /* fall through */
        }
      }
    }
    const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\\n/g, '\n') : '')
    if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]?.article && typeof parsed[1].article === 'object') {
      const a = parsed[1].article as Record<string, unknown>
      return {
        title: (a.title as string) || '',
        author: (a.author as string) || 'Diffuse.AI',
        subtitle: (a.subtitle as string)?.replace(/\\n/g, '\n') ?? null,
        excerpt: str(a.excerpt) || '',
        content: str(a.content) || '',
        photo_caption: (a.photo_caption as string)?.replace(/\\n/g, '\n') ?? null,
        photo_credit: (a.photo_credit as string)?.replace(/\\n/g, '\n') ?? null,
        suggested_sections: a.suggested_sections as string[] | undefined,
        category: a.category as string | undefined,
        tags: a.tags as string[] | undefined,
        meta_title: a.meta_title as string | undefined,
        meta_description: a.meta_description as string | undefined,
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed.title || parsed.content)) {
      return {
        title: (parsed.title as string) || '',
        author: (parsed.author as string) || 'Diffuse.AI',
        subtitle: ((parsed.subtitle as string)?.replace(/\\n/g, '\n')) || null,
        excerpt: ((parsed.excerpt as string)?.replace(/\\n/g, '\n')) || '',
        content: ((parsed.content as string)?.replace(/\\n/g, '\n')) || '',
        photo_caption: ((parsed.photo_caption as string)?.replace(/\\n/g, '\n')) || null,
        photo_credit: ((parsed.photo_credit as string)?.replace(/\\n/g, '\n')) || null,
        suggested_sections: parsed.suggested_sections as string[] | undefined,
        category: parsed.category as string | undefined,
        tags: parsed.tags as string[] | undefined,
        meta_title: parsed.meta_title as string | undefined,
        meta_description: parsed.meta_description as string | undefined,
      }
    }
    const title = extractField(content, 'title')
    const articleContent = extractField(content, 'content')
    if (title || articleContent) {
      return {
        title: title || '',
        author: extractField(content, 'author') || 'Diffuse.AI',
        subtitle: extractField(content, 'subtitle') || null,
        excerpt: extractField(content, 'excerpt') || '',
        content: articleContent || '',
        photo_caption: extractField(content, 'photo_caption') || null,
        photo_credit: extractField(content, 'photo_credit') || null,
        suggested_sections: extractArrayField(content, 'suggested_sections'),
        category: extractField(content, 'category') || undefined,
        tags: extractArrayField(content, 'tags'),
        meta_title: extractField(content, 'meta_title') || undefined,
        meta_description: extractField(content, 'meta_description') || undefined,
      }
    }
    return null
  } catch {
    return null
  }
}

export default function OutputDetailModal({ 
  output, 
  onClose, 
  onUpdate,
  onDelete,
  onReeditComplete,
  canEdit = true,
  canDelete = true,
  fallbackCoverPhotoPath = null,
  projectType
}: OutputDetailModalProps) {
  // Accent color for output type (matches card previews: teal = article, amber = advertisement)
  const outputAccentColor = projectType === 'advertisement' ? 'text-amber-400' : 'text-teal-400'
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
  /** Optimistic reedit count so the label updates immediately after apply */
  const [optimisticReeditCount, setOptimisticReeditCount] = useState<number | null>(null)
  const [reeditState, setReeditState] = useState<{
    proposedArticle: StructuredArticle
    previousArticle: StructuredArticle
    previousContent: string
  } | null>(null)
  const [fieldApprovals, setFieldApprovals] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState(false)
  const coverPhotoInputRef = useRef<HTMLInputElement>(null)

  // Build merged content JSON from previous structure + merged article
  const buildMergedContent = (merged: StructuredArticle): string => {
    try {
      const prevParsed = JSON.parse(reeditState!.previousContent)
      if (Array.isArray(prevParsed) && prevParsed.length >= 2) {
        return JSON.stringify([prevParsed[0], { article: merged }])
      }
      return JSON.stringify(merged)
    } catch {
      return JSON.stringify(merged)
    }
  }

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

  // Display value: when in reedit mode use proposed (synced with previous for resolved fields)
  const getDisplayVal = (field: (typeof DIFF_FIELDS)[number]) =>
    reeditState && article ? getFieldVal(reeditState.proposedArticle, field) : getFieldVal(article, field)

  const showDiff = !!reeditState && !!article
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
  // When the output came with a workflow image (URL or path), never show the project cover — only workflow image or stored path.
  const effectiveCoverPath = output.cover_photo_path ?? (generatedImageUrl ? null : fallbackCoverPhotoPath ?? null)
  // Prefer stored path; for external URLs use proxy so browser never hits Azure (avoids ERR_NAME_NOT_RESOLVED)
  const coverPhotoUrl = (uploadedCoverPath ? `/api/project-file?path=${encodeURIComponent(uploadedCoverPath)}` : null)
    ?? (effectiveCoverPath ? `/api/project-file?path=${encodeURIComponent(effectiveCoverPath)}` : null)
    ?? (generatedImageUrl ? `/api/proxy-image?url=${encodeURIComponent(generatedImageUrl)}` : null)

  useEffect(() => {
    setUploadedCoverPath(null)
  }, [output.id, effectiveCoverPath])

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
    const parsedArticle = parseContentToArticle(output.content)
    setArticle(parsedArticle)
    setRawContent(output.content)
  }, [output.content])

  const handleSave = async () => {
    setSaving(true)
    try {
      let contentToSave: string
      if (reeditState) {
        // Saving after reedit: use proposed content, with any denied fields reverted to previous
        const merged = { ...reeditState.proposedArticle }
        for (const field of DIFF_FIELDS) {
          if (fieldApprovals[field] === false) {
            (merged as Record<string, unknown>)[field] = reeditState.previousArticle[field]
          }
        }
        try {
          const prevParsed = JSON.parse(reeditState.previousContent)
          if (Array.isArray(prevParsed) && prevParsed.length >= 2) {
            const first = prevParsed[0]
            contentToSave = JSON.stringify([first, { article: merged }])
          } else {
            contentToSave = JSON.stringify(merged)
          }
        } catch {
          contentToSave = JSON.stringify(merged)
        }
      } else {
        contentToSave = article ? JSON.stringify(article) : rawContent
      }

      const newReeditCount = reeditState ? (output.reedit_count ?? 0) + 1 : (output.reedit_count ?? 0)

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
        const newArticle = parseContentToArticle(contentToSave)
        if (newArticle) setArticle(newArticle)
        setRawContent(contentToSave)
        setOptimisticReeditCount(newReeditCount)
      }
      if (onUpdate) onUpdate()
      onReeditComplete?.(updatedOutput ? { ...updatedOutput, reedit_count: newReeditCount } : output)
      onClose()
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
      onClose()
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

  const handleReeditSubmit = async (comments: string) => {
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
    const proposedArticle = parseContentToArticle(proposed_content)
    const previousArticle = parseContentToArticle(previous_content)
    if (!proposedArticle || !previousArticle) {
      throw new Error('Could not parse workflow response')
    }
    setReeditState({ proposedArticle, previousArticle, previousContent: previous_content })
    setFieldApprovals({})
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
      let contentToSave: string
      try {
        const prevParsed = JSON.parse(reeditState.previousContent)
        if (Array.isArray(prevParsed) && prevParsed.length >= 2) {
          const first = prevParsed[0]
          contentToSave = JSON.stringify([first, { article: merged }])
        } else {
          contentToSave = JSON.stringify(merged)
        }
      } catch {
        contentToSave = JSON.stringify(merged)
      }
      const res = await fetch('/api/workflow/reedit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: output.id, content: contentToSave }),
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
  const statusLabel = output.workflow_status === 'completed'
    ? `COMPLETED (${reeditCount} EDIT${reeditCount !== 1 ? 'S' : ''})`
    : output.workflow_status.toUpperCase()

  const headerActions = (
    <>
      <button
        type="button"
        onClick={() => setShowReEditModal(true)}
        className="inline-flex items-center gap-2 px-2 py-2 rounded-full text-medium-gray hover:text-cosmic-orange transition-colors focus:outline-none focus:ring-0"
        title="Edit with Diffuse"
      >
        <span className="text-body-sm hidden sm:inline">Edit with Diffuse</span>
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleCopyAll}
        className="inline-flex items-center justify-center p-2 rounded-full text-medium-gray hover:text-cosmic-orange transition-colors focus:outline-none focus:ring-0"
        title="Copy all fields"
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
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </>
  )

  return (
    <>
    <ModalShell onClose={onClose} maxWidth="max-w-4xl" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className={outputAccentColor}>{MODAL_ICONS.output.icon}</span>}
        title="Output Details"
        actions={headerActions}
        onClose={onClose}
      />
      <ModalMetadataRow>
        <span className={`uppercase font-medium tracking-wider ${statusColors[output.workflow_status]}`}>
          {statusLabel}
        </span>
        <span>•</span>
        <span>{formatDateTime(output.created_at)}</span>
        {isEditing && (
          <>
            <span>•</span>
            <span className="text-cosmic-orange">Unsaved changes</span>
          </>
        )}
        {showDiff && (
          <>
            <span>•</span>
            <button
              type="button"
              onClick={() => { setReeditState(null); setFieldApprovals({}) }}
              className="text-medium-gray hover:text-secondary-white underline"
            >
              Dismiss change highlights
            </button>
          </>
        )}
      </ModalMetadataRow>
      <ModalBody>
        <ModalScrollRegion>
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
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => coverPhotoInputRef.current?.click()}
                      disabled={uploadingCover}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors disabled:opacity-50"
                      title="Replace cover image"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(coverPhotoUrl!, { credentials: 'include' })
                        if (!res.ok) throw new Error('Download failed')
                        const blob = await res.blob()
                        const ext = (res.headers.get('content-type') || '').includes('webp') ? 'webp' : (res.headers.get('content-type') || '').includes('jpeg') || (res.headers.get('content-type') || '').includes('jpg') ? 'jpg' : 'png'
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `cover-${output.id}.${ext}`
                        a.click()
                        URL.revokeObjectURL(url)
                      } catch (e) {
                        console.error('Cover download failed:', e)
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
                </div>
              </div>
              <div className="w-full rounded-glass overflow-hidden bg-white/5 relative h-[40vh] min-h-[200px]">
              <Image
                key={coverPhotoUrl}
                src={coverPhotoUrl}
                alt="Cover"
                fill
                sizes="(max-width: 768px) 100vw, 800px"
                className="object-contain"
                referrerPolicy={coverPhotoUrl.startsWith('/api/proxy-image') ? 'no-referrer' : undefined}
                unoptimized={coverPhotoUrl.startsWith('/api/')}
              />
              </div>
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

              {/* Cover image + Image caption + Photo credit: desktop = image left (same-style window), caption/credit right; mobile = image below subtitle, then caption/credit */}
              <div className="flex flex-col md:flex-row md:gap-5 md:items-stretch">
                {/* Photo window: same format as other fields (label + copy + bordered box); box aligns top with caption, bottom with credit */}
                <div className="flex flex-col mb-4 md:mb-0 md:flex-shrink-0 w-full md:w-52 md:max-w-[220px] min-h-0">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE</label>
                    {coverPhotoUrl ? (
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => coverPhotoInputRef.current?.click()}
                            disabled={uploadingCover}
                            className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors disabled:opacity-50"
                            title="Replace cover image"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch(coverPhotoUrl, { credentials: 'include' })
                              if (!res.ok) throw new Error('Download failed')
                              const blob = await res.blob()
                              const ext = (res.headers.get('content-type') || '').includes('webp') ? 'webp' : (res.headers.get('content-type') || '').includes('jpeg') || (res.headers.get('content-type') || '').includes('jpg') ? 'jpg' : 'png'
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `cover-${output.id}.${ext}`
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch (e) {
                              console.error('Cover download failed:', e)
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
                          onClick={() => handleCopy(coverPhotoUrl, 'photo')}
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
                    ) : null}
                  </div>
                  <div className="flex-1 min-h-[140px] md:min-h-0 border border-white/10 rounded-glass flex flex-col overflow-hidden bg-white/5">
                    {coverPhotoUrl ? (
                      <button
                        type="button"
                        onClick={() => setPhotoLightboxOpen(true)}
                        className="flex-1 min-h-0 w-full h-full relative flex items-center justify-center focus:outline-none focus:ring-0 overflow-hidden"
                      >
                        <Image
                          key={coverPhotoUrl}
                          src={coverPhotoUrl}
                          alt="Cover"
                          fill
                          sizes="(max-width: 768px) 100vw, 400px"
                          className="object-cover"
                          referrerPolicy={coverPhotoUrl.startsWith('/api/proxy-image') ? 'no-referrer' : undefined}
                          unoptimized={coverPhotoUrl.startsWith('/api/')}
                        />
                      </button>
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
                {/* Caption + Credit: right on desktop, below image on mobile */}
                <div className="flex-1 min-w-0 space-y-5">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE CAPTION (OPTIONAL)</label>
                      <button
                        onClick={() => handleCopy(article.photo_caption || '', 'photo_caption')}
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
                    <input
                      type="text"
                      value={article.photo_caption || ''}
                      onChange={(e) => handleFieldChange('photo_caption', e.target.value)}
                      placeholder="Short description of the cover image, tied to the article"
                      readOnly={!canEdit || showDiff}
                      className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                        canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                      }`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-caption text-medium-gray uppercase tracking-wider">IMAGE CREDIT (OPTIONAL)</label>
                      <button
                        onClick={() => handleCopy(article.photo_credit || '', 'photo_credit')}
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
                    <input
                      type="text"
                      value={article.photo_credit || ''}
                      onChange={(e) => handleFieldChange('photo_credit', e.target.value)}
                      placeholder="e.g. Jane Smith / Spring-Ford Press"
                      readOnly={!canEdit || showDiff}
                      className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                        canEdit && !showDiff ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                      }`}
                    />
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
        </ModalScrollRegion>
      </ModalBody>
      <ModalFooter>
        <button onClick={onClose} className="btn-secondary flex-1 py-3" disabled={saving}>
          {isEditing ? 'Discard Changes' : 'Close'}
        </button>
        {canEdit && (
          <button onClick={handleSave} className="btn-primary flex-1 py-3 disabled:opacity-50" disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </ModalFooter>
    </ModalShell>

    {showReEditModal && (
      <ReEditCommentsModal
        onClose={() => setShowReEditModal(false)}
        onSubmit={handleReeditSubmit}
      />
    )}

    {/* Full-size photo lightbox */}
    {photoLightboxOpen && coverPhotoUrl && (
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
              src={coverPhotoUrl}
              alt="Cover full size"
              fill
              sizes="100vw"
              className="object-contain"
              referrerPolicy={coverPhotoUrl.startsWith('/api/proxy-image') ? 'no-referrer' : undefined}
              unoptimized={coverPhotoUrl.startsWith('/api/')}
            />
          </div>
        </div>
    )}
    </>
  )
}
