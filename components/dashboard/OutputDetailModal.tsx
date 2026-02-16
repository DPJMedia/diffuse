'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils/format'
import type { DiffuseProjectOutput } from '@/types/database'

interface OutputDetailModalProps {
  output: DiffuseProjectOutput
  onClose: () => void
  onUpdate?: () => void
  onDelete?: (id: string) => Promise<void>
  canEdit?: boolean
  canDelete?: boolean
  /** When output has no cover_photo_path, use project cover photo input so it still displays */
  fallbackCoverPhotoPath?: string | null
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

// Calculate dynamic rows based on content for auto-expand
const calculateRows = (text: string, baseRows: number) => {
  if (!text) return baseRows
  const lineBreaks = (text.match(/\n/g) || []).length + 1
  const estimatedWrappedLines = Math.ceil(text.length / 80)
  return Math.max(baseRows, lineBreaks, estimatedWrappedLines)
}

export default function OutputDetailModal({ 
  output, 
  onClose, 
  onUpdate,
  onDelete,
  canEdit = true,
  canDelete = true,
  fallbackCoverPhotoPath = null
}: OutputDetailModalProps) {
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [article, setArticle] = useState<StructuredArticle | null>(null)
  const [rawContent, setRawContent] = useState(output.content)
  const [isEditing, setIsEditing] = useState(false)
  const [uploadedCoverPath, setUploadedCoverPath] = useState<string | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [photoLightboxOpen, setPhotoLightboxOpen] = useState(false)
  const coverPhotoInputRef = useRef<HTMLInputElement>(null)
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

  // Try to parse structured content - with fallback to regex extraction
  useEffect(() => {
    const parseContent = (content: string): StructuredArticle | null => {
      try {
        let parsed: Record<string, unknown> | null = null
        
        if (typeof content === 'string') {
          let jsonString = content.trim()
          
          try {
            parsed = JSON.parse(jsonString)
          } catch {
            if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
              try {
                jsonString = JSON.parse(jsonString)
                parsed = JSON.parse(jsonString)
              } catch {
                // Fall through to regex extraction
              }
            }
          }
        }
        
        // New workflow format: [ { revised_prompt, url }, { article, image_prompt } ]
        if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]?.article && typeof parsed[1].article === 'object') {
          const a = parsed[1].article as Record<string, unknown>
          const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\\n/g, '\n') : '')
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
        
        // Fallback: Try regex extraction
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
    
    const parsedArticle = parseContent(output.content)
    setArticle(parsedArticle)
    setRawContent(output.content)
  }, [output.content])

  const handleSave = async () => {
    setSaving(true)
    try {
      const contentToSave = article ? JSON.stringify(article) : rawContent
      
      const { error: updateError } = await supabase
        .from('diffuse_project_outputs')
        .update({
          content: contentToSave,
          updated_at: new Date().toISOString(),
        })
        .eq('id', output.id)

      if (updateError) throw updateError

      setIsEditing(false)
      if (onUpdate) onUpdate()
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
    completed: 'text-green-400',
    failed: 'text-red-400',
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center px-4">
      <div className="glass-container p-8 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-cosmic-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h2 className="text-heading-lg text-secondary-white">Output Details</h2>
            {canEdit && (
              <span className="text-caption text-cosmic-orange bg-cosmic-orange/10 px-2 py-1 rounded">
                Editable
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Copy All Button */}
            <button
              onClick={handleCopyAll}
              className="flex items-center gap-1.5 px-3 py-2 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded-glass transition-colors"
              title="Copy all fields"
            >
              {copied === 'all' ? (
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
              <span className="text-caption font-medium tracking-wider">
                {copied === 'all' ? 'COPIED' : 'COPY ALL'}
              </span>
            </button>
            {/* Replace cover photo (when cover present and editable) */}
            {coverPhotoUrl && canEdit && (
              <button
                onClick={() => coverPhotoInputRef.current?.click()}
                disabled={uploadingCover}
                className="p-2 rounded-full text-medium-gray hover:text-sky-400 hover:bg-sky-400/10 transition-colors disabled:opacity-50"
                title="Replace cover image"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
            {/* Delete Button */}
            {showDeleteButton && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-2 rounded-full text-medium-gray hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                title="Delete"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-full text-medium-gray hover:text-secondary-white hover:bg-white/10 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Metadata Row */}
        <div className="flex items-center gap-2 text-body-sm text-medium-gray mb-6 flex-shrink-0">
          <span className={`uppercase font-medium tracking-wider ${statusColors[output.workflow_status]}`}>
            {output.workflow_status.toUpperCase()}
          </span>
          <span>•</span>
          <span>{formatDateTime(output.created_at)}</span>
          {isEditing && (
            <>
              <span>•</span>
              <span className="text-cosmic-orange">Unsaved changes</span>
            </>
          )}
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 -mr-2">
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
            <div className="w-full rounded-glass overflow-hidden bg-white/5 mb-5 relative h-[40vh] min-h-[200px]">
              <img
                key={coverPhotoUrl}
                src={coverPhotoUrl}
                alt="Cover"
                className="absolute inset-0 w-full h-full object-contain"
                referrerPolicy={coverPhotoUrl.startsWith('/api/proxy-image') ? 'no-referrer' : undefined}
                loading="eager"
              />
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
                className="absolute bottom-3 right-3 p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                title="Download image"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
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
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Title</label>
                  <button
                    onClick={() => handleCopy(article.title || '', 'title')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
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
                  value={article.title}
                  onChange={(e) => handleFieldChange('title', e.target.value)}
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* Author */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Author</label>
                  <button
                    onClick={() => handleCopy(article.author || '', 'author')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                  >
                    {copied === 'author' ? (
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
                  value={article.author}
                  onChange={(e) => handleFieldChange('author', e.target.value)}
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* Subtitle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Subtitle</label>
                  <button
                    onClick={() => handleCopy(article.subtitle || '', 'subtitle')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                  >
                    {copied === 'subtitle' ? (
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
                  value={article.subtitle || ''}
                  onChange={(e) => handleFieldChange('subtitle', e.target.value)}
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* Cover image + Image caption + Photo credit: desktop = image left (same-style window), caption/credit right; mobile = image below subtitle, then caption/credit */}
              <div className="flex flex-col md:flex-row md:gap-5 md:items-stretch">
                {/* Photo window: same format as other fields (label + copy + bordered box); box aligns top with caption, bottom with credit */}
                <div className="flex flex-col mb-4 md:mb-0 md:flex-shrink-0 w-full md:w-52 md:max-w-[220px] min-h-0">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">Image</label>
                    {coverPhotoUrl ? (
                      <div className="flex items-center gap-1">
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
                        <img
                          key={coverPhotoUrl}
                          src={coverPhotoUrl}
                          alt="Cover"
                          className="absolute inset-0 w-full h-full object-cover"
                          referrerPolicy={coverPhotoUrl.startsWith('/api/proxy-image') ? 'no-referrer' : undefined}
                          loading="eager"
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
                      <label className="text-caption text-medium-gray uppercase tracking-wider">Image caption (optional)</label>
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
                      readOnly={!canEdit}
                      className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                        canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                      }`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-caption text-medium-gray uppercase tracking-wider">Image credit (optional)</label>
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
                      readOnly={!canEdit}
                      className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                        canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Excerpt */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Excerpt</label>
                  <button
                    onClick={() => handleCopy(article.excerpt || '', 'excerpt')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                  >
                    {copied === 'excerpt' ? (
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
                  value={article.excerpt}
                  onChange={(e) => handleFieldChange('excerpt', e.target.value)}
                  rows={3}
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* Content */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Article Content</label>
                  <button
                    onClick={() => handleCopy(article.content || '', 'content')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                  >
                    {copied === 'content' ? (
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
                  value={article.content}
                  onChange={(e) => handleFieldChange('content', e.target.value)}
                  rows={calculateRows(article.content, 8)}
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* Category */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Category</label>
                  <button
                    onClick={() => handleCopy(article.category || '', 'category')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                  >
                    {copied === 'category' ? (
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
                  value={article.category || ''}
                  onChange={(e) => handleFieldChange('category', e.target.value)}
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* Suggested Sections */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Suggested Sections</label>
                  <button
                    onClick={() => handleCopy(article.suggested_sections?.join(', ') || '', 'sections')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                  >
                    {copied === 'sections' ? (
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
                  value={article.suggested_sections?.join(', ') || ''}
                  onChange={(e) => handleFieldChange('suggested_sections', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                  placeholder="Enter comma-separated sections"
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Tags</label>
                  <button
                    onClick={() => handleCopy(article.tags?.join(', ') || '', 'tags')}
                    className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                  >
                    {copied === 'tags' ? (
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
                  value={article.tags?.join(', ') || ''}
                  onChange={(e) => handleFieldChange('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                  placeholder="Enter comma-separated tags"
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
              </div>

              {/* SEO Section */}
              <div className="pt-4 border-t border-white/10 space-y-5">
                <h3 className="text-body-md text-secondary-white font-medium">SEO Settings</h3>
                
                {/* Meta Title */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">
                      Meta Title <span className="text-medium-gray/60">({article.meta_title?.length || 0}/60)</span>
                    </label>
                    <button
                      onClick={() => handleCopy(article.meta_title || '', 'meta_title')}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                    >
                      {copied === 'meta_title' ? (
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
                    value={article.meta_title || ''}
                    onChange={(e) => handleFieldChange('meta_title', e.target.value)}
                    readOnly={!canEdit}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                      canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                </div>
                
                {/* Meta Description */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">
                      Meta Description <span className="text-medium-gray/60">({article.meta_description?.length || 0}/160)</span>
                    </label>
                    <button
                      onClick={() => handleCopy(article.meta_description || '', 'meta_description')}
                      className="p-1.5 text-medium-gray hover:text-cosmic-orange hover:bg-cosmic-orange/10 rounded transition-colors"
                    >
                      {copied === 'meta_description' ? (
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
                    value={article.meta_description || ''}
                    onChange={(e) => handleFieldChange('meta_description', e.target.value)}
                    rows={2}
                    readOnly={!canEdit}
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none ${
                      canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                    }`}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Raw Content View (fallback) */
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-caption text-medium-gray uppercase tracking-wider">Raw Content</label>
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
                rows={20}
                readOnly={!canEdit}
                className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none ${
                  canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                }`}
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3 flex-shrink-0">
          <button 
            onClick={onClose} 
            className="btn-secondary flex-1 py-3"
            disabled={saving}
          >
            {isEditing ? 'Discard Changes' : 'Close'}
          </button>
          {canEdit && (
            <button 
              onClick={handleSave} 
              className="btn-primary flex-1 py-3 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

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
          <img
            src={coverPhotoUrl}
            alt="Cover full size"
            className="max-w-full max-h-full w-auto h-auto object-contain"
            referrerPolicy={coverPhotoUrl.startsWith('/api/proxy-image') ? 'no-referrer' : undefined}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
