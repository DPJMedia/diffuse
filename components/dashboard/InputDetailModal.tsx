'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, formatDuration, sanitizeStorageFilename } from '@/lib/utils/format'
import type { DiffuseProjectInput } from '@/types/database'

interface InputDetailModalProps {
  input: DiffuseProjectInput
  onClose: () => void
  onSave?: (id: string, title: string, content: string) => Promise<void>
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
  const [replacingCover, setReplacingCover] = useState(false)
  const coverReplaceInputRef = useRef<HTMLInputElement>(null)
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const isFromRecording = input.metadata?.source === 'recording'
  const isFromUpload = input.metadata?.source === 'upload'
  const isImage = input.type === 'image'
  const isCoverPhoto = input.type === 'cover_photo'
  const isDocument = input.type === 'document'
  const isAudio = input.type === 'audio'
  const showSaveButton = canEdit && (onSave || isImage)
  const showDeleteButton = canDelete && onDelete
  
  // Get type info for display
  const getTypeInfo = () => {
    if (isFromRecording) {
      return { label: 'RECORDING', color: 'text-cosmic-orange', icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )}
    }
    switch (input.type) {
      case 'audio':
        return { label: 'AUDIO', color: 'text-accent-purple', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        )}
      case 'document':
        return { label: 'DOCUMENT', color: 'text-green-400', icon: (
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
        return { label: 'COVER PHOTO', color: 'text-sky-400', icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      default:
        return { label: 'TEXT', color: 'text-pale-blue', icon: (
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
  }, [input.id, input.file_name, input.content, input.metadata?.photo_caption, input.metadata?.photo_credit])

  // Cover photo: use API so anyone with project access can load it (no signed-URL encoding issues)
  const coverPhotoApiUrl = isCoverPhoto && input.file_path
    ? `/api/project-file?path=${encodeURIComponent(input.file_path)}`
    : null
  const coverDisplayUrl = coverImageUrl ?? coverPhotoApiUrl

  // Image inputs (e.g. workflow-generated): same retrieval as output section — use project-file API when we have file_path
  const imageInputDisplayUrl = isImage && input.file_path
    ? `/api/project-file?path=${encodeURIComponent(input.file_path)}`
    : (isImage && input.metadata?.storage_url ? input.metadata.storage_url as string : null)

  useEffect(() => {
    setCoverImageUrl(null)
  }, [input.id, input.file_path])

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
    setReplacingCover(true)
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
      setReplacingCover(false)
      e.target.value = ''
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
        await onSave(input.id, title, content)
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

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="glass-container p-6 max-w-4xl w-full max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className={typeInfo.color}>
              {typeInfo.icon}
            </div>
          <h2 className="text-heading-lg text-secondary-white">Input Details</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Replace (cover photo only) */}
            {isCoverPhoto && canEdit && (
              <button
                onClick={() => coverReplaceInputRef.current?.click()}
                disabled={replacingCover}
                className="p-2 rounded-full text-medium-gray hover:text-sky-400 hover:bg-sky-400/10 transition-colors disabled:opacity-50"
                title="Replace image"
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

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden gap-6">
          {/* Metadata Row */}
          <div className="flex items-center gap-2 text-body-sm text-medium-gray shrink-0">
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
          </div>

          {/* Title Field (not for image inputs — they use the layout below) */}
          {!isImage && (
            <div className="shrink-0">
              <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => canEdit && setTitle(e.target.value)}
                placeholder={isFromRecording ? 'Recording' : isCoverPhoto ? 'Cover Photo' : isDocument ? 'Document' : isAudio ? 'Audio' : 'Text Input'}
                readOnly={!canEdit || (isImage && !isCoverPhoto)}
                className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                  canEdit && !isImage
                    ? 'focus:outline-none focus:border-cosmic-orange'
                    : 'cursor-default opacity-75'
                }`}
              />
            </div>
          )}

          {/* Image input: image left (title + download + copy), title/caption/credit right — same style as output popup */}
          {isImage && imageInputDisplayUrl && (
            <div className="flex flex-col md:flex-row md:gap-5 md:items-stretch shrink-0">
              {/* Image window: label row + image (zoom to fill); larger to match taller right column */}
              <div className="flex flex-col flex-shrink-0 w-full md:w-80 md:max-w-[340px] mb-4 md:mb-0 min-h-0">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <label className="text-caption text-medium-gray uppercase tracking-wider">Image</label>
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
                <div className="flex-1 min-h-[140px] md:min-h-0 border border-white/10 rounded-glass overflow-hidden bg-white/5 relative">
                  <Image
                    src={imageInputDisplayUrl}
                    alt={input.file_name || 'Image'}
                    fill
                    sizes="(max-width: 768px) 100vw, 220px"
                    className="object-cover"
                    unoptimized={imageInputDisplayUrl.startsWith('/api/')}
                  />
                </div>
              </div>
              {/* Title, Photo caption, Photo credit — label + copy above each field */}
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">Title</label>
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
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                      canEdit ? 'focus:outline-none focus:border-cosmic-orange' : 'cursor-default opacity-75'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">Photo caption</label>
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
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                      canEdit ? 'focus:outline-none focus:border-cosmic-orange' : 'cursor-default opacity-75'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-caption text-medium-gray uppercase tracking-wider">Photo credit</label>
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
                    className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
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
                ref={coverReplaceInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                className="hidden"
                onChange={handleReplaceCoverPhoto}
              />
              <div>
                <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">Cover photo</label>
                {(coverDisplayUrl ?? input.metadata?.storage_url) ? (
                  <div className="bg-white/5 border border-white/10 rounded-glass p-4 relative w-full h-[300px]">
                    <Image
                      src={coverDisplayUrl ?? input.metadata?.storage_url ?? ''}
                      alt={input.file_name || 'Cover photo'}
                      fill
                      sizes="(max-width: 768px) 100vw, 600px"
                      className="rounded-lg object-contain"
                    />
                  </div>
                ) : (
                  <p className="text-body-sm text-medium-gray italic">No image. Use Replace in the header to add one, or Delete to remove this input.</p>
                )}
              </div>
              <div>
                <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">Photo credit (optional)</label>
                <input
                  type="text"
                  value={photoCredit}
                  onChange={(e) => canEdit && setPhotoCredit(e.target.value)}
                  placeholder="e.g. Jane Smith / Spring-Ford Press"
                  readOnly={!canEdit}
                  className={`w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors ${
                    canEdit ? 'focus:outline-none focus:border-cosmic-orange cursor-text' : 'cursor-default opacity-75'
                  }`}
                />
                <p className="text-body-sm text-medium-gray mt-1 italic">Used when publishing to integrations. Leave blank if no credit.</p>
              </div>
            </div>
          )}

          {/* Content Field (not shown for images or cover photo) — transcription for recording, etc. */}
          {!isImage && !isCoverPhoto && (
          <div className="flex flex-col flex-1 min-h-[200px] overflow-hidden">
            <label className="block text-caption text-medium-gray mb-2 shrink-0 uppercase tracking-wider">
              {isFromRecording ? 'Transcription' : isAudio ? 'Transcription' : isDocument ? 'Extracted Text' : 'Content'}
            </label>
            <div className="flex-1 min-h-[180px] overflow-hidden flex flex-col">
              <textarea
                value={content}
                onChange={(e) => canEdit && setContent(e.target.value)}
                placeholder="Enter content..."
                readOnly={!canEdit}
                rows={10}
                className={`w-full min-h-[180px] flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors resize-y overflow-y-auto custom-scrollbar ${
                  canEdit 
                    ? 'focus:outline-none focus:border-cosmic-orange' 
                    : 'cursor-default opacity-75'
                }`}
              />
            </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex gap-3 shrink-0">
          <button 
            onClick={onClose} 
            className={`btn-secondary py-3 ${showSaveButton ? 'flex-1' : 'w-full'}`}
            disabled={saving}
          >
            Close
          </button>
          {showSaveButton && (
            <button 
              onClick={handleSave} 
              className="btn-primary flex-1 py-3 disabled:opacity-50"
              disabled={saving}
            >
              {getSaveButtonText()}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
