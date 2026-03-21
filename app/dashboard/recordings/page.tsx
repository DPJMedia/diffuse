'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime, formatDuration } from '@/lib/utils/format'
import { GridPageSkeleton } from '@/components/dashboard/Skeletons'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import EmptyState from '@/components/dashboard/EmptyState'
import AudioPlayer from '@/components/dashboard/AudioPlayer'
import RecordingModal from '@/components/dashboard/RecordingModal'
import { diffWordsWithSpace, type Change } from 'diff'
// tus-js-client will be dynamically imported when needed

type RecordingStatus = 'recorded' | 'generating' | 'transcribed'

interface Recording {
  id: string
  user_id: string
  title: string
  duration: number
  file_path: string
  transcription: string | null
  original_transcription: string | null
  speaker_map?: Record<string, { name: string; position?: string }> | null
  utterances?: Array<{ speaker: string; text: string; start: number; end: number }> | null
  original_utterances?: Array<{ speaker: string; text: string; start: number; end: number }> | null
  status: RecordingStatus
  created_at: string
}

type InlineDiffPart = { text: string; type: 'same' | 'added' | 'removed' }

function buildInlineDiffParts(original: string, current: string): InlineDiffPart[] {
  const changes = diffWordsWithSpace(original, current) as Change[]

  const parts: InlineDiffPart[] = []
  const pushPart = (type: InlineDiffPart['type'], text: string) => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }

  const commonPrefixLen = (a: string, b: string) => {
    const n = Math.min(a.length, b.length)
    let k = 0
    while (k < n && a[k] === b[k]) k++
    return k
  }

  const commonSuffixLen = (a: string, b: string) => {
    const n = Math.min(a.length, b.length)
    let k = 0
    while (k < n && a[a.length - 1 - k] === b[b.length - 1 - k]) k++
    return k
  }

  const buffer: Change[] = []
  const flushBuffer = () => {
    if (buffer.length === 0) return

    const hasAdded = buffer.some((c) => !!c.added)
    const hasRemoved = buffer.some((c) => !!c.removed)

    if (hasAdded && hasRemoved) {
      // Build the original/current text for this "change region" and collapse it into:
      // [same prefix] [removed chunk] [added chunk] [same suffix]
      const originalSeg = buffer.filter((c) => !c.added).map((c) => c.value ?? '').join('')
      const currentSeg = buffer.filter((c) => !c.removed).map((c) => c.value ?? '').join('')

      const prefix = commonPrefixLen(originalSeg, currentSeg)
      const aRest = originalSeg.slice(prefix)
      const bRest = currentSeg.slice(prefix)
      let suffix = commonSuffixLen(aRest, bRest)
      // Avoid overlap in degenerate cases.
      suffix = Math.min(suffix, aRest.length, bRest.length)

      const prefixStr = originalSeg.slice(0, prefix)
      const suffixStr = suffix > 0 ? originalSeg.slice(originalSeg.length - suffix) : ''
      const removedMid = originalSeg.slice(prefix, originalSeg.length - suffix)
      const addedMid = currentSeg.slice(prefix, currentSeg.length - suffix)

      pushPart('same', prefixStr)
      pushPart('removed', removedMid)
      pushPart('added', addedMid)
      pushPart('same', suffixStr)
    } else {
      for (const c of buffer) {
        const type: InlineDiffPart['type'] = c.added ? 'added' : c.removed ? 'removed' : 'same'
        pushPart(type, c.value ?? '')
      }
    }

    buffer.length = 0
  }

  for (const c of changes) {
    const value = c.value ?? ''
    const isSame = !c.added && !c.removed
    const isWhitespaceOnlySame = isSame && !/\S/.test(value)

    // Treat whitespace-only "same" as part of the surrounding change region so it doesn't
    // break removed/added runs into alternating fragments.
    if (isWhitespaceOnlySame) {
      buffer.push(c)
      continue
    }

    if (isSame) {
      flushBuffer()
      pushPart('same', value)
      continue
    }

    buffer.push(c)
  }

  flushBuffer()
  return parts
}

// Component to show diff between original and edited transcription
function TranscriptionDiffView({ original, current }: { original: string; current: string }) {
  const result = buildInlineDiffParts(original, current)

  return (
    <p className="text-body-md leading-relaxed whitespace-pre-wrap">
      {result.map((item, idx) => {
        if (item.type === 'same') {
          return <span key={idx} className="text-secondary-white">{item.text}</span>
        } else if (item.type === 'added') {
          return <span key={idx} className="text-cosmic-orange">{item.text}</span>
        } else {
          return <span key={idx} className="text-red-400 line-through">{item.text}</span>
        }
      })}
    </p>
  )
}

function InlineDiff({
  original,
  current,
}: {
  original: string
  current: string
}) {
  const result = buildInlineDiffParts(original, current)

  return (
    <span className="whitespace-pre-wrap">
      {result.map((item, idx) => {
        if (item.type === 'same') return <span key={idx}>{item.text}</span>
        if (item.type === 'added')
          return (
            <span key={idx} className="text-cosmic-orange">
              {item.text}
            </span>
          )
        return (
          <span key={idx} className="text-medium-gray line-through">
            {item.text}
          </span>
        )
      })}
    </span>
  )
}

function AddRecordingButton({
  className = '',
  menuClassName = 'right-0 mt-2 w-56',
  uploading,
  onUpload,
  onStartRecording,
}: {
  className?: string
  menuClassName?: string
  uploading: boolean
  onUpload: () => void
  onStartRecording: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        onClick={() => setMenuOpen((prev) => !prev)}
        className="btn-primary w-full px-4 py-2 flex items-center justify-center gap-2 text-body-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
        Add Recording
        <svg
          className={`w-4 h-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {menuOpen && (
        <div className={`absolute z-20 overflow-hidden rounded-glass border border-white/10 bg-dark-gray shadow-lg ${menuClassName}`}>
          <button
            onClick={() => {
              setMenuOpen(false)
              onUpload()
            }}
            disabled={uploading}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-body-sm text-secondary-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {uploading ? 'Uploading...' : 'Upload Recording'}
          </button>
          <button
            onClick={() => {
              setMenuOpen(false)
              onStartRecording()
            }}
            className="flex w-full items-center gap-3 border-t border-white/10 px-4 py-3 text-left text-body-sm text-secondary-white transition-colors hover:bg-white/10"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Start Recording
          </button>
        </div>
      )}
    </div>
  )
}

type SubscriptionTier = 'free' | 'pro' | 'pro_max'

/** Format minute as "[0 min]" or "[1:05 min]" for display and save */
function formatMinuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60)
  const mins = minute % 60
  return hours > 0 ? `[${hours}:${mins.toString().padStart(2, '0')} min]` : `[${minute} min]`
}

/** Build full transcript string with minute markers at the right spots (for save and for use as input) */
function buildTranscriptWithMinuteMarkers(
  utterances: Array<{ speaker: string; text: string; start: number; end?: number }>,
  speakerMap: Record<string, { name: string; position?: string }>
): string {
  if (!utterances.length) return ''
  const lines: string[] = []
  let lastMinute = -1
  for (const u of utterances) {
    const startMinute = Math.floor(u.start / 60000)
    if (startMinute > lastMinute) {
      lines.push(formatMinuteLabel(startMinute))
      lastMinute = startMinute
    }
    const mapped = speakerMap[u.speaker]
    const displayName = mapped
      ? (mapped.position ? `${mapped.name} (${mapped.position})` : mapped.name)
      : u.speaker
    lines.push(`${displayName}: ${u.text}`)
  }
  return lines.join('\n\n')
}

// Helper function to format transcription with styled minute markers (same size as body text)
function formatTranscriptionWithStyledMinuteMarkers(transcription: string | null): React.ReactNode {
  if (!transcription) return null

  const parts = transcription.split(/(\[\d+(?::\d+)? min\])/g)
  
  return parts.map((part, index) => {
    if (part.match(/^\[\d+(?::\d+)? min\]$/)) {
      return (
        <span key={index} className="text-medium-gray text-body-md">
          {part}
        </span>
      )
    }
    return <React.Fragment key={index}>{part}</React.Fragment>
  })
}

function renderWithSearchHighlights(
  text: string,
  query: string,
  matchIndexOffset: number,
  currentMatch: number
): React.ReactNode {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'gi')
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let count = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const globalIdx = matchIndexOffset + count
    nodes.push(
      <mark
        key={`match-${globalIdx}`}
        data-search-match={globalIdx}
        className={`rounded px-0.5 ${globalIdx === currentMatch ? 'bg-cosmic-orange text-black' : 'bg-cosmic-orange/30 text-secondary-white'}`}
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

export default function RecordingsPage() {
  const router = useRouter()
  const { user, currentWorkspace } = useAuth()
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [showRecordingModal, setShowRecordingModal] = useState(false)
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [pendingTranscription, setPendingTranscription] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [editedTranscription, setEditedTranscription] = useState<string | null>(null)
  const [editedUtterances, setEditedUtterances] = useState<Array<{ speaker: string; text: string; start: number; end: number }> | null>(null)
  const [isEditingUtterances, setIsEditingUtterances] = useState(false)
  const [savingTranscription, setSavingTranscription] = useState(false)
  const [generatingProject, setGeneratingProject] = useState(false)
  const [generatingStatusIndex, setGeneratingStatusIndex] = useState(0)
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>('free')
  const [projectCount, setProjectCount] = useState(0)
  
  // Persistent recording state (survives modal close)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const recordingStartTimeRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  
  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadRecordingId, setUploadRecordingId] = useState<string | null>(null)
  const [processingPercent, setProcessingPercent] = useState(0)
  const [uploadBytesLoaded, setUploadBytesLoaded] = useState(0)
  const [uploadBytesTotal, setUploadBytesTotal] = useState(0)
  const processingPercentTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  // Bulk edit mode state
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedRecordingIds, setSelectedRecordingIds] = useState<Set<string>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  // Load view preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('recordingsViewMode')
    if (saved === 'list' || saved === 'grid') setViewMode(saved)
  }, [])

  // Save view preference to localStorage
  const toggleViewMode = () => {
    const newMode = viewMode === 'grid' ? 'list' : 'grid'
    setIsEditMode(false)
    setSelectedRecordingIds(new Set())
    setViewMode(newMode)
    localStorage.setItem('recordingsViewMode', newMode)
  }

  // Transcript search state
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState('')
  const [transcriptSearchCurrentMatch, setTranscriptSearchCurrentMatch] = useState(0)
  const [transcriptSearchMatchCount, setTranscriptSearchMatchCount] = useState(0)
  const [transcriptSearchMatchOffsets, setTranscriptSearchMatchOffsets] = useState<number[]>([])
  const [showTranscriptSearch, setShowTranscriptSearch] = useState(false)
  const transcriptSearchInputRef = useRef<HTMLInputElement>(null)

  // Failed recording state
  const [failedRecordingId, setFailedRecordingId] = useState<string | null>(null)
  const [failedErrorMessage, setFailedErrorMessage] = useState('')
  const [failedErrorCode, setFailedErrorCode] = useState('')
  const failedDismissTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Speaker identification (diarization) state
  type TranscribePhase = 'idle' | 'transcribing' | 'identifying_speakers' | 'done'
  const [transcribePhase, setTranscribePhase] = useState<TranscribePhase>('idle')
  const [utterances, setUtterances] = useState<Array<{ speaker: string; text: string; start: number; end: number }>>([])
  const [originalUtterances, setOriginalUtterances] = useState<Array<{ speaker: string; text: string; start: number; end: number }>>([])
  const [speakerList, setSpeakerList] = useState<string[]>([])
  const [speakerMap, setSpeakerMap] = useState<Record<string, { name: string; position?: string }>>({})
  const [currentSpeakerIndex, setCurrentSpeakerIndex] = useState(0)
  const [speakerName, setSpeakerName] = useState('')
  const [speakerPosition, setSpeakerPosition] = useState('')
  const [clipError, setClipError] = useState(false)
  const [clipPlaying, setClipPlaying] = useState(false)
  const [currentClipSegment, setCurrentClipSegment] = useState(0)
  const [currentPlaybackTimeMs, setCurrentPlaybackTimeMs] = useState<number | null>(null)
  const [frozenHighlightIndex, setFrozenHighlightIndex] = useState<number | null>(null)
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
  const clipStopHandlerRef = useRef<((this: HTMLAudioElement, ev: Event) => any) | null>(null)
  const utteranceLineRefs = useRef<(HTMLParagraphElement | null)[]>([])
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrolledToIndexRef = useRef<number>(-1)
  const [isUserScrollingTranscript, setIsUserScrollingTranscript] = useState(false)

  const scrollUtteranceToTopWithGap = useCallback((index: number) => {
    const container = transcriptScrollRef.current
    const el = utteranceLineRefs.current[index]
    if (!container || !el) return
    const GAP_PX = 10
    const targetTop = el.offsetTop - container.offsetTop - GAP_PX
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }, [])
  
  const supabase = createClient()

  // Rotating status for "Create Project & Article" (every 15s, 8 messages = 2 min)
  const CREATE_PROJECT_STATUS_MESSAGES = [
    'Creating Project',
    'Writing Article',
    'Generating Image',
    'Adding Finishing Touches',
    'Polishing content',
    'Preparing your project',
    'Finalizing article',
    'Almost there…',
  ]
  const CREATE_PROJECT_STATUS_INTERVAL_MS = 15_000

  useEffect(() => {
    if (!generatingProject) return
    setGeneratingStatusIndex(0)
    const id = setInterval(() => {
      setGeneratingStatusIndex((i) => (i + 1) % CREATE_PROJECT_STATUS_MESSAGES.length)
    }, CREATE_PROJECT_STATUS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [generatingProject, CREATE_PROJECT_STATUS_MESSAGES.length])

  const subscriptionLimits: Record<SubscriptionTier, number> = {
    free: 3,
    pro: 15,
    pro_max: 40,
  }

  const fetchLimitData = useCallback(async () => {
    if (!user) return
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('subscription_tier')
        .eq('id', user.id)
        .single()
      if (profile?.subscription_tier) setSubscriptionTier(profile.subscription_tier as SubscriptionTier)

      const orFilter = currentWorkspace
        ? `created_by.eq.${user.id},workspace_id.eq.${currentWorkspace.id}`
        : `created_by.eq.${user.id}`
      const { data: projectsData } = await supabase
        .from('diffuse_projects')
        .select('id, project_type')
        .or(orFilter)
      // Projects + advertisements count toward the same limit
      setProjectCount(new Set((projectsData || []).map(p => p.id)).size)
    } catch (e) {
      console.warn('Limit data fetch failed', e)
    }
  }, [user, currentWorkspace, supabase])

  const fetchRecordings = useCallback(async () => {
    if (!user) return

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('diffuse_recordings')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.warn('diffuse_recordings table not found')
        setRecordings([])
        setLoading(false)
        return
      }
      setRecordings(data || [])
    } catch (error) {
      console.error('Error fetching recordings:', error)
      setRecordings([])
    } finally {
      setLoading(false)
    }
  }, [user, supabase])

  useEffect(() => {
    fetchRecordings()
  }, [fetchRecordings])

  useEffect(() => {
    if (user) fetchLimitData()
  }, [user, fetchLimitData])

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Start recording (called from modal)
  const handleStartRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Determine best supported format
      let mimeType = 'audio/webm'
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus'
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm'
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4'
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg'
        }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        setPendingBlob(audioBlob)
      }

      mediaRecorder.start(1000)
      setIsRecording(true)
      setRecordingTime(0)
      setPendingBlob(null)
      recordingStartTimeRef.current = Date.now()

      // Smooth timer: update every 100ms from start time to avoid drift and jagged jumps
      timerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - recordingStartTimeRef.current
        setRecordingTime(Math.floor(elapsedMs / 1000))
      }, 100)
    } catch (err) {
      console.error('Error starting recording:', err)
      throw err
    }
  }, [])

  // Stop recording (called from modal)
  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      // Stop mic access
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
    }
  }, [isRecording])

  // Discard recording (called from modal)
  const handleDiscardRecording = useCallback(() => {
    setPendingBlob(null)
    setRecordingTime(0)
    // Also stop any ongoing recording
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
    }
  }, [isRecording])

  // Save recording from modal and auto-start transcription
  const handleSaveRecording = async (blob: Blob, duration: number, title: string) => {
    if (!user) throw new Error('Not authenticated')

    const fileName = `${user.id}/${Date.now()}.webm`
    const { error: uploadError } = await supabase.storage
      .from('recordings')
      .upload(fileName, blob)

    if (uploadError) throw uploadError

    // Use placeholder title if none provided - will be auto-generated
    const initialTitle = title || 'Processing...'

    const { data: newRecording, error: dbError } = await supabase
      .from('diffuse_recordings')
      .insert({
        user_id: user.id,
        title: initialTitle,
        duration: duration,
        file_path: fileName,
        status: 'generating', // Start in generating state
      })
      .select()
      .single()

    if (dbError) throw dbError

    // Reset recording state and close modal
    setPendingBlob(null)
    setRecordingTime(0)
    setShowRecordingModal(false)
    
    // Show the recording detail with generating state
    setSelectedRecording(newRecording)
    await fetchRecordings()

    // Auto-start transcription in the background
    try {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('recordings')
        .createSignedUrl(newRecording.file_path, 3600)

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw new Error('Failed to get audio URL for transcription')
      }

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordingId: newRecording.id,
          audioUrl: signedUrlData.signedUrl,
          autoSave: true, // Tell API to save directly to database
          currentTitle: title, // Pass user-provided title (may be empty)
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Transcription failed')
      }

      // Refresh to show the updated recording with title and transcription
      await fetchRecordings()
      
      // Update the selected recording with new data
      const { data: updatedRecording } = await supabase
        .from('diffuse_recordings')
        .select('*')
        .eq('id', newRecording.id)
        .single()
      
      if (updatedRecording) {
        setSelectedRecording(updatedRecording)
      }
    } catch (error) {
      console.error('Auto-transcription error:', error)
      // Reset status on failure
      await supabase
        .from('diffuse_recordings')
        .update({ status: 'recorded', title: title || 'Untitled Recording' })
        .eq('id', newRecording.id)
      await fetchRecordings()
    }
  }

  // Handle file upload
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return

    const file = files[0]
    
    // Validate file type
    const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/webm']
    const validExtensions = ['.mp3', '.wav', '.m4a', '.webm']
    const fileExt = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
    
    if (!validTypes.includes(file.type) && !validExtensions.includes(fileExt)) {
      alert('Please upload a valid audio file (MP3, WAV, M4A, or WebM)')
      return
    }

    // Check file size (500MB limit to match bucket limit)
    const maxSize = 500 * 1024 * 1024
    if (file.size > maxSize) {
      alert(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 500MB.`)
      return
    }

    const ext = fileExt || '.mp3'
    const fileName = `${user.id}/${Date.now()}${ext}`

    setUploading(true)
    setProcessingPercent(0)
    setUploadBytesLoaded(0)
    setUploadBytesTotal(file.size)

    // Create recording row FIRST so the "Processing" card appears immediately
    const { data: newRecording, error: dbError } = await supabase
      .from('diffuse_recordings')
      .insert({
        user_id: user.id,
        title: 'Processing...',
        duration: 0,
        file_path: fileName,
        status: 'recorded',
      })
      .select()
      .single()

    if (dbError) {
      console.error('Failed to create recording in database:', dbError)
      setUploading(false)
      setProcessingPercent(0)
      alert('Failed to create recording entry. Please try again.')
      return
    }

    console.log('Created recording in database:', newRecording.id, 'Status:', newRecording.status)
    setUploadRecordingId(newRecording.id)
    await fetchRecordings()

    try {
      // Upload phase
      const useResumable = file.size > 6 * 1024 * 1024
      
      if (useResumable) {
        // Get Supabase URL and extract project ref
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const urlMatch = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)
        if (!urlMatch) {
          throw new Error('Invalid Supabase URL configuration')
        }
        const projectRef = urlMatch[1]
        
        // Get session token
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          throw new Error('Not authenticated')
        }
        
        // Use resumable upload for large files (use direct storage hostname for better performance)
        const uploadUrl = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
        
        // Dynamically import tus-js-client for client-side usage
        const tusModule = await import('tus-js-client')
        // Handle both default and named exports
        const TusUpload = tusModule.Upload || tusModule.default?.Upload || tusModule.default
        
        await new Promise<void>((resolve, reject) => {
          const upload = new TusUpload(file, {
            endpoint: uploadUrl,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: {
              bucketName: 'recordings',
              objectName: fileName,
              contentType: file.type || 'audio/mpeg',
              cacheControl: '3600',
            },
            headers: {
              authorization: `Bearer ${session.access_token}`,
            },
            chunkSize: 6 * 1024 * 1024, // Must be exactly 6MB for Supabase
            onError: (error) => {
              console.error('Resumable upload error:', error)
              reject(error)
            },
            onProgress: (bytesUploaded, bytesTotal) => {
              setUploadBytesLoaded(bytesUploaded)
              setUploadBytesTotal(bytesTotal)
              setProcessingPercent(Math.round((bytesUploaded / bytesTotal) * 100))
            },
            onSuccess: () => {
              setUploadBytesLoaded(file.size)
              setUploadBytesTotal(file.size)
              setProcessingPercent(100)
              resolve()
            },
          })
          
          // Check for previous uploads to resume
          upload.findPreviousUploads().then((previousUploads) => {
            if (previousUploads.length) {
              upload.resumeFromPreviousUpload(previousUploads[0])
            }
            upload.start()
          }).catch((error) => {
            // If findPreviousUploads fails, just start the upload
            upload.start()
          })
        })
      } else {
        // Standard upload for smaller files
        const { error: uploadError } = await supabase.storage
          .from('recordings')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'audio/mpeg',
          })

        if (uploadError) {
          // Provide more helpful error messages
          if (uploadError.message?.includes('exceeded the maximum allowed size')) {
            throw new Error('File is too large. The storage bucket limit may need to be increased.')
          }
          if (uploadError.message?.includes('Payload too large') || uploadError.message?.includes('413')) {
            throw new Error('File is too large. Try compressing it or using a shorter recording.')
          }
          throw uploadError
        }
        setUploadBytesLoaded(file.size)
        setProcessingPercent(100)
      }

      // Duration extraction
      const { data: signedUrlForDuration, error: durationUrlError } = await supabase.storage
        .from('recordings')
        .createSignedUrl(fileName, 3600)

      let detectedDuration = 0
      if (!durationUrlError && signedUrlForDuration?.signedUrl) {
        try {
          // Extract duration from the uploaded audio file
          detectedDuration = await new Promise<number>((resolve) => {
            const audio = new Audio()
            audio.preload = 'metadata'
            
            const handleLoadedMetadata = () => {
              if (audio.duration && isFinite(audio.duration) && audio.duration !== Infinity) {
                resolve(Math.round(audio.duration))
              } else {
                resolve(0)
              }
              audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
              audio.removeEventListener('error', handleError)
            }
            
            const handleError = () => {
              resolve(0)
              audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
              audio.removeEventListener('error', handleError)
            }
            
            audio.addEventListener('loadedmetadata', handleLoadedMetadata)
            audio.addEventListener('error', handleError)
            audio.src = signedUrlForDuration.signedUrl
            
            // Timeout after 10 seconds if duration can't be detected
            setTimeout(() => {
              audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
              audio.removeEventListener('error', handleError)
              resolve(0)
            }, 10000)
          })
        } catch (error) {
          console.warn('Failed to extract duration:', error)
          detectedDuration = 0
        }
      }

      // Update recording with duration
      if (detectedDuration > 0) {
        await supabase.from('diffuse_recordings').update({ duration: detectedDuration }).eq('id', newRecording.id)
      }

      // Done - refresh and clear upload state
      console.log('Upload complete, recording ID:', newRecording.id, 'Duration:', detectedDuration, 'Status: recorded')
      await fetchRecordings()
      setUploadRecordingId(null)
      setProcessingPercent(0)
      setUploadBytesLoaded(0)
      setUploadBytesTotal(0)
      console.log('Upload state cleared, recordings list refreshed')

      // Auto-start transcription for the uploaded recording (don't open modal)
      const recordingToTranscribe: Recording = { ...newRecording, duration: detectedDuration }
      transcribeRecording(recordingToTranscribe, { openModal: false })
    } catch (error) {
      console.error('Upload error:', error)
      if (processingPercentTimerRef.current) {
        clearInterval(processingPercentTimerRef.current)
        processingPercentTimerRef.current = null
      }
      setUploadRecordingId(null)
      setProcessingPercent(0)
      setUploadBytesLoaded(0)
      setUploadBytesTotal(0)
      const message = error instanceof Error ? error.message : 'Failed to upload recording'
      const code = message.includes('timeout') ? 'TIMEOUT' : message.includes('413') || message.includes('Payload') ? 'TOO_LARGE' : message.includes('URL') ? 'URL_ERR' : 'UPLOAD_ERR'
      if (newRecording?.id) {
        setFailedRecordingId(newRecording.id)
        setFailedErrorMessage(message)
        setFailedErrorCode(code)
      }
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  // Utterances that count as playable clips: at least 2 words, 1s duration, not just filler.
  // Keeps bar low so "Try Another Clip" is available whenever a speaker spoke more than once.
  const FILLER_ONLY = /^(um|uh|hmm|yeah|yes|no|so|well|like|okay|ok|right)\s*\.?$/i
  const MIN_WORDS = 2
  const MIN_DURATION_MS = 1000

  function getClearClipSegmentsForSpeaker(speaker: string): Array<{ start: number; end: number }> {
    const speakerUtterances = utterances
      .filter((u) => u.speaker === speaker)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))
    if (!speakerUtterances.length) return []

    const clear = speakerUtterances.filter((u) => {
      const words = u.text.trim().split(/\s+/).filter(Boolean)
      const durationMs = u.end - u.start
      if (words.length < MIN_WORDS || durationMs < MIN_DURATION_MS) return false
      if (FILLER_ONLY.test(u.text.trim())) return false
      return true
    })

    const segments = (clear.length > 0 ? clear : speakerUtterances).map((u) => ({
      start: u.start,
      end: u.end,
    }))
    return segments
  }

  // Play one clip segment for the current speaker: segment 0 = first (clear) utterance, segment 1 = next time they spoke, etc.
  const playCurrentSpeakerClip = (segmentIndex: number = currentClipSegment) => {
    // Clear any previous error so we don't show stale failures
    setClipError(false)
    if (!audioUrl || !utterances.length || currentSpeakerIndex >= speakerList.length || !audioPlayerRef.current) {
      setClipError(true)
      return
    }

    const currentSpeaker = speakerList[currentSpeakerIndex]
    const segments = getClearClipSegmentsForSpeaker(currentSpeaker)

    if (!segments.length || segmentIndex >= segments.length) {
      setClipError(true)
      return
    }

    const seg = segments[segmentIndex]
    const startTimeSec = seg.start / 1000
    const clipDuration = (seg.end - seg.start) / 1000
    if (!isFinite(clipDuration) || clipDuration <= 0) {
      setClipError(true)
      return
    }

    try {
      const audio = audioPlayerRef.current
      // Remove any previous clip stop handler to avoid immediately pausing the new clip
      if (clipStopHandlerRef.current) {
        audio.removeEventListener('timeupdate', clipStopHandlerRef.current)
        clipStopHandlerRef.current = null
      }
      audio.currentTime = startTimeSec
      setClipPlaying(true)
      setClipError(false)

      const playPromise = audio.play()

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            const stopClip = () => {
              if (audio.currentTime >= startTimeSec + clipDuration) {
                audio.pause()
                setClipPlaying(false)
                audio.removeEventListener('timeupdate', stopClip)
                if (clipStopHandlerRef.current === stopClip) clipStopHandlerRef.current = null
              }
            }
            clipStopHandlerRef.current = stopClip
            audio.addEventListener('timeupdate', stopClip)
          })
          .catch((error) => {
            console.warn('Autoplay failed:', error)
            setClipPlaying(false)
            setClipError(true)
            if (clipStopHandlerRef.current) {
              audio.removeEventListener('timeupdate', clipStopHandlerRef.current)
              clipStopHandlerRef.current = null
            }
          })
      }
    } catch (error) {
      console.error('Error playing clip:', error)
      setClipError(true)
      setClipPlaying(false)
    }
  }

  const pauseCurrentSpeakerClip = () => {
    if (audioPlayerRef.current) {
      if (clipStopHandlerRef.current) {
        audioPlayerRef.current.removeEventListener('timeupdate', clipStopHandlerRef.current)
        clipStopHandlerRef.current = null
      }
      audioPlayerRef.current.pause()
      setClipPlaying(false)
    }
  }

  const tryAnotherClip = () => {
    pauseCurrentSpeakerClip()
    setClipError(false)
    const segments = getClearClipSegmentsForSpeaker(speakerList[currentSpeakerIndex] ?? '')
    if (!segments.length) return
    const nextSegment = segments.length > 1 ? (currentClipSegment + 1) % segments.length : 0
    setCurrentClipSegment(nextSegment)
    playCurrentSpeakerClip(nextSegment)
  }

  const handleIdentifySpeaker = async () => {
    const currentSpeaker = speakerList[currentSpeakerIndex]
    const defaultName = `Speaker ${currentSpeakerIndex + 1}`
    const finalName = speakerName.trim() || defaultName
    const newSpeakerMap = {
      ...speakerMap,
      [currentSpeaker]: {
        name: finalName,
        position: speakerPosition.trim() || undefined,
      },
    }
    setSpeakerMap(newSpeakerMap)

    if (currentSpeakerIndex < speakerList.length - 1) {
      pauseCurrentSpeakerClip()
      const nextIndex = currentSpeakerIndex + 1
      const nextSpeaker = speakerList[nextIndex]
      const existing = newSpeakerMap[nextSpeaker]
      setCurrentSpeakerIndex(nextIndex)
      setSpeakerName(existing?.name && existing.name.startsWith('Speaker ') ? '' : (existing?.name || ''))
      setSpeakerPosition(existing?.position || '')
      setClipError(false)
      setCurrentClipSegment(0)
    } else {
      // Replace A, B, C, D in the transcript with names (and positions); include minute markers at correct spots
      const enrichedTranscript = buildTranscriptWithMinuteMarkers(utterances, newSpeakerMap)

      setTranscribePhase('done')
      if (!selectedRecording) return
      try {
        await supabase
          .from('diffuse_recordings')
          .update({
            transcription: enrichedTranscript,
            original_transcription: enrichedTranscript,
            status: 'transcribed',
            speaker_map: newSpeakerMap,
          })
          .eq('id', selectedRecording.id)
        await fetchRecordings()
        setSelectedRecording({ ...selectedRecording, transcription: enrichedTranscript, original_transcription: enrichedTranscript, status: 'transcribed', speaker_map: newSpeakerMap })
        setPendingTranscription(null)
      } catch (err) {
        console.error('Error saving transcription:', err)
        alert('Failed to save transcription')
      }
    }
  }

  const transcribeRecording = async (recording: Recording, options?: { openModal?: boolean }) => {
    const openModal = options?.openModal !== false
    setTranscribing(true)

    try {
      await supabase
        .from('diffuse_recordings')
        .update({ status: 'generating' })
        .eq('id', recording.id)

      if (openModal) setSelectedRecording({ ...recording, status: 'generating' })
      fetchRecordings()

      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('recordings')
        .createSignedUrl(recording.file_path, 3600)

      if (signedUrlError || !signedUrlData?.signedUrl) {
        await supabase
          .from('diffuse_recordings')
          .update({ status: 'recorded' })
          .eq('id', recording.id)
        throw new Error('Failed to get audio URL for transcription')
      }

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordingId: recording.id,
          audioUrl: signedUrlData.signedUrl,
          autoSave: true,
          currentTitle: recording.title,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        await supabase
          .from('diffuse_recordings')
          .update({ status: 'recorded' })
          .eq('id', recording.id)
        throw new Error(data.error || 'Transcription failed')
      }

      // Server-side autosave (API) writes title/transcript/status/utterances.
      // We refetch the list so the card never regresses to "generating" when opened.
      const newTitle = data.suggestedTitle || data.finalTitle || recording.title
      const rawTranscript = data.utterances?.length
        ? data.utterances.map((u: { speaker: string; text: string }) => `${u.speaker}: ${u.text}`).join('\n\n')
        : data.transcription
      await fetchRecordings()

      // If we have speaker labels (A, B, C, D), run "Who is this?" flow before showing transcript.
      // Speaker 1 = A, Speaker 2 = B, etc. We replace A/B/C/D with names (and positions) in the final transcript.
      // HOWEVER: If AssemblyAI returns only 1 utterance spanning the whole file, diarization failed.
      // In that case, skip the identification flow and just use the plain transcript.
      if (data.utterances && data.utterances.length > 0) {
        const uniqueSpeakers: string[] = []
        for (const utterance of data.utterances) {
          if (!uniqueSpeakers.includes(utterance.speaker)) {
            uniqueSpeakers.push(utterance.speaker)
          }
        }
        uniqueSpeakers.sort((a, b) => a.localeCompare(b)) // Guarantee order: A, B, C, D, ...

        // Check if this is a failed diarization: 1 speaker with 1 giant utterance
        const isSingleGiantUtterance = data.utterances.length === 1 && uniqueSpeakers.length === 1
        
        if (isSingleGiantUtterance) {
          // Diarization failed - skip "Who is this?" and use plain transcript
          console.log('Diarization failed: single utterance detected, skipping speaker identification')
          setTranscribePhase('done')
          if (openModal) {
            setSelectedRecording({ ...recording, status: 'transcribed', title: newTitle, transcription: rawTranscript, original_transcription: rawTranscript })
            setPendingTranscription(null)
          }
        } else {
          // Normal multi-speaker flow
          setUtterances(data.utterances)
          setSpeakerList(uniqueSpeakers)
          setSpeakerMap({})
          setCurrentSpeakerIndex(0)
          setCurrentClipSegment(0)
          setSpeakerName('')
          setSpeakerPosition('')
          setTranscribePhase('identifying_speakers')
          setClipError(false)
          setCurrentClipSegment(0)

          if (openModal) {
            setSelectedRecording({ ...recording, status: 'transcribed', title: newTitle, transcription: rawTranscript, original_transcription: rawTranscript })
          }
        }
      } else {
        setTranscribePhase('done')
        if (openModal) {
          setSelectedRecording({ ...recording, status: 'transcribed', title: newTitle, transcription: rawTranscript, original_transcription: rawTranscript })
          setPendingTranscription(null)
        }
      }
    } catch (error) {
      console.error('Error transcribing:', error)
      alert(error instanceof Error ? error.message : 'Failed to transcribe recording')
      fetchRecordings()
    } finally {
      setTranscribing(false)
    }
  }

  const saveTranscription = async () => {
    if (!selectedRecording || !pendingTranscription) return

    try {
      const updateData: Record<string, unknown> = {
        transcription: pendingTranscription,
        original_transcription: pendingTranscription,
        status: 'transcribed',
      }
      if (Object.keys(speakerMap).length > 0) {
        updateData.speaker_map = speakerMap
      }

      const { error } = await supabase
        .from('diffuse_recordings')
        .update(updateData)
        .eq('id', selectedRecording.id)

      if (error) throw error

      setPendingTranscription(null)
      setSelectedRecording(null)
      setTranscribePhase('idle')
      setUtterances([])
      setSpeakerList([])
      setSpeakerMap({})
      setCurrentSpeakerIndex(0)
      setCurrentClipSegment(0)
      setSpeakerName('')
      setSpeakerPosition('')
      fetchRecordings()
    } catch (error) {
      console.error('Error saving transcription:', error)
      alert('Failed to save transcription')
    }
  }

  const saveEditedTranscription = async () => {
    if (!selectedRecording) return

    setSavingTranscription(true)
    try {
      if (isEditingUtterances && editedUtterances && editedUtterances.length > 0) {
        const uniqueSpeakers: string[] = []
        for (const u of editedUtterances) {
          if (!uniqueSpeakers.includes(u.speaker)) uniqueSpeakers.push(u.speaker)
        }
        uniqueSpeakers.sort((a, b) => a.localeCompare(b))

        const mapForBuild = (speakerMap ?? {}) as Record<string, { name: string; position?: string }>
        const transcriptionToSave = buildTranscriptWithMinuteMarkers(editedUtterances, mapForBuild)

        const { error } = await supabase
          .from('diffuse_recordings')
          .update({
            transcription: transcriptionToSave,
            utterances: editedUtterances,
          })
          .eq('id', selectedRecording.id)

        if (error) throw error

        setSelectedRecording({
          ...selectedRecording,
          transcription: transcriptionToSave,
          utterances: editedUtterances,
        })
        setUtterances(editedUtterances)
        setIsEditingUtterances(false)
        setEditedUtterances(null)
        setEditedTranscription(null)
        setFrozenHighlightIndex(null)
      } else {
        if (editedTranscription === null) return
        const { error } = await supabase
          .from('diffuse_recordings')
          .update({ transcription: editedTranscription })
          .eq('id', selectedRecording.id)

        if (error) throw error

        setSelectedRecording({
          ...selectedRecording,
          transcription: editedTranscription,
        })
        setEditedTranscription(null)
        setFrozenHighlightIndex(null)
      }
      fetchRecordings()
    } catch (error) {
      console.error('Error saving transcription:', error)
      alert('Failed to save transcription')
    } finally {
      setSavingTranscription(false)
    }
  }

  const projectLimit = subscriptionLimits[subscriptionTier]
  const hasReachedProjectLimit = projectCount >= projectLimit

  const handleCreateProjectAndArticle = async () => {
    if (!selectedRecording || !selectedRecording.transcription) return
    if (hasReachedProjectLimit) {
      router.push('/dashboard/subscription')
      return
    }

    setGeneratingProject(true)
    try {
      const response = await fetch('/api/workflow/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recording_id: selectedRecording.id,
          recording_title: selectedRecording.title,
          transcription: selectedRecording.transcription,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create project')
      }

      const projectId = result.project_id
      if (!projectId) {
        throw new Error('No project ID returned from workflow')
      }

      // Close modal so UI updates immediately, then refresh and open the new project on Outputs tab
      setSelectedRecording(null)
      router.refresh()
      router.push(`/dashboard/projects/${projectId}?tab=outputs`)
    } catch (error) {
      console.error('Error creating project:', error)
      alert(error instanceof Error ? error.message : 'Failed to create project and article')
    } finally {
      setGeneratingProject(false)
    }
  }

  const fetchAudioUrl = useCallback(async (filePath: string) => {
    setLoadingAudio(true)
    setAudioUrl(null)
    
    try {
      const { data, error } = await supabase.storage
        .from('recordings')
        .createSignedUrl(filePath, 3600)

      if (error) throw error

      if (data?.signedUrl) {
        setAudioUrl(data.signedUrl)
      } else {
        throw new Error('No signed URL returned')
      }
    } catch (error: any) {
      console.error('Error fetching audio URL:', error?.message || error)
      setAudioUrl(null)
    } finally {
      setLoadingAudio(false)
    }
  }, [supabase])

  // Auto-load audio whenever a recording is selected (works for any status: recorded, generating, transcribed)
  useEffect(() => {
    if (selectedRecording?.file_path) {
      fetchAudioUrl(selectedRecording.file_path)
    } else {
      setAudioUrl(null)
    }
  }, [selectedRecording?.id, selectedRecording?.file_path, fetchAudioUrl])

  // When upload completes, refetch audio if the modal is open for that recording so the player loads
  const prevUploadRecordingIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevUploadRecordingIdRef.current !== null && uploadRecordingId === null && selectedRecording?.id === prevUploadRecordingIdRef.current) {
      if (selectedRecording?.file_path) fetchAudioUrl(selectedRecording.file_path)
    }
    prevUploadRecordingIdRef.current = uploadRecordingId
  }, [uploadRecordingId, selectedRecording?.id, selectedRecording?.file_path, fetchAudioUrl])

  // Scroll transcript every couple of lines so the highlight advances in chunks and user can follow
  const displayUtterances = useMemo(
    () => (utterances.length > 0 ? utterances : (selectedRecording?.utterances ?? [])),
    [utterances, selectedRecording?.utterances]
  )
  const displayOriginalUtterances = useMemo(
    () =>
      originalUtterances.length > 0
        ? originalUtterances
        : (selectedRecording?.original_utterances ?? selectedRecording?.utterances ?? []),
    [originalUtterances, selectedRecording?.original_utterances, selectedRecording?.utterances]
  )
  const LINES_BEFORE_SCROLL = 2

  // Recompute search match offsets and count whenever query or utterances change
  useEffect(() => {
    if (!transcriptSearchQuery.trim()) {
      setTranscriptSearchMatchOffsets([])
      setTranscriptSearchMatchCount(0)
      setTranscriptSearchCurrentMatch(0)
      return
    }
    const escaped = transcriptSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const utterancesToSearch = isEditingUtterances && editedUtterances ? editedUtterances : displayUtterances
    if (utterancesToSearch.length > 0) {
      const offsets: number[] = []
      let total = 0
      for (const u of utterancesToSearch) {
        offsets.push(total)
        const matches = u.text.match(regex)
        total += matches ? matches.length : 0
      }
      setTranscriptSearchMatchOffsets(offsets)
      setTranscriptSearchMatchCount(total)
    } else if (selectedRecording?.transcription) {
      const matches = selectedRecording.transcription.match(regex)
      setTranscriptSearchMatchCount(matches ? matches.length : 0)
      setTranscriptSearchMatchOffsets([])
    }
    setTranscriptSearchCurrentMatch(0)
  }, [transcriptSearchQuery, displayUtterances, editedUtterances, isEditingUtterances, selectedRecording])

  // Keyboard shortcut: Cmd/Ctrl+F opens transcript search when modal is open
  useEffect(() => {
    if (!selectedRecording) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setShowTranscriptSearch(true)
        setTimeout(() => transcriptSearchInputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape' && showTranscriptSearch) {
        setShowTranscriptSearch(false)
        setTranscriptSearchQuery('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRecording, showTranscriptSearch])

  // Scroll to current match when it changes
  useEffect(() => {
    if (!transcriptSearchQuery.trim() || transcriptSearchMatchCount === 0) return
    const el = document.querySelector(`[data-search-match="${transcriptSearchCurrentMatch}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [transcriptSearchCurrentMatch, transcriptSearchQuery, transcriptSearchMatchCount])
  useEffect(() => {
    if (isUserScrollingTranscript) return
    if (isEditingUtterances || editedTranscription !== null) return
    if (currentPlaybackTimeMs == null || displayUtterances.length === 0) return
    const activeIndex = displayUtterances.findIndex(
      (u) => currentPlaybackTimeMs >= u.start && currentPlaybackTimeMs <= u.end
    )
    if (activeIndex < 0 || !utteranceLineRefs.current[activeIndex]) return
    const last = lastScrolledToIndexRef.current
    const shouldScroll = last < 0 || Math.abs(activeIndex - last) >= LINES_BEFORE_SCROLL
    if (shouldScroll) {
      lastScrolledToIndexRef.current = activeIndex
      scrollUtteranceToTopWithGap(activeIndex)
    }
  }, [currentPlaybackTimeMs, displayUtterances, isUserScrollingTranscript, scrollUtteranceToTopWithGap, isEditingUtterances, editedTranscription])

  useEffect(() => {
    if (!selectedRecording || selectedRecording.status !== 'generating') return

    const pollInterval = setInterval(async () => {
      const { data, error } = await supabase
        .from('diffuse_recordings')
        .select('*')
        .eq('id', selectedRecording.id)
        .single()

      if (error) {
        console.error('Error polling recording:', error)
        return
      }

      if (data && data.status !== 'generating') {
        setSelectedRecording(data)
        fetchRecordings()
        clearInterval(pollInterval)
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [selectedRecording, fetchRecordings, supabase])

  const cancelTranscription = async (recordingId: string) => {
    try {
      const { error } = await supabase
        .from('diffuse_recordings')
        .update({ status: 'recorded' })
        .eq('id', recordingId)

      if (error) throw error

      if (selectedRecording && selectedRecording.id === recordingId) {
        setSelectedRecording({ ...selectedRecording, status: 'recorded' })
      }
      setTranscribing(false)
      setPendingTranscription(null)
      fetchRecordings()
    } catch (error) {
      console.error('Error cancelling transcription:', error)
      alert('Failed to cancel transcription')
    }
  }

  const openRecording = async (rec: Recording) => {
    setPendingTranscription(null)
    setEditingTitle(false)
    setEditedTitle('')
    setTranscribePhase('idle')
    setUtterances([])
    setOriginalUtterances([])
    setSpeakerList([])
    setSpeakerMap({})
    setCurrentSpeakerIndex(0)
    setCurrentClipSegment(0)
    setSpeakerName('')
    setSpeakerPosition('')
    setCurrentPlaybackTimeMs(null)
    setIsUserScrollingTranscript(false)
    lastScrolledToIndexRef.current = -1

    const { data, error } = await supabase
      .from('diffuse_recordings')
      .select('*')
      .eq('id', rec.id)
      .single()

    if (error || !data) {
      console.error('Error fetching recording:', error)
      setSelectedRecording(rec)
      return
    }

    setSelectedRecording(data)
    const loadedUtterances = Array.isArray(data.utterances) ? data.utterances : []
    setUtterances(loadedUtterances)
    const loadedOriginalUtterances = Array.isArray(data.original_utterances)
      ? data.original_utterances
      : loadedUtterances
    setOriginalUtterances(loadedOriginalUtterances)

    const existingMap: Record<string, { name: string; position?: string }> =
      data.speaker_map && typeof data.speaker_map === 'object' ? data.speaker_map : {}
    setSpeakerMap(existingMap)

    // If we have diarization utterances but speaker names aren't filled yet, resume "Who is this?" flow.
    if (loadedUtterances.length > 0) {
      const uniqueSpeakers: string[] = []
      for (const u of loadedUtterances) {
        if (!uniqueSpeakers.includes(u.speaker)) uniqueSpeakers.push(u.speaker)
      }
      uniqueSpeakers.sort((a, b) => a.localeCompare(b))

      const firstMissingIndex = uniqueSpeakers.findIndex((s) => !existingMap?.[s]?.name)
      if (firstMissingIndex !== -1) {
        pauseCurrentSpeakerClip()
        setSpeakerList(uniqueSpeakers)
        setCurrentSpeakerIndex(firstMissingIndex)
        setCurrentClipSegment(0)
        const s = uniqueSpeakers[firstMissingIndex]
        const existing = existingMap[s]
        setSpeakerName(existing?.name && existing.name.startsWith('Speaker ') ? '' : (existing?.name || ''))
        setSpeakerPosition(existing?.position || '')
        setClipError(false)
        setTranscribePhase('identifying_speakers')
      } else {
        setSpeakerList(uniqueSpeakers)
      }
    }
  }

  const startSpeakerWalkthrough = () => {
    if (!selectedRecording) return
    const existingMap: Record<string, { name: string; position?: string }> =
      selectedRecording.speaker_map && typeof selectedRecording.speaker_map === 'object' ? selectedRecording.speaker_map : speakerMap
    const baseUtterances = displayUtterances
    if (!baseUtterances.length) return

    const uniqueSpeakers: string[] = []
    for (const u of baseUtterances) {
      if (!uniqueSpeakers.includes(u.speaker)) uniqueSpeakers.push(u.speaker)
    }
    uniqueSpeakers.sort((a, b) => a.localeCompare(b))

    pauseCurrentSpeakerClip()
    audioPlayerRef.current?.pause()
    setClipPlaying(false)

    setSpeakerList(uniqueSpeakers)
    setSpeakerMap(existingMap)
    setCurrentSpeakerIndex(0)
    setCurrentClipSegment(0)
    const first = uniqueSpeakers[0]
    const existing = existingMap[first]
    setSpeakerName(existing?.name && existing.name.startsWith('Speaker ') ? '' : (existing?.name || ''))
    setSpeakerPosition(existing?.position || '')
    setClipError(false)
    setTranscribePhase('identifying_speakers')
  }

  const updateRecordingTitle = async (newTitle: string) => {
    if (!selectedRecording || !newTitle.trim()) return

    try {
      const { error } = await supabase
        .from('diffuse_recordings')
        .update({ title: newTitle.trim() })
        .eq('id', selectedRecording.id)

      if (error) throw error

      setSelectedRecording({ ...selectedRecording, title: newTitle.trim() })
      setEditingTitle(false)
      fetchRecordings()
    } catch (error) {
      console.error('Error updating title:', error)
      alert('Failed to update title')
    }
  }

  const deleteRecording = async (id: string, filePath: string) => {
    try {
      await supabase.storage.from('recordings').remove([filePath])

      const { error } = await supabase
        .from('diffuse_recordings')
        .delete()
        .eq('id', id)

      if (error) throw error

      fetchRecordings()
    } catch (error) {
      console.error('Error deleting recording:', error)
      alert('Failed to delete recording')
    }
  }

  const toggleSelectRecording = (id: string) => {
    setSelectedRecordingIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitBulkEditMode = () => {
    setIsEditMode(false)
    setSelectedRecordingIds(new Set())
  }

  const handleBulkDeleteRecordings = async () => {
    if (selectedRecordingIds.size === 0) return
    if (!confirm(`Delete ${selectedRecordingIds.size} recording${selectedRecordingIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return

    setIsBulkDeleting(true)
    try {
      const toDelete = recordings.filter((r) => selectedRecordingIds.has(r.id))
      for (const rec of toDelete) {
        await supabase.storage.from('recordings').remove([rec.file_path])
        await supabase.from('diffuse_recordings').delete().eq('id', rec.id)
      }
      exitBulkEditMode()
      fetchRecordings()
    } catch (error) {
      console.error('Error bulk deleting recordings:', error)
      alert('Failed to delete some recordings')
    } finally {
      setIsBulkDeleting(false)
    }
  }

  if (!user) {
    return <GridPageSkeleton viewMode={viewMode} />
  }

  const isListSelectionActive = viewMode === 'list' && selectedRecordingIds.size > 0
  const showBulkActions = isEditMode || isListSelectionActive
  const openUploadPicker = () => {
    uploadInputRef.current?.click()
  }
  const openRecordingModal = () => {
    setShowRecordingModal(true)
  }

  // Dynamic button based on recording state
  const RecordingButton = ({
    className = '',
    menuClassName = 'right-0 mt-2 w-56',
  }: {
    className?: string
    menuClassName?: string
  }) => {
    if (isRecording || pendingBlob) {
      // Recording in progress or pending save
      return (
        <button
          onClick={openRecordingModal}
          className={`px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm transition-all ${
            isRecording 
              ? 'bg-red-500/20 border border-red-500 text-red-400 hover:bg-red-500/30' 
              : 'bg-green-500/20 border border-green-500 text-green-400 hover:bg-green-500/30'
          } ${className}`}
        >
          {isRecording ? (
            <>
              <span className="animate-pulse w-2 h-2 bg-red-500 rounded-full" />
              Recording: {formatTime(recordingTime)}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save Recording
            </>
          )}
        </button>
      )
    }

    return (
      <AddRecordingButton
        className={className}
        menuClassName={menuClassName}
        uploading={uploading}
        onUpload={openUploadPicker}
        onStartRecording={openRecordingModal}
      />
    )
  }

  return (
    <div>
      {/* Hidden file input for uploads */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.webm,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/webm"
        onChange={(e) => handleFileUpload(e.target.files)}
        className="hidden"
      />
      
      <div className="flex items-center justify-between mb-8">
        <h1 data-walkthrough="page-title" className="text-display-sm text-secondary-white">Recordings</h1>
        <div className="hidden md:flex items-center gap-3">
          {showBulkActions ? (
            <>
              <button
                onClick={handleBulkDeleteRecordings}
                disabled={selectedRecordingIds.size === 0 || isBulkDeleting}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isBulkDeleting ? 'Deleting...' : `Delete${selectedRecordingIds.size > 0 ? ` (${selectedRecordingIds.size})` : ''}`}
              </button>
              <button
                onClick={exitBulkEditMode}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-medium-gray hover:bg-white/10 transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </>
          ) : (
            <>
              <div className="flex w-[92px] items-center justify-end gap-3">
                {viewMode === 'grid' && recordings.length > 0 ? (
                  <button
                    onClick={() => setIsEditMode(true)}
                    className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-glass-sm border border-white/20 text-secondary-white hover:bg-white/10 transition-colors"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                ) : (
                  <div className="h-10 w-10 flex-shrink-0" />
                )}
                <button
                  onClick={toggleViewMode}
                  className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-glass-sm border border-white/20 text-secondary-white hover:bg-white/10 transition-colors"
                  title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                >
                  {viewMode === 'grid' ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  )}
                </button>
              </div>
              <RecordingButton className="w-60 flex-shrink-0" />
            </>
          )}
        </div>
      </div>

      {/* Recordings Grid */}
      {loading ? (
        <GridPageSkeleton showHeader={false} viewMode={viewMode} />
      ) : recordings.length === 0 && !isRecording && !pendingBlob ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          }
          title="No Recordings Yet"
          description="Start recording or upload an audio file to create transcriptions for your projects."
          action={
            <div className="mt-4 w-full max-w-xs">
              <RecordingButton className="w-full" menuClassName="left-0 right-0 mt-2" />
            </div>
          }
        />
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4' : 'flex flex-col gap-3'}>
          {/* Mobile Buttons - stacked at top of grid */}
          {!showBulkActions ? (
            <div className="md:hidden col-span-1 flex flex-col gap-2">
              <RecordingButton className="w-full" />
            </div>
          ) : (
            <div className="md:hidden col-span-1 flex gap-2">
              <button
                onClick={handleBulkDeleteRecordings}
                disabled={selectedRecordingIds.size === 0 || isBulkDeleting}
                className="flex-1 px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isBulkDeleting ? 'Deleting...' : `Delete${selectedRecordingIds.size > 0 ? ` (${selectedRecordingIds.size})` : ''}`}
              </button>
              <button
                onClick={exitBulkEditMode}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-medium-gray hover:bg-white/10 transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </div>
          )}
          {recordings.map((rec) => {
            const isCurrentUpload = rec.id === uploadRecordingId
            const showUploadProgress = isCurrentUpload && uploadBytesTotal > 0
            const isSelected = selectedRecordingIds.has(rec.id)
            
            if (viewMode === 'list') {
              // List view: compact horizontal layout
              return (
                <div
                  key={rec.id}
                  onClick={() => {
                    if (!isCurrentUpload) {
                      openRecording(rec)
                    }
                  }}
                  className={`glass-container p-4 transition-colors flex items-center gap-4 ${
                    isCurrentUpload
                      ? 'cursor-wait'
                      : isSelected
                      ? 'cursor-pointer bg-cosmic-orange/10 border-cosmic-orange/50 hover:bg-cosmic-orange/15'
                      : 'cursor-pointer hover:bg-white/10'
                  }`}
                >
                  {isCurrentUpload ? (
                    <div className="flex-shrink-0 w-10 h-10 bg-white/5 rounded-glass border-2 border-white/10 flex items-center justify-center text-cosmic-orange">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSelectRecording(rec.id)
                      }}
                      className={`flex-shrink-0 w-10 h-10 rounded-glass border-2 flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-cosmic-orange border-cosmic-orange text-black'
                          : 'bg-white/5 border-transparent text-cosmic-orange hover:border-white/30'
                      }`}
                      aria-label={isSelected ? `Deselect ${rec.title}` : `Select ${rec.title}`}
                    >
                      {isSelected ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      )}
                    </button>
                  )}
                  
                  {/* Recording info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body-md text-secondary-white font-medium truncate mb-1">
                      {rec.title}
                    </h3>
                    <div className="flex items-center gap-2 text-caption text-medium-gray uppercase tracking-wider flex-wrap">
                      {showUploadProgress ? (
                        <>
                          <span className="text-accent-purple">{processingPercent}%</span>
                          {uploadBytesTotal > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-cosmic-orange">
                                {((uploadBytesLoaded || 0) / 1024 / 1024).toFixed(1)} MB / {(uploadBytesTotal / 1024 / 1024).toFixed(1)} MB
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-accent-purple">{formatDuration(rec.duration)}</span>
                          <span>•</span>
                          <span>{new Date(rec.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Status badge */}
                  <div className="flex-shrink-0 text-caption uppercase tracking-wider px-2 py-1 bg-white/5 rounded">
                    {rec.status === 'transcribed' ? (
                      <span className="text-cosmic-orange">TRANSCRIBED</span>
                    ) : rec.status === 'generating' ? (
                      <span className="text-cosmic-orange flex items-center gap-1.5">
                        <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        GENERATING
                      </span>
                    ) : (
                      <span className="text-medium-gray">RECORDED</span>
                    )}
                  </div>
                  
                  {/* Arrow */}
                  {!isSelected && !isCurrentUpload && (
                    <svg className="w-5 h-5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              )
            }
            
            // Grid view: original card layout
            return (
              <div
                key={rec.id}
                onClick={() => {
                  if (isEditMode && !isCurrentUpload) {
                    toggleSelectRecording(rec.id)
                  } else if (!isCurrentUpload) {
                    openRecording(rec)
                  }
                }}
                className={`glass-container p-6 transition-colors relative ${
                  isCurrentUpload
                    ? 'cursor-wait'
                    : isEditMode
                    ? isSelected
                      ? 'cursor-pointer bg-cosmic-orange/10 border-cosmic-orange/50 hover:bg-cosmic-orange/15'
                      : 'cursor-pointer hover:bg-white/5'
                    : 'cursor-pointer hover:bg-white/10'
                }`}
              >
                {/* Selection checkbox in edit mode */}
                {isEditMode && !isCurrentUpload && (
                  <div className={`absolute top-4 right-4 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    isSelected ? 'bg-cosmic-orange border-cosmic-orange' : 'border-white/30 bg-transparent'
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )}
                <h3 className={`text-body-md text-secondary-white font-medium mb-4 line-clamp-2 ${isEditMode && !isCurrentUpload ? 'pr-8' : ''}`}>
                  {rec.title}
                </h3>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-caption uppercase tracking-wider">
                    {showUploadProgress ? (
                      <>
                        <span className="text-accent-purple">{processingPercent}%</span>
                        {uploadBytesTotal > 0 && (
                          <>
                            <span className="text-medium-gray">•</span>
                            <span className="text-cosmic-orange">
                              {((uploadBytesLoaded || 0) / 1024 / 1024).toFixed(1)} MB / {(uploadBytesTotal / 1024 / 1024).toFixed(1)} MB
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-accent-purple">{formatDuration(rec.duration)}</span>
                        <span className="text-medium-gray">•</span>
                        {rec.status === 'transcribed' ? (
                          <span className="text-cosmic-orange">TRANSCRIBED</span>
                        ) : rec.status === 'generating' ? (
                          <span className="text-cosmic-orange flex items-center gap-1.5">
                            <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            GENERATING
                          </span>
                        ) : (
                          <span className="text-medium-gray">RECORDED</span>
                        )}
                      </>
                    )}
                  </div>
                  
                  <div className="text-caption text-medium-gray uppercase tracking-wider">
                    {new Date(rec.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recording Modal */}
      {showRecordingModal && (
        <RecordingModal
          onClose={() => setShowRecordingModal(false)}
          onSave={handleSaveRecording}
          onDiscard={handleDiscardRecording}
          isRecording={isRecording}
          recordingTime={recordingTime}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          pendingBlob={pendingBlob}
        />
      )}

      {/* Recording Detail Modal */}
      {selectedRecording && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-hidden"
          onClick={() => {
            setSelectedRecording(null)
            setEditingTitle(false)
            setEditedTitle('')
          }}
        >
          <div
            className="glass-container p-4 sm:p-8 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-visible"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with close and delete buttons */}
            <div className="flex items-start justify-between mb-6 flex-shrink-0">
              <div className="flex-1 mr-4">
                {editingTitle ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateRecordingTitle(editedTitle)
                        } else if (e.key === 'Escape') {
                          setEditingTitle(false)
                          setEditedTitle('')
                        }
                      }}
                      className="w-full text-heading-lg bg-white/5 border border-white/10 rounded-glass px-4 py-2 text-secondary-white focus:outline-none focus:border-cosmic-orange transition-colors"
                      autoFocus
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => updateRecordingTitle(editedTitle)}
                        className="btn-primary px-4 py-2 text-body-sm w-full sm:w-auto"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingTitle(false)
                          setEditedTitle('')
                        }}
                        className="btn-secondary px-4 py-2 text-body-sm w-full sm:w-auto"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingTitle(true)
                      setEditedTitle(selectedRecording.title)
                    }}
                    className="group flex items-center gap-2 text-left w-full px-4 py-2 -mx-4 -my-2 rounded-glass hover:bg-white/5 transition-colors"
                  >
                    <h2 className="text-heading-lg text-secondary-white line-clamp-3">
                      {selectedRecording.title}
                    </h2>
                    <svg 
                      className="w-4 h-4 text-medium-gray opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Download button */}
                <button
                  onClick={async () => {
                    try {
                      let url = audioUrl
                      if (!url) {
                        const res = await fetch('/api/recordings/signed-url', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ filePath: selectedRecording.file_path }),
                        })
                        const data = await res.json()
                        url = data.signedUrl
                      }
                      if (!url) return
                      const ext = selectedRecording.file_path.split('.').pop() || 'mp3'
                      const fileName = `${selectedRecording.title.replace(/[^a-z0-9_\-. ]/gi, '_')}.${ext}`
                      const blob = await fetch(url).then((r) => r.blob())
                      const blobUrl = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = blobUrl
                      a.download = fileName
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                      URL.revokeObjectURL(blobUrl)
                    } catch (err) {
                      console.error('Download failed:', err)
                      alert('Failed to download recording')
                    }
                  }}
                  className="text-medium-gray hover:text-secondary-white transition-colors p-1"
                  title="Download recording"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                {/* Delete button */}
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this recording?')) {
                      deleteRecording(selectedRecording.id, selectedRecording.file_path)
                      setSelectedRecording(null)
                      setEditedTranscription(null)
                      setFrozenHighlightIndex(null)
                    }
                  }}
                  className="text-medium-gray hover:text-red-400 transition-colors p-1"
                  title="Delete recording"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                {/* Search button (only shown for transcribed recordings) */}
                {selectedRecording.status === 'transcribed' && selectedRecording.transcription && !isEditingUtterances && editedTranscription === null && (
                  <button
                    onClick={() => {
                      setShowTranscriptSearch(true)
                      setTimeout(() => transcriptSearchInputRef.current?.focus(), 50)
                    }}
                    className="text-medium-gray hover:text-secondary-white transition-colors p-1"
                    title="Search transcript (⌘F)"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                )}
                {/* Close button */}
                <button
                  onClick={() => {
                    setSelectedRecording(null)
                    setEditingTitle(false)
                    setEditedTitle('')
                    setPendingTranscription(null)
                    setEditedTranscription(null)
                    setFrozenHighlightIndex(null)
                    setShowTranscriptSearch(false)
                    setTranscriptSearchQuery('')
                  }}
                  className="text-medium-gray hover:text-secondary-white transition-colors p-1"
                  title="Close"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="mb-6 flex-shrink-0">
              <p className="text-body-sm text-medium-gray">
                {formatDuration(selectedRecording.duration)} • {formatRelativeTime(selectedRecording.created_at)}
              </p>
            </div>

            <div className="mb-4 flex-shrink-0">
              {uploadRecordingId === selectedRecording.id ? (
                <div className="flex flex-col items-center justify-center py-6 bg-white/5 rounded-glass gap-3">
                  <span className="text-body-md text-pale-blue font-medium">{processingPercent}%</span>
                  {uploadBytesTotal > 0 && (
                    <span className="text-body-sm text-medium-gray">
                      {((uploadBytesLoaded || 0) / 1024 / 1024).toFixed(1)} MB / {(uploadBytesTotal / 1024 / 1024).toFixed(1)} MB
                    </span>
                  )}
                  <div className="w-full max-w-xs h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cosmic-orange transition-all duration-300"
                      style={{ width: `${processingPercent}%` }}
                    />
                  </div>
                </div>
              ) : loadingAudio ? (
                <div className="flex items-center justify-center py-4 bg-white/5 rounded-glass">
                  <LoadingSpinner size="sm" />
                  <span className="ml-2 text-body-sm text-medium-gray">Loading audio...</span>
                </div>
              ) : audioUrl ? (
                <AudioPlayer
                  ref={audioPlayerRef}
                  src={audioUrl}
                  onError={() => setAudioUrl(null)}
                  initialDuration={selectedRecording?.duration || 0}
                  onTimeUpdate={(sec) => setCurrentPlaybackTimeMs(sec * 1000)}
                  compact
                />
              ) : (
                <div className="p-4 bg-white/5 rounded-glass text-center">
                  <p className="text-body-sm text-red-400">Failed to load audio. The file may be unavailable.</p>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-0 overflow-visible">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h3 className="text-body-sm text-medium-gray">
                  {transcribePhase === 'identifying_speakers' ? 'Diarization' : 'Transcription'}
                  {transcribePhase !== 'identifying_speakers' &&
                    editedTranscription !== null &&
                    editedTranscription !== selectedRecording.transcription && (
                      <span className="text-cosmic-orange ml-2">(unsaved changes)</span>
                    )}
                  {transcribePhase !== 'identifying_speakers' &&
                    selectedRecording.original_transcription && 
                    selectedRecording.transcription !== selectedRecording.original_transcription &&
                    editedTranscription === null && (
                      <span className="text-medium-gray ml-2">(edited)</span>
                    )}
                </h3>
                <div className="flex items-center gap-3">
                  {/* Speakers button */}
                  {transcribePhase !== 'identifying_speakers' &&
                   selectedRecording.status === 'transcribed' &&
                   displayUtterances.length > 0 &&
                   editedTranscription === null &&
                   !isEditingUtterances && (
                    <button
                      onClick={startSpeakerWalkthrough}
                      className="hidden md:flex text-body-sm text-medium-gray hover:text-secondary-white transition-colors items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Speakers
                    </button>
                  )}

                  {/* Edit button */}
                {transcribePhase !== 'identifying_speakers' &&
                 selectedRecording.status === 'transcribed' &&
                 selectedRecording.transcription && 
                 editedTranscription === null && (
                  <button
                    onClick={() => {
                      // Pause playback when editing so audio doesn't keep running in background
                      audioPlayerRef.current?.pause()
                      setClipPlaying(false)
                      if (displayUtterances.length > 0) {
                        const activeIndex = currentPlaybackTimeMs != null
                          ? displayUtterances.findIndex((u) => currentPlaybackTimeMs >= u.start && currentPlaybackTimeMs <= u.end)
                          : -1
                        setFrozenHighlightIndex(activeIndex >= 0 ? activeIndex : null)
                        setIsEditingUtterances(true)
                        setEditedUtterances(displayUtterances.map((u) => ({ ...u })))
                        setEditedTranscription(null)
                      } else {
                        setFrozenHighlightIndex(null)
                        setIsEditingUtterances(false)
                        setEditedUtterances(null)
                        setEditedTranscription(selectedRecording.transcription || '')
                      }
                    }}
                    className="text-body-sm text-medium-gray hover:text-secondary-white transition-colors flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Edit
                  </button>
                )}
                </div>
              </div>
              {transcribePhase === 'identifying_speakers' ? (
                <div className="flex flex-col flex-1 min-h-0 overflow-auto">
                  <div className="p-4 sm:p-5 bg-white/5 border border-white/10 rounded-glass">
                    <h3 className="text-heading-md text-secondary-white mb-2">Who is this?</h3>
                    <div className="flex flex-col sm:flex-row gap-2 mb-3">
                      <button
                        type="button"
                        onClick={clipPlaying ? pauseCurrentSpeakerClip : () => playCurrentSpeakerClip(currentClipSegment)}
                        className="btn-secondary px-3 py-2 text-body-sm inline-flex items-center justify-center gap-2 w-full sm:w-auto"
                      >
                        {clipPlaying ? (
                          <svg className="w-4 h-4 text-cosmic-orange" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                        Play Speaker {currentSpeakerIndex + 1} of {speakerList.length}
                      </button>

                      {(() => {
                        const currentSpeaker = speakerList[currentSpeakerIndex]
                        const segments = getClearClipSegmentsForSpeaker(currentSpeaker)
                        const canTryAnother = segments.length > 1
                        return (
                          <button
                            type="button"
                            onClick={tryAnotherClip}
                            disabled={!canTryAnother}
                            className="btn-secondary px-3 py-2 text-body-sm inline-flex items-center justify-center gap-2 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Try Clip {currentClipSegment + 1} of {segments.length}
                          </button>
                        )
                      })()}
                    </div>
                    {clipError && (
                      <p className="text-body-sm text-red-400 mb-2">Couldn’t play that clip. Try “Play Speaker” again.</p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-body-sm text-medium-gray mb-2">
                          Name
                        </label>
                        <input
                          type="text"
                          value={speakerName}
                          onChange={(e) => setSpeakerName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleIdentifySpeaker()
                          }}
placeholder="First Last"
                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                        autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-body-sm text-medium-gray mb-2">
                          Position or Title
                        </label>
                        <input
                          type="text"
                          value={speakerPosition}
                          onChange={(e) => setSpeakerPosition(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleIdentifySpeaker()
                          }}
                        placeholder="Council Member"
                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                        />
                      </div>
                    </div>

                    <button
                      onClick={handleIdentifySpeaker}
                      className="btn-primary w-full py-2.5"
                    >
                      {currentSpeakerIndex < speakerList.length - 1 ? 'Next' : 'Confirm'}
                    </button>
                  </div>
                </div>
              ) : selectedRecording.status === 'transcribed' && selectedRecording.transcription ? (
                <div className="flex flex-col flex-1 min-h-0">
                  {/* Same layout in view/edit: transcript box stays the same size */}

                  {/* Transcript Search Bar */}
                  {!isEditingUtterances && editedTranscription === null && (
                    <div className={`flex items-center gap-2 mb-3 transition-all ${showTranscriptSearch ? 'opacity-100' : 'opacity-0 pointer-events-none h-0 mb-0 overflow-hidden'}`}>
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-glass focus-within:border-cosmic-orange/50 transition-colors">
                        <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          ref={transcriptSearchInputRef}
                          type="text"
                          value={transcriptSearchQuery}
                          onChange={(e) => setTranscriptSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              if (transcriptSearchMatchCount > 0) {
                                setTranscriptSearchCurrentMatch((prev) => (prev + 1) % transcriptSearchMatchCount)
                              }
                            }
                            if (e.key === 'Escape') {
                              setShowTranscriptSearch(false)
                              setTranscriptSearchQuery('')
                            }
                          }}
                          placeholder="Search transcript..."
                          className="flex-1 bg-transparent text-secondary-white text-body-sm focus:outline-none placeholder:text-medium-gray/50 min-w-0"
                        />
                        {transcriptSearchQuery && (
                          <span className="text-caption text-medium-gray flex-shrink-0 whitespace-nowrap">
                            {transcriptSearchMatchCount === 0
                              ? 'No matches'
                              : `${transcriptSearchCurrentMatch + 1} / ${transcriptSearchMatchCount}`}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (transcriptSearchMatchCount > 0) {
                            setTranscriptSearchCurrentMatch((prev) => (prev - 1 + transcriptSearchMatchCount) % transcriptSearchMatchCount)
                          }
                        }}
                        disabled={transcriptSearchMatchCount === 0}
                        className="p-2 text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-40"
                        title="Previous match"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          if (transcriptSearchMatchCount > 0) {
                            setTranscriptSearchCurrentMatch((prev) => (prev + 1) % transcriptSearchMatchCount)
                          }
                        }}
                        disabled={transcriptSearchMatchCount === 0}
                        className="p-2 text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-40"
                        title="Next match"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setShowTranscriptSearch(false)
                          setTranscriptSearchQuery('')
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

                  <div
                    ref={transcriptScrollRef}
                    onScroll={() => {
                      setIsUserScrollingTranscript(true)
                      lastScrolledToIndexRef.current = -1
                      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current)
                      scrollEndTimerRef.current = setTimeout(() => {
                        setIsUserScrollingTranscript(false)
                        if (isEditingUtterances || editedTranscription !== null) return
                        if (currentPlaybackTimeMs == null || displayUtterances.length === 0) return
                        const activeIndex = displayUtterances.findIndex(
                          (u) => currentPlaybackTimeMs >= u.start && currentPlaybackTimeMs <= u.end
                        )
                        if (activeIndex >= 0 && utteranceLineRefs.current[activeIndex]) {
                          scrollUtteranceToTopWithGap(activeIndex)
                        }
                      }, 600)
                    }}
                    className="flex-1 min-h-0 px-4 py-3 bg-white/5 border border-white/10 rounded-glass overflow-y-auto"
                  >
                    {displayUtterances.length > 0 ? (
                      <div className="space-y-2">
                        {(() => {
                          const utterancesToShow = isEditingUtterances && editedUtterances ? editedUtterances : displayUtterances
                          let lastMinute = -1
                          return utterancesToShow.map((u, i) => {
                            const startMinute = Math.floor(u.start / 60000)
                            const showMinuteMarker = startMinute > lastMinute
                            if (showMinuteMarker) lastMinute = startMinute
                            const minuteLabel = showMinuteMarker ? formatMinuteLabel(startMinute) : null
                            const displayName = speakerMap[u.speaker]
                              ? (speakerMap[u.speaker].position
                                  ? `${speakerMap[u.speaker].name} (${speakerMap[u.speaker].position})`
                                  : speakerMap[u.speaker].name)
                              : u.speaker
                            const isHighlight = isEditingUtterances
                              ? frozenHighlightIndex !== null && i === frozenHighlightIndex
                              : (currentPlaybackTimeMs != null && currentPlaybackTimeMs >= u.start && currentPlaybackTimeMs <= u.end)
                            const originalText = displayOriginalUtterances?.[i]?.text ?? u.text
                            const currentText = u.text
                            return (
                              <p
                                key={`u-${i}`}
                                ref={(el) => {
                                  utteranceLineRefs.current[i] = el
                                }}
                                onClick={() => {
                                  if (isEditingUtterances) return
                                  if (!audioPlayerRef.current) return
                                  audioPlayerRef.current.currentTime = u.start / 1000
                                  audioPlayerRef.current.play().catch(() => {})
                                }}
                                role={isEditingUtterances ? undefined : 'button'}
                                tabIndex={isEditingUtterances ? undefined : 0}
                                onKeyDown={isEditingUtterances ? undefined : (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    if (!audioPlayerRef.current) return
                                    audioPlayerRef.current.currentTime = u.start / 1000
                                    audioPlayerRef.current.play().catch(() => {})
                                  }
                                }}
                                className={`text-body-md leading-relaxed py-1 px-2 -mx-2 rounded transition-colors ${
                                  isHighlight ? 'bg-cosmic-orange/15 text-cosmic-orange' : 'text-secondary-white ' + (isEditingUtterances ? 'cursor-text' : 'hover:bg-white/5 cursor-pointer')
                                }`}
                              >
                                {minuteLabel && (
                                  <span className="text-medium-gray text-body-md mr-2">{minuteLabel}</span>
                                )}
                                <span className={`font-medium ${isHighlight ? 'text-cosmic-orange/90' : 'text-medium-gray'}`}>{displayName}: </span>
                                {isEditingUtterances && editedUtterances ? (
                                  <textarea
                                    value={currentText}
                                    onChange={(e) => {
                                      const el = e.currentTarget
                                      const value = el.value

                                      // Keep textarea height in sync as user types.
                                      el.style.height = '0px'
                                      el.style.height = `${el.scrollHeight}px`

                                      setEditedUtterances((prev) => {
                                        if (!prev) return prev
                                        if (!prev[i]) return prev
                                        const next = prev.map((x) => ({ ...x }))
                                        next[i].text = value
                                        return next
                                      })
                                    }}
                                    onInput={(e) => {
                                      const el = e.currentTarget
                                      el.style.height = '0px'
                                      el.style.height = `${el.scrollHeight}px`
                                    }}
                                    className="inline-block align-top w-full bg-transparent outline-none resize-none leading-relaxed"
                                    rows={1}
                                  />
                                ) : selectedRecording.original_transcription &&
                                  selectedRecording.transcription !== selectedRecording.original_transcription ? (
                                  <InlineDiff original={originalText} current={currentText} />
                                ) : transcriptSearchQuery.trim() ? (
                                  renderWithSearchHighlights(currentText, transcriptSearchQuery, transcriptSearchMatchOffsets[i] ?? 0, transcriptSearchCurrentMatch)
                                ) : (
                                  currentText
                                )}
                              </p>
                            )
                          })
                        })()}
                      </div>
                    ) : (
                      editedTranscription !== null ? (
                        <textarea
                          value={editedTranscription}
                          onChange={(e) => setEditedTranscription(e.target.value)}
                          className="w-full h-full min-h-[150px] bg-transparent text-secondary-white text-body-md focus:outline-none resize-none leading-relaxed"
                        />
                      ) : transcriptSearchQuery.trim() ? (
                        <p className="text-body-md text-secondary-white leading-relaxed whitespace-pre-wrap">
                          {renderWithSearchHighlights(selectedRecording.transcription ?? '', transcriptSearchQuery, 0, transcriptSearchCurrentMatch)}
                        </p>
                      ) : (
                        <p className="text-body-md text-secondary-white leading-relaxed whitespace-pre-wrap">
                          {formatTranscriptionWithStyledMinuteMarkers(selectedRecording.transcription)}
                        </p>
                      )
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-4 flex-shrink-0 flex flex-col sm:flex-row gap-3">
                    {isEditingUtterances || editedTranscription !== null ? (
                      <>
                        <button
                          onClick={() => {
                            setIsEditingUtterances(false)
                            setEditedUtterances(null)
                            setEditedTranscription(null)
                            setFrozenHighlightIndex(null)
                          }}
                          className="btn-secondary flex-1 py-3"
                          disabled={savingTranscription}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveEditedTranscription}
                          className="btn-primary flex-1 py-3 disabled:opacity-50"
                          disabled={savingTranscription}
                        >
                          {savingTranscription ? 'Saving...' : 'Save Changes'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setSelectedRecording(null)}
                          disabled={generatingProject}
                          className="flex-1 w-full sm:w-auto px-4 py-3 flex items-center justify-center gap-2 text-body-sm rounded-glass btn-secondary"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Save & Close
                        </button>
                        <button
                          onClick={handleCreateProjectAndArticle}
                          disabled={generatingProject}
                          className={`flex-1 w-full sm:w-auto px-4 py-3 flex items-center justify-center gap-2 text-body-sm rounded-glass ${
                            generatingProject
                              ? 'btn-primary opacity-50 cursor-not-allowed'
                              : 'btn-primary'
                          }`}
                        >
                          {generatingProject ? (
                            <>
                              <svg className="w-5 h-5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              {CREATE_PROJECT_STATUS_MESSAGES[generatingStatusIndex]}…
                            </>
                          ) : hasReachedProjectLimit ? (
                            <>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                              </svg>
                              Upgrade to Increase Project Limit
                            </>
                          ) : (
                            <>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              Create Project & Article
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : pendingTranscription ? (
                <div className="flex flex-col flex-1 min-h-0">
                  <textarea
                    value={pendingTranscription}
                    onChange={(e) => setPendingTranscription(e.target.value)}
                    className="flex-1 min-h-[150px] px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors resize-none leading-relaxed overflow-y-auto"
                  />
                </div>
              ) : (transcribing || selectedRecording.status === 'generating') ? (
                <div className="p-4 bg-white/5 rounded-glass text-center">
                  <div className="flex items-center justify-center gap-3">
                    <svg className="w-5 h-5 text-cosmic-orange animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-body-md text-secondary-white">Generating transcription...</span>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-white/5 rounded-glass text-center">
                  <p className="text-body-sm text-medium-gray mb-4">No transcription yet</p>
                  <button
                    onClick={() => transcribeRecording(selectedRecording)}
                    className="btn-primary px-6 py-3"
                  >
                    Generate Transcription
                  </button>
                </div>
              )}
            </div>

            {/* Action buttons - only show when there's a pending action */}
            {pendingTranscription && (
              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-white/10 flex-shrink-0">
                <button
                  onClick={saveTranscription}
                  className="btn-primary flex-1 w-full sm:w-auto py-3"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
