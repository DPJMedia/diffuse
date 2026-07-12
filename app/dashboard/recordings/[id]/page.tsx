'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  formatRelativeTime,
  formatDuration,
  recordingDisplayTimestamp,
  effectiveRecordingDurationSeconds,
  formatTimestampFromMs,
} from '@/lib/utils/format'
import { useAuth } from '@/contexts/AuthContext'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import AudioPlayer from '@/components/dashboard/AudioPlayer'
import { ConfirmModal } from '@/components/dashboard/ConfirmModal'
import { getSpeakerLabel, buildUtteranceTranscriptCopy } from '@/lib/utils/speaker-label'
import { highlightSearch } from '@/lib/utils/transcriptSearchHighlight'

const RecordingTranscriptDiff = dynamic(() => import('@/components/dashboard/RecordingTranscriptDiff'), {
  ssr: false,
  loading: () => <p className="text-body-sm text-medium-gray">Loading comparison…</p>,
})

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
  detected_speaker_names?: Record<string, string> | null
  utterances?: Array<{ speaker: string; text: string; start: number; end: number }> | null
  original_utterances?: Array<{ speaker: string; text: string; start: number; end: number }> | null
  status: RecordingStatus
  recorded_at?: string | null
  created_at: string
}

/** True when the saved label is still the generic "Speaker N" placeholder (not a real identified name). */
function isDefaultSpeakerPlaceholderName(name: string): boolean {
  return /^Speaker\s+\d+$/i.test(name.trim())
}

/**
 * Count speakers with a real name: user-confirmed in speaker_map, or auto-detected in transcript.
 * Each speaker counts at most once.
 */
function getIdentifySpeakersProgress(
  utterances: Array<{ speaker: string }> | null | undefined,
  speakerMap: Recording['speaker_map'],
  detectedNames: Recording['detected_speaker_names']
): { identified: number; total: number } {
  const uniqueSpeakers = [...new Set((utterances || []).map((u) => u.speaker))]
  const total = uniqueSpeakers.length
  let identified = 0
  for (const sp of uniqueSpeakers) {
    const mapped = speakerMap?.[sp]
    if (mapped?.name?.trim() && !isDefaultSpeakerPlaceholderName(mapped.name)) {
      identified++
      continue
    }
    if (detectedNames?.[sp]?.trim()) {
      identified++
    }
  }
  return { identified, total }
}

/**
 * Once a speaker is saved in speaker_map, drop their API auto-detect so user edits are the only source of truth.
 * After the full Identify flow, this typically clears detected_speaker_names entirely.
 */
function stripDetectedNamesForConfirmedSpeakers(
  detected: Record<string, string> | null | undefined,
  speakerMap: Record<string, { name: string; position?: string }>
): Record<string, string> | null {
  if (!detected || Object.keys(detected).length === 0) return null
  const next: Record<string, string> = { ...detected }
  for (const sp of Object.keys(speakerMap)) {
    delete next[sp]
  }
  return Object.keys(next).length > 0 ? next : null
}

export default function RecordingDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const recordingId = params?.id as string

  const [recording, setRecording] = useState<Recording | null>(null)
  const [loading, setLoading] = useState(true)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loadingAudio, setLoadingAudio] = useState(false)
  /** Set when there is no real file (e.g. failed URL pull) so we don't blame "Supabase" generically. */
  const [audioUnavailableReason, setAudioUnavailableReason] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [editedTranscription, setEditedTranscription] = useState<string | null>(null)
  const [editedUtterances, setEditedUtterances] = useState<Array<{ speaker: string; text: string; start: number; end: number }> | null>(null)
  const [isEditingUtterances, setIsEditingUtterances] = useState(false)
  const [savingTranscription, setSavingTranscription] = useState(false)
  const [currentPlaybackTimeMs, setCurrentPlaybackTimeMs] = useState<number | null>(null)
  const [frozenHighlightIndex, setFrozenHighlightIndex] = useState<number | null>(null)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  
  // Transcript search state
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState('')
  const [transcriptSearchCurrentMatch, setTranscriptSearchCurrentMatch] = useState(0)
  const [transcriptSearchMatchCount, setTranscriptSearchMatchCount] = useState(0)
  const [replaceText, setReplaceText] = useState('')
  const transcriptSearchInputRef = useRef<HTMLInputElement>(null)

  // Collapsible sections state
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showEditDetailsModal, setShowEditDetailsModal] = useState(false)
  const [showDeleteRecordingConfirm, setShowDeleteRecordingConfirm] = useState(false)
  
  // Active mode state - only one can be active at a time
  type ActiveMode = 'view' | 'search' | 'speakers' | 'edit'
  const [activeMode, setActiveMode] = useState<ActiveMode>('view')
  
  // Speaker identification state
  const [speakerList, setSpeakerList] = useState<string[]>([])
  const [currentSpeakerIndex, setCurrentSpeakerIndex] = useState(0)
  const [speakerName, setSpeakerName] = useState('')
  const [speakerPosition, setSpeakerPosition] = useState('')
  const [clipPlaying, setClipPlaying] = useState(false)
  const [clipError, setClipError] = useState(false)
  const [currentClipSegment, setCurrentClipSegment] = useState(0)
  // Tears down the "Play Sample" bound (clip-end stop + transport-takeover listeners) so a
  // sample only ever stops itself, never the main play button.
  const clipTeardownRef = useRef<(() => void) | null>(null)

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const utteranceLineRefs = useRef<(HTMLParagraphElement | null)[]>([])

  // Keep the audio element in sync with the selected playback speed.
  useEffect(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])
  
  // User scroll override state
  const [userScrollOverride, setUserScrollOverride] = useState(false)
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isAutoScrollingRef = useRef(false)
  
  const supabase = createClient()

  // Fetch recording data
  const fetchRecording = useCallback(async () => {
    if (!recordingId) return
    
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('diffuse_recordings')
        .select('*')
        .eq('id', recordingId)
        .single()

      if (error || !data) {
        console.error('Error fetching recording:', error)
        router.push('/dashboard/recordings')
        return
      }

      setRecording(data)
      setEditedTitle(data.title)
      setAudioUnavailableReason(null)
      setAudioUrl(null)

      // Load audio (Swagit / uploads only — never touches Cobalt; Cobalt is YouTube-only on the server.)
      setLoadingAudio(true)
      try {
        if (typeof data.file_path === 'string' && data.file_path.includes('/pending-pull-')) {
          setAudioUnavailableReason(
            'This row was created for a URL pull that never finished, so no audio was saved. Delete it and run Pull again (or use a recording that completed successfully).'
          )
          return
        }

        const res = await fetch('/api/recordings/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: data.file_path }),
        })
        const audioData = (await res.json()) as {
          signedUrl?: string
          error?: string
          code?: string
        }
        if (audioData.signedUrl) {
          setAudioUrl(audioData.signedUrl)
        } else {
          console.error('No signed URL received', audioData.code, audioData.error)
          setAudioUnavailableReason(
            audioData.error ||
              (res.status === 404 || res.status === 422
                ? 'No audio file in storage for this recording.'
                : 'Could not load audio.')
          )
        }
      } catch (audioError) {
        console.error('Error loading audio:', audioError)
        setAudioUnavailableReason('Could not load audio.')
      } finally {
        setLoadingAudio(false)
      }
    } catch (error) {
      console.error('Error:', error)
      setLoadingAudio(false)
    } finally {
      setLoading(false)
    }
  }, [recordingId, router, supabase])

  useEffect(() => {
    if (recordingId && user?.id) {
      fetchRecording()
    }
    // Depend on user?.id, not the user object: Supabase hands out a new user object on every
    // token refresh / tab-focus event, and depending on the object would refetch the recording
    // and reload the audio mid-playback.
  }, [recordingId, user?.id, fetchRecording])

  // Re-mint a signed URL for the open recording so the player can recover if the current one expires mid-session.
  const refreshAudioUrl = useCallback(async (): Promise<string | null> => {
    const filePath = recording?.file_path
    if (!filePath || filePath.includes('/pending-pull-')) return null
    try {
      const res = await fetch('/api/recordings/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      })
      const audioData = (await res.json()) as { signedUrl?: string }
      return audioData.signedUrl ?? null
    } catch {
      return null
    }
  }, [recording?.file_path])

  // Search transcript functionality
  useEffect(() => {
    if (!transcriptSearchQuery) {
      setTranscriptSearchMatchCount(0)
      setTranscriptSearchCurrentMatch(0)
      return
    }
    
    // Determine which utterances to search in
    const utterancesToSearch = isEditingUtterances && editedUtterances ? editedUtterances : (recording?.utterances || [])
    
    // If we have utterances, search in the utterance text only (not the formatted transcription)
    if (utterancesToSearch.length > 0) {
      const regex = new RegExp(transcriptSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      let totalMatches = 0
      for (const utterance of utterancesToSearch) {
        const matches = Array.from(utterance.text.matchAll(regex))
        totalMatches += matches.length
      }
      setTranscriptSearchMatchCount(totalMatches)
      setTranscriptSearchCurrentMatch(0)
    } else if (recording?.transcription) {
      // Fall back to searching the full transcription if no utterances
      const regex = new RegExp(transcriptSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const matches = Array.from(recording.transcription.matchAll(regex))
      setTranscriptSearchMatchCount(matches.length)
      setTranscriptSearchCurrentMatch(0)
    } else {
      setTranscriptSearchMatchCount(0)
      setTranscriptSearchCurrentMatch(0)
    }
  }, [transcriptSearchQuery, recording?.transcription, recording?.utterances, isEditingUtterances, editedUtterances])

  // Scroll to current match
  useEffect(() => {
    if (transcriptSearchMatchCount === 0 || activeMode !== 'search') return
    setTimeout(() => {
      const el = document.querySelector(`[data-search-match="${transcriptSearchCurrentMatch}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }, [transcriptSearchCurrentMatch, transcriptSearchMatchCount, activeMode])

  // Listen for user manual scroll to override auto-scroll temporarily
  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) return

    const handleUserScroll = () => {
      // Only override if not currently auto-scrolling and audio is playing
      if (!isAutoScrollingRef.current && audioPlayerRef.current && !audioPlayerRef.current.paused) {
        setUserScrollOverride(true)
        
        // Clear existing timeout
        if (userScrollTimeoutRef.current) {
          clearTimeout(userScrollTimeoutRef.current)
        }
        
        // Resume auto-scroll after 3 seconds of no scrolling
        userScrollTimeoutRef.current = setTimeout(() => {
          setUserScrollOverride(false)
        }, 3000)
      }
    }

    container.addEventListener('scroll', handleUserScroll, { passive: true })
    
    return () => {
      container.removeEventListener('scroll', handleUserScroll)
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
    }
  }, [])

  // Auto-scroll to current utterance during playback
  useEffect(() => {
    const utterances = isEditingUtterances && editedUtterances ? editedUtterances : (recording?.utterances || [])
    
    // Don't auto-scroll if:
    // - No playback time
    // - No utterances
    // - Highlight is frozen (edit mode)
    // - Audio is paused
    // - User has manually scrolled (override active)
    const isPaused = !audioPlayerRef.current || audioPlayerRef.current.paused
    if (currentPlaybackTimeMs === null || utterances.length === 0 || frozenHighlightIndex !== null || isPaused || userScrollOverride) return
    
    const currentIndex = utterances.findIndex((u) => 
      currentPlaybackTimeMs >= u.start && currentPlaybackTimeMs <= u.end
    )
    
    if (currentIndex >= 0 && currentIndex !== frozenHighlightIndex) {
      const element = utteranceLineRefs.current[currentIndex]
      const container = transcriptScrollRef.current
      if (element && container) {
        // Set flag to indicate we're auto-scrolling
        isAutoScrollingRef.current = true
        
        // Calculate scroll position to align with proper spacing
        // space-y-3 = 0.75rem = 12px gap between boxes
        const scrollOffset = 12 // Match the space-y-3 gap
        container.scrollTo({
          top: element.offsetTop - scrollOffset,
          behavior: 'smooth'
        })
        
        // Clear the auto-scrolling flag after animation completes
        setTimeout(() => {
          isAutoScrollingRef.current = false
        }, 500) // Smooth scroll animation takes ~300-500ms
      }
    }
  }, [currentPlaybackTimeMs, isEditingUtterances, editedUtterances, recording?.utterances, frozenHighlightIndex, userScrollOverride])

  // Clear user scroll override when audio is paused
  useEffect(() => {
    const handlePlayPause = () => {
      if (audioPlayerRef.current?.paused) {
        setUserScrollOverride(false)
        if (userScrollTimeoutRef.current) {
          clearTimeout(userScrollTimeoutRef.current)
          userScrollTimeoutRef.current = null
        }
      }
    }

    const audio = audioPlayerRef.current
    if (audio) {
      audio.addEventListener('pause', handlePlayPause)
      audio.addEventListener('play', handlePlayPause)

      return () => {
        audio.removeEventListener('pause', handlePlayPause)
        audio.removeEventListener('play', handlePlayPause)
      }
    }
  }, [audioUrl, recording?.id])

  const handleUpdateTitle = async () => {
    if (!recording || !editedTitle.trim()) return
    
    try {
      const { error } = await supabase
        .from('diffuse_recordings')
        .update({ title: editedTitle.trim() })
        .eq('id', recording.id)

      if (error) throw error

      setRecording({ ...recording, title: editedTitle.trim() })
      setEditingTitle(false)
    } catch (error) {
      console.error('Error updating title:', error)
    }
  }

  const handleSaveTranscription = async () => {
    if (!recording) return
    
    setSavingTranscription(true)
    try {
      let finalTranscription: string
      let finalUtterances: Array<{ speaker: string; text: string; start: number; end: number }> | null = null

      if (isEditingUtterances && editedUtterances) {
        finalUtterances = editedUtterances
        const enrichedParts: string[] = []
        for (const u of editedUtterances) {
          const speakerInfo = recording.speaker_map?.[u.speaker]
          const label = speakerInfo
            ? speakerInfo.position
              ? `${speakerInfo.name} (${speakerInfo.position})`
              : speakerInfo.name
            : u.speaker
          enrichedParts.push(`**${label}**: ${u.text}`)
        }
        finalTranscription = enrichedParts.join('\n\n')
      } else if (editedTranscription !== null) {
        finalTranscription = editedTranscription
      } else {
        return
      }

      const { error } = await supabase
        .from('diffuse_recordings')
        .update({
          transcription: finalTranscription,
          ...(finalUtterances ? { utterances: finalUtterances } : {}),
        })
        .eq('id', recording.id)

      if (error) throw error

      setRecording({
        ...recording,
        transcription: finalTranscription,
        ...(finalUtterances ? { utterances: finalUtterances } : {}),
      })
      setEditedTranscription(null)
      setEditedUtterances(null)
      setIsEditingUtterances(false)
      setFrozenHighlightIndex(null)
    } catch (error) {
      console.error('Error saving transcription:', error)
    } finally {
      setSavingTranscription(false)
    }
  }

  const handleReplaceOne = async () => {
    if (!recording || !transcriptSearchQuery || transcriptSearchMatchCount === 0) return
    
    // Determine which utterances to work with
    const utterancesToSearch = isEditingUtterances && editedUtterances ? editedUtterances : (recording?.utterances || [])
    
    // If we have utterances, we need to replace in the utterances, not the formatted transcription
    if (utterancesToSearch.length > 0) {
      const regex = new RegExp(transcriptSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      let currentMatchIndex = 0
      let replaced = false
      let replacedUtteranceIndex = -1
      
      const newUtterances = utterancesToSearch.map((utterance, index) => {
        if (replaced) return utterance
        
        const matches = Array.from(utterance.text.matchAll(regex))
        if (matches.length === 0) return utterance
        
        // Check if the current match is in this utterance
        if (currentMatchIndex + matches.length > transcriptSearchCurrentMatch) {
          // The match we want is in this utterance
          const localMatchIndex = transcriptSearchCurrentMatch - currentMatchIndex
          const match = matches[localMatchIndex]
          const before = utterance.text.slice(0, match.index)
          const after = utterance.text.slice((match.index || 0) + match[0].length)
          const newText = before + replaceText + after
          replaced = true
          replacedUtteranceIndex = index
          return { ...utterance, text: newText }
        }
        
        currentMatchIndex += matches.length
        return utterance
      })
      
      if (replaced) {
        try {
          const { error } = await supabase
            .from('diffuse_recordings')
            .update({ utterances: newUtterances })
            .eq('id', recording.id)
          
          if (error) throw error
          
          setRecording({ ...recording, utterances: newUtterances })
          
          // Scroll to the replaced utterance
          if (replacedUtteranceIndex >= 0) {
            setTimeout(() => {
              const element = utteranceLineRefs.current[replacedUtteranceIndex]
              const container = transcriptScrollRef.current
              if (element && container) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }, 100)
          }
        } catch (error) {
          console.error('Error replacing text:', error)
          alert('Failed to replace text')
        }
      }
    } else {
      // Original logic for plain transcription
      const currentTranscript = recording.transcription || ''
      const regex = new RegExp(transcriptSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const matches = Array.from(currentTranscript.matchAll(regex))
      
      if (matches.length === 0 || !matches[transcriptSearchCurrentMatch]) return
      
      const match = matches[transcriptSearchCurrentMatch]
      const before = currentTranscript.slice(0, match.index)
      const after = currentTranscript.slice((match.index || 0) + match[0].length)
      const newTranscript = before + replaceText + after
      
      try {
        const { error } = await supabase
          .from('diffuse_recordings')
          .update({ transcription: newTranscript })
          .eq('id', recording.id)
        
        if (error) throw error
        
        setRecording({ ...recording, transcription: newTranscript })
        
        // Scroll to top of transcript for plain text view
        setTimeout(() => {
          const container = transcriptScrollRef.current
          if (container) {
            container.scrollTo({ top: 0, behavior: 'smooth' })
          }
        }, 100)
      } catch (error) {
        console.error('Error replacing text:', error)
        alert('Failed to replace text')
      }
    }
  }

  const handleReplaceAll = async () => {
    if (!recording || !transcriptSearchQuery || transcriptSearchMatchCount === 0) return
    
    // Determine which utterances to work with
    const utterancesToSearch = isEditingUtterances && editedUtterances ? editedUtterances : (recording?.utterances || [])
    
    // If we have utterances, replace in all utterances
    if (utterancesToSearch.length > 0) {
      const regex = new RegExp(transcriptSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      let firstReplacedIndex = -1
      
      const newUtterances = utterancesToSearch.map((utterance, index) => {
        const hasMatch = regex.test(utterance.text)
        if (hasMatch && firstReplacedIndex === -1) {
          firstReplacedIndex = index
        }
        // Reset regex lastIndex after test
        regex.lastIndex = 0
        const newText = utterance.text.replace(regex, replaceText)
        return { ...utterance, text: newText }
      })
      
      try {
        const { error } = await supabase
          .from('diffuse_recordings')
          .update({ utterances: newUtterances })
          .eq('id', recording.id)
        
        if (error) throw error
        
        setRecording({ ...recording, utterances: newUtterances })
        
        // Scroll to the first replaced utterance
        if (firstReplacedIndex >= 0) {
          setTimeout(() => {
            const element = utteranceLineRefs.current[firstReplacedIndex]
            const container = transcriptScrollRef.current
            if (element && container) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, 100)
        }
      } catch (error) {
        console.error('Error replacing text:', error)
        alert('Failed to replace text')
      }
    } else {
      // Original logic for plain transcription
      const currentTranscript = recording.transcription || ''
      const regex = new RegExp(transcriptSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const newTranscript = currentTranscript.replace(regex, replaceText)
      
      try {
        const { error } = await supabase
          .from('diffuse_recordings')
          .update({ transcription: newTranscript })
          .eq('id', recording.id)
        
        if (error) throw error
        
        setRecording({ ...recording, transcription: newTranscript })
        
        // Scroll to top of transcript for plain text view
        setTimeout(() => {
          const container = transcriptScrollRef.current
          if (container) {
            container.scrollTo({ top: 0, behavior: 'smooth' })
          }
        }, 100)
      } catch (error) {
        console.error('Error replacing text:', error)
        alert('Failed to replace text')
      }
    }
  }

  const handleDeleteRecording = async () => {
    if (!recording) return

    try {
      const { error: storageError } = await supabase.storage
        .from('diffuse-recordings')
        .remove([recording.file_path])

      if (storageError) console.error('Storage delete error:', storageError)

      const { error: dbError } = await supabase
        .from('diffuse_recordings')
        .delete()
        .eq('id', recording.id)

      if (dbError) throw dbError

      router.push('/dashboard/recordings')
    } catch (error) {
      console.error('Error deleting recording:', error)
      alert('Failed to delete recording')
    }
  }

  const handleDownload = async () => {
    if (!recording) return
    
    try {
      let url = audioUrl
      if (!url) {
        const res = await fetch('/api/recordings/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: recording.file_path }),
        })
        const data = await res.json()
        url = data.signedUrl
      }
      if (!url) return
      
      const ext = recording.file_path.split('.').pop() || 'mp3'
      const fileName = `${recording.title.replace(/[^a-z0-9_\-. ]/gi, '_')}.${ext}`
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
  }

  // Speaker identification helper functions
  const getClearClipSegmentsForSpeaker = (speaker: string) => {
    if (!recording?.utterances) return []
    
    const speakerUtterances = recording.utterances.filter((u) => u.speaker === speaker)
    if (speakerUtterances.length === 0) return []
    
    // Filter for clear utterances (minimum 5 words and 2 seconds)
    const MIN_WORDS = 5
    const MIN_DURATION_MS = 2000
    const FILLER_ONLY = /^(um+|uh+|ah+|oh+|hmm+|mhm+|yeah+|yep+|nope+|okay+|ok+|right+|so+|well+|like+|you know+|i mean+)\s*$/i
    
    const clear = speakerUtterances.filter((u) => {
      const durationMs = u.end - u.start
      const words = u.text.trim().split(/\s+/)
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

  const playCurrentSpeakerClip = (segmentIndex: number = currentClipSegment) => {
    setClipError(false)
    if (!audioUrl || !recording?.utterances || currentSpeakerIndex >= speakerList.length || !audioPlayerRef.current) {
      // Don't set error immediately - audio might still be loading
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
      // Drop any previous sample bound before starting a new one.
      clipTeardownRef.current?.()
      clipTeardownRef.current = null
      audio.currentTime = startTimeSec
      setClipPlaying(true)
      setClipError(false)

      const endTimeSec = startTimeSec + clipDuration
      const playPromise = audio.play()

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // A sample is only bounded while it plays uninterrupted. If the user takes over
            // the transport — hits the main play/pause button (fires 'pause') or scrubs the
            // progress bar (fires 'seeking') — release the bound so the main play button
            // plays the whole recording from wherever it is instead of stopping at the clip.
            const teardown = () => {
              audio.removeEventListener('timeupdate', stopAtClipEnd)
              audio.removeEventListener('pause', releaseBound)
              audio.removeEventListener('seeking', releaseBound)
              if (clipTeardownRef.current === teardown) clipTeardownRef.current = null
            }
            const stopAtClipEnd = () => {
              if (audio.currentTime >= endTimeSec) {
                audio.pause()
                setClipPlaying(false)
                teardown()
              }
            }
            const releaseBound = () => {
              setClipPlaying(false)
              teardown()
            }
            clipTeardownRef.current = teardown
            audio.addEventListener('timeupdate', stopAtClipEnd)
            audio.addEventListener('pause', releaseBound)
            audio.addEventListener('seeking', releaseBound)
          })
          .catch((error) => {
            console.warn('Autoplay failed:', error)
            setClipPlaying(false)
            // Only set error if it's not a user interaction issue
            if (error.name !== 'NotAllowedError') {
              setClipError(true)
            }
            clipTeardownRef.current?.()
            clipTeardownRef.current = null
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
      clipTeardownRef.current?.()
      clipTeardownRef.current = null
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
    if (!recording) return
    
    const currentSpeaker = speakerList[currentSpeakerIndex]
    const defaultName = getSpeakerLabel(currentSpeaker, null, recording.detected_speaker_names)
    const finalName = speakerName.trim() || defaultName
    
    const newSpeakerMap = {
      ...(recording.speaker_map || {}),
      [currentSpeaker]: {
        name: finalName,
        position: speakerPosition.trim() || undefined,
      },
    }
    
    if (currentSpeakerIndex < speakerList.length - 1) {
      // Move to next speaker
      pauseCurrentSpeakerClip()
      const nextIndex = currentSpeakerIndex + 1
      const nextSpeaker = speakerList[nextIndex]
      const existing = newSpeakerMap[nextSpeaker]
      
      setCurrentSpeakerIndex(nextIndex)
      
      // Priority order: 1) existing speaker_map, 2) detected_speaker_names, 3) empty
      let nextName = ''
      if (existing?.name && !existing.name.startsWith('Speaker ')) {
        nextName = existing.name
      } else if (recording.detected_speaker_names?.[nextSpeaker]) {
        nextName = recording.detected_speaker_names[nextSpeaker]
      }
      
      setSpeakerName(nextName)
      setSpeakerPosition(existing?.position || '')
      setClipError(false)
      setCurrentClipSegment(0)
      
      // Update recording with current progress; API auto-detects for confirmed speakers are removed
      const nextDetected = stripDetectedNamesForConfirmedSpeakers(recording.detected_speaker_names, newSpeakerMap)
      try {
        await supabase
          .from('diffuse_recordings')
          .update({ speaker_map: newSpeakerMap, detected_speaker_names: nextDetected })
          .eq('id', recording.id)
        
        setRecording({ ...recording, speaker_map: newSpeakerMap, detected_speaker_names: nextDetected })
      } catch (err) {
        console.error('Error saving speaker map:', err)
      }
      
      // Auto-play next speaker's clip with check for audio readiness
      setTimeout(() => {
        if (audioUrl && audioPlayerRef.current) {
          playCurrentSpeakerClip(0)
        }
      }, 200)
    } else {
      // Save final speaker map and close; user-confirmed names replace API suggestions
      pauseCurrentSpeakerClip()
      const nextDetected = stripDetectedNamesForConfirmedSpeakers(recording.detected_speaker_names, newSpeakerMap)
      try {
        await supabase
          .from('diffuse_recordings')
          .update({ speaker_map: newSpeakerMap, detected_speaker_names: nextDetected })
          .eq('id', recording.id)
        
        setRecording({ ...recording, speaker_map: newSpeakerMap, detected_speaker_names: nextDetected })
        setActiveMode('view')
        setSpeakerList([])
        setCurrentSpeakerIndex(0)
        setSpeakerName('')
        setSpeakerPosition('')
        setClipError(false)
        setCurrentClipSegment(0)
      } catch (err) {
        console.error('Error saving speaker map:', err)
        alert('Failed to save speaker information')
      }
    }
  }

  const startSpeakerIdentification = () => {
    if (!recording?.utterances || recording.utterances.length === 0) return
    
    // Get unique speakers in alphabetical order
    const uniqueSpeakers: string[] = []
    for (const u of recording.utterances) {
      if (!uniqueSpeakers.includes(u.speaker)) {
        uniqueSpeakers.push(u.speaker)
      }
    }
    uniqueSpeakers.sort((a, b) => a.localeCompare(b))
    
    if (uniqueSpeakers.length === 0) return
    
    // Initialize speaker identification flow
    pauseCurrentSpeakerClip()
    audioPlayerRef.current?.pause()
    
    setSpeakerList(uniqueSpeakers)
    setCurrentSpeakerIndex(0)
    
    // Check if there's already a mapping for the first speaker
    const firstSpeaker = uniqueSpeakers[0]
    const existing = recording.speaker_map?.[firstSpeaker]
    
    // Priority order: 1) existing speaker_map, 2) detected_speaker_names, 3) empty
    let initialName = ''
    if (existing?.name && !existing.name.startsWith('Speaker ')) {
      initialName = existing.name
    } else if (recording.detected_speaker_names?.[firstSpeaker]) {
      initialName = recording.detected_speaker_names[firstSpeaker]
    }
    
    setSpeakerName(initialName)
    setSpeakerPosition(existing?.position || '')
    
    setClipError(false)
    setCurrentClipSegment(0)
    setActiveMode('speakers')
    
    // Auto-play first speaker's clip - wait longer and check if audio is ready
    setTimeout(() => {
      if (audioUrl && audioPlayerRef.current) {
        playCurrentSpeakerClip(0)
      }
    }, 300)
  }

  const displayUtterances = isEditingUtterances && editedUtterances ? editedUtterances : (recording?.utterances || [])
  // All speaker ids available to reassign a clip to (from diarization + any named speakers).
  const availableSpeakers = (() => {
    const set = new Set<string>()
    for (const u of (recording?.utterances || [])) set.add(u.speaker)
    for (const k of Object.keys(recording?.speaker_map || {})) set.add(k)
    return [...set].sort()
  })()
  const displayTranscription = editedTranscription !== null ? editedTranscription : (recording?.transcription || '')

  const handleCopyFullTranscript = async () => {
    if (!recording) return
    const text = buildUtteranceTranscriptCopy(
      displayUtterances,
      recording.speaker_map,
      recording.detected_speaker_names,
      recording.transcription
    )
    if (!text.trim()) {
      alert('Nothing to copy yet.')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      alert('Could not copy to clipboard.')
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        {/* Header */}
        <div className="mb-6">
          <div className="h-4 w-36 bg-white/10 rounded mb-4" />
          <div className="h-8 w-80 max-w-[80%] bg-white/10 rounded mb-2" />
          <div className="h-4 w-72 max-w-[70%] bg-white/10 rounded" />
        </div>

        {/* Two-column layout */}
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* Left column */}
          <div className="flex-1 min-w-0 flex flex-col gap-4 h-[calc(100vh-200px)]">
            {/* Audio player card */}
            <div className="glass-container bg-dark-gray/95 backdrop-blur-glass p-5 flex-shrink-0">
              <div className="h-10 w-full bg-white/10 rounded" />
            </div>

            {/* Transcript card */}
            <div className="glass-container bg-dark-gray/95 backdrop-blur-glass p-5 flex-1 min-h-0">
              <div className="flex items-center justify-between mb-4">
                <div className="h-5 w-44 bg-white/10 rounded" />
                <div className="h-5 w-28 bg-white/10 rounded" />
              </div>
              <div className="space-y-3">
                <div className="h-4 w-[92%] bg-white/10 rounded" />
                <div className="h-4 w-[88%] bg-white/10 rounded" />
                <div className="h-4 w-[84%] bg-white/10 rounded" />
                <div className="h-4 w-[90%] bg-white/10 rounded" />
                <div className="h-4 w-[76%] bg-white/10 rounded" />
                <div className="h-4 w-[86%] bg-white/10 rounded" />
              </div>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 glass-container bg-dark-gray/95 backdrop-blur-glass overflow-hidden">
            {/* Actions header */}
            <div className="border-b border-white/10 px-4 py-3">
              <div className="h-5 w-20 bg-white/10 rounded" />
            </div>

            {/* Action rows */}
            <div className="px-4 py-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 w-full bg-white/10 rounded" />
              ))}
            </div>

            {/* Settings header */}
            <div className="border-t border-white/10 px-4 py-3">
              <div className="h-5 w-24 bg-white/10 rounded" />
            </div>
            <div className="px-4 pb-4 space-y-2">
              <div className="h-10 w-full bg-white/10 rounded" />
              <div className="h-10 w-full bg-white/10 rounded" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!recording) return null

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/dashboard/recordings')}
          className="inline-flex items-center gap-1.5 text-medium-gray hover:text-secondary-white transition-colors text-body-sm mb-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Recordings
        </button>
        
        <h1 className="text-heading-lg text-secondary-white">
          {recording.title}
        </h1>
        
        <p className="text-body-sm text-medium-gray mt-2">
          {formatDuration(effectiveRecordingDurationSeconds(recording))} •{' '}
          {formatRelativeTime(recordingDisplayTimestamp(recording))}
        </p>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left: Audio and Transcription */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 h-[calc(100vh-200px)]">
          {/* Audio Player */}
          <div className="glass-container bg-dark-gray/95 backdrop-blur-glass p-5 flex-shrink-0">
            {loadingAudio ? (
              <div className="flex items-center justify-center py-4">
                <LoadingSpinner size="sm" />
                <span className="ml-2 text-body-sm text-medium-gray">Loading audio...</span>
              </div>
            ) : audioUrl ? (
              <AudioPlayer
                ref={audioPlayerRef}
                src={audioUrl}
                refreshSrc={refreshAudioUrl}
                onError={() => {
                  setAudioUrl(null)
                  setAudioUnavailableReason('Playback failed — the signed link may have expired. Refresh the page or download again.')
                }}
                initialDuration={effectiveRecordingDurationSeconds(recording)}
                onTimeUpdate={(sec) => setCurrentPlaybackTimeMs(sec * 1000)}
                playbackRate={playbackRate}
                onPlaybackRateChange={setPlaybackRate}
                compact
              />
            ) : (
              <div className="p-4 text-center space-y-2">
                <p className="text-body-sm text-red-400">
                  {audioUnavailableReason ||
                    'Failed to load audio. The file may be unavailable or removed from storage.'}
                </p>
              </div>
            )}
          </div>

          {/* Transcription Content with integrated modes */}
          <div ref={transcriptScrollRef} className="glass-container bg-dark-gray/95 backdrop-blur-glass p-5 flex-1 overflow-y-auto min-h-0 flex flex-col">
            {/* Speaker Identification Mode - Takes over entire box */}
            {activeMode === 'speakers' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-heading-md text-secondary-white font-medium">
                    Who is {getSpeakerLabel(speakerList[currentSpeakerIndex], null, recording.detected_speaker_names)}?
                  </h3>
                  <span className="text-body-sm text-medium-gray">
                    {currentSpeakerIndex + 1} of {speakerList.length}
                  </span>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                  <button
                    type="button"
                    onClick={clipPlaying ? pauseCurrentSpeakerClip : () => playCurrentSpeakerClip(currentClipSegment)}
                    className="btn-secondary px-4 py-2 text-body-sm inline-flex items-center justify-center gap-2"
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
                    {clipPlaying ? 'Pause' : 'Play Sample'}
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
                        className="btn-secondary px-4 py-2 text-body-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Try Clip {currentClipSegment + 1} of {segments.length}
                      </button>
                    )
                  })()}
                </div>
                
                {clipError && (
                  <p className="text-body-sm text-red-400 mb-3">
                    Could not play that clip. Try Play Sample again.
                  </p>
                )}
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm focus:outline-none focus:border-cosmic-orange transition-colors"
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
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm focus:outline-none focus:border-cosmic-orange transition-colors"
                    />
                  </div>
                </div>
                
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      pauseCurrentSpeakerClip()
                      setActiveMode('view')
                      setSpeakerList([])
                      setCurrentSpeakerIndex(0)
                      setSpeakerName('')
                      setSpeakerPosition('')
                      setClipError(false)
                      setCurrentClipSegment(0)
                    }}
                    className="btn-secondary px-4 py-2 text-body-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleIdentifySpeaker}
                    className="btn-primary flex-1 py-2 text-body-sm sm:flex-initial min-w-0"
                  >
                    {currentSpeakerIndex < speakerList.length - 1 ? 'Next' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            {/* Search and Replace Mode - Integrated at top */}
            {activeMode === 'search' && (
              <div className="mb-4 border-b border-white/10 pb-4">
                <div className="flex items-center gap-2 mb-2">
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
                          setActiveMode('view')
                          setTranscriptSearchQuery('')
                          setReplaceText('')
                        }
                      }}
                      placeholder="Search..."
                      className="flex-1 bg-transparent text-secondary-white text-body-sm focus:outline-none placeholder:text-medium-gray/50 min-w-0"
                    />
                    {transcriptSearchQuery && (
                      <>
                        <span className="text-caption text-medium-gray flex-shrink-0">
                          {transcriptSearchMatchCount === 0 ? 'No matches' : `${transcriptSearchCurrentMatch + 1} of ${transcriptSearchMatchCount}`}
                        </span>
                        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
                          <button
                            onClick={() => {
                              if (transcriptSearchMatchCount > 0) {
                                setTranscriptSearchCurrentMatch((prev) => (prev - 1 + transcriptSearchMatchCount) % transcriptSearchMatchCount)
                              }
                            }}
                            disabled={transcriptSearchMatchCount === 0}
                            className="p-1 text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Previous match"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              if (transcriptSearchMatchCount > 0) {
                                setTranscriptSearchCurrentMatch((prev) => (prev + 1) % transcriptSearchMatchCount)
                              }
                            }}
                            disabled={transcriptSearchMatchCount === 0}
                            className="p-1 text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Next match"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setActiveMode('view')
                      setTranscriptSearchQuery('')
                      setReplaceText('')
                    }}
                    className="p-2 text-medium-gray hover:text-secondary-white transition-colors"
                    title="Close search"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-glass focus-within:border-cosmic-orange/50 transition-colors">
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <input
                      type="text"
                      value={replaceText}
                      onChange={(e) => setReplaceText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleReplaceOne()
                        }
                      }}
                      placeholder="Replace with..."
                      className="flex-1 bg-transparent text-secondary-white text-body-sm focus:outline-none placeholder:text-medium-gray/50 min-w-0"
                    />
                  </div>
                  <button
                    onClick={handleReplaceOne}
                    disabled={!transcriptSearchQuery || transcriptSearchMatchCount === 0}
                    className="btn-secondary px-3 py-2 text-body-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Replace
                  </button>
                  <button
                    onClick={handleReplaceAll}
                    disabled={!transcriptSearchQuery || transcriptSearchMatchCount === 0}
                    className="btn-secondary px-3 py-2 text-body-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Replace All
                  </button>
                </div>
              </div>
            )}

            {/* Transcription Display - Show in view, search, or edit mode */}
            {(activeMode === 'view' || activeMode === 'search' || activeMode === 'edit') && (
              recording.status === 'transcribed' && recording.transcription ? (
                editedTranscription !== null ? (
                  <textarea
                    value={editedTranscription}
                    onChange={(e) => setEditedTranscription(e.target.value)}
                    className="w-full h-full bg-transparent text-secondary-white text-body-sm focus:outline-none resize-none"
                    placeholder="Edit transcription..."
                  />
                ) : displayUtterances.length > 0 ? (
                  <div className="space-y-3">
                    {displayUtterances.map((utterance, index) => {
                      const isHighlighted = frozenHighlightIndex !== null
                        ? frozenHighlightIndex === index
                        : currentPlaybackTimeMs !== null &&
                          currentPlaybackTimeMs >= utterance.start &&
                          currentPlaybackTimeMs <= utterance.end
                      
                      const speakerLabel = getSpeakerLabel(utterance.speaker, recording.speaker_map, recording.detected_speaker_names)

                      return (
                        <div
                          key={index}
                          ref={(el) => {
                            utteranceLineRefs.current[index] = el
                          }}
                          onClick={() => {
                            // Seek to this utterance's start time and play
                            if (audioPlayerRef.current && !isEditingUtterances) {
                              audioPlayerRef.current.currentTime = utterance.start / 1000
                              audioPlayerRef.current.play()
                            }
                          }}
                          className={`p-3 rounded-glass transition-colors ${
                            isHighlighted ? 'bg-cosmic-orange/20' : 'bg-white/5'
                          } ${!isEditingUtterances ? 'cursor-pointer hover:bg-white/10' : ''}`}
                        >
                          {isEditingUtterances && editedUtterances ? (
                            <>
                              <div className="flex items-center gap-2 mb-1" onClick={(e) => e.stopPropagation()}>
                                <span className="text-caption text-medium-gray uppercase tracking-wider">Speaker</span>
                                <select
                                  value={utterance.speaker}
                                  onChange={(e) => {
                                    const newUtterances = [...editedUtterances]
                                    newUtterances[index] = { ...utterance, speaker: e.target.value }
                                    setEditedUtterances(newUtterances)
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-cosmic-orange text-caption font-semibold uppercase tracking-wider focus:outline-none focus:border-cosmic-orange"
                                  title="Reassign this clip to a different speaker"
                                >
                                  {availableSpeakers.map((sp) => (
                                    <option key={sp} value={sp} className="bg-dark-gray text-secondary-white normal-case">
                                      {getSpeakerLabel(sp, recording.speaker_map, recording.detected_speaker_names)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <textarea
                                value={utterance.text}
                                onChange={(e) => {
                                  const newUtterances = [...editedUtterances]
                                  newUtterances[index] = { ...utterance, text: e.target.value }
                                  setEditedUtterances(newUtterances)
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full min-h-[60px] bg-white/5 border border-white/10 rounded px-2 py-1 text-secondary-white text-body-sm focus:outline-none focus:border-cosmic-orange resize-none"
                              />
                            </>
                          ) : (
                            <p className="text-body-sm text-secondary-white">
                              <span className="text-medium-gray mr-2">[{formatTimestampFromMs(utterance.start)}]</span>
                              <span className="text-cosmic-orange font-semibold">{speakerLabel}:</span>{' '}
                              <span className="whitespace-pre-wrap">
                                {transcriptSearchQuery && activeMode === 'search'
                                  ? highlightSearch(utterance.text, transcriptSearchQuery, transcriptSearchCurrentMatch)
                                  : utterance.text}
                              </span>
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : recording.original_transcription &&
                  recording.transcription !== recording.original_transcription ? (
                  <RecordingTranscriptDiff
                    original={recording.original_transcription}
                    current={recording.transcription}
                    transcriptSearchQuery={transcriptSearchQuery}
                    activeMode={activeMode}
                    transcriptSearchCurrentMatch={transcriptSearchCurrentMatch}
                  />
                ) : (
                  <p className="text-body-sm text-secondary-white whitespace-pre-wrap">
                    {transcriptSearchQuery && activeMode === 'search'
                      ? highlightSearch(recording.transcription, transcriptSearchQuery, transcriptSearchCurrentMatch)
                      : recording.transcription}
                  </p>
                )
              ) : recording.status === 'generating' ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingSpinner size="sm" />
                  <span className="ml-2 text-body-sm text-medium-gray">Generating transcription...</span>
                </div>
              ) : (
                <p className="text-body-sm text-medium-gray text-center py-8">No transcription available</p>
              )
            )}
          </div>

          {/* Save/Cancel buttons for editing */}
          {activeMode === 'edit' && (
            <div className="glass-container p-4 flex gap-2 flex-shrink-0 justify-end">
              <button
                onClick={() => {
                  setEditedTranscription(null)
                  setEditedUtterances(null)
                  setIsEditingUtterances(false)
                  setFrozenHighlightIndex(null)
                  setActiveMode('view')
                }}
                disabled={savingTranscription}
                className="btn-secondary flex-1 py-2 text-body-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleSaveTranscription()
                  setActiveMode('view')
                }}
                disabled={savingTranscription}
                className="btn-primary flex-1 py-2 text-body-sm disabled:opacity-50"
              >
                {savingTranscription ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 glass-container bg-dark-gray/95 backdrop-blur-glass overflow-hidden">
          {/* Actions section (non-collapsible) */}
          <div className="border-b border-white/10">
            <div className="px-4 py-3">
              <p className="text-body-sm text-secondary-white font-medium">Actions</p>
            </div>
            <div className="space-y-0.5 px-4 pb-3">
              {/* Identify Speakers */}
              {recording.status === 'transcribed' && displayUtterances.length > 0 && (
                <button
                  onClick={startSpeakerIdentification}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  <span className="text-body-sm text-secondary-white">
                    Identify Speakers
                    {(() => {
                      const { identified, total } = getIdentifySpeakersProgress(
                        recording.utterances,
                        recording.speaker_map,
                        recording.detected_speaker_names
                      )
                      if (total > 0) {
                        return (
                          <span className="text-medium-gray ml-1">
                            ({identified}/{total})
                          </span>
                        )
                      }
                      return null
                    })()}
                  </span>
                </button>
              )}
              
              {/* Search And Replace */}
              {recording.status === 'transcribed' && recording.transcription && activeMode !== 'edit' && (
                <button
                  onClick={() => {
                    setActiveMode('search')
                    setTimeout(() => transcriptSearchInputRef.current?.focus(), 50)
                  }}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <span className="text-body-sm text-secondary-white">Search And Replace</span>
                </button>
              )}
              
              {/* Edit */}
              {recording.status === 'transcribed' && recording.transcription && activeMode !== 'edit' && (
                <button
                  onClick={() => {
                    audioPlayerRef.current?.pause()
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
                      setEditedTranscription(recording.transcription || '')
                    }
                    setActiveMode('edit')
                  }}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  <span className="text-body-sm text-secondary-white">Edit</span>
                </button>
              )}
              
              {/* Download Audio */}
              <button
                onClick={handleDownload}
                className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
              >
                <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="text-body-sm text-secondary-white">Download Audio</span>
              </button>

              {/* Copy full transcript */}
              {recording.status === 'transcribed' && (recording.transcription || displayUtterances.length > 0) && (
                <button
                  type="button"
                  onClick={handleCopyFullTranscript}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-body-sm text-secondary-white">Copy Full Transcript</span>
                </button>
              )}
            </div>
          </div>

          {/* Playback speed section (non-collapsible) */}
          <div className="border-b border-white/10">
            <div className="px-4 py-3">
              <p className="text-body-sm text-secondary-white font-medium">Playback Speed</p>
            </div>
            <div className="px-4 pb-3">
              <div className="grid grid-cols-5 gap-2">
                {([1, 1.25, 1.5, 1.75, 2] as const).map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      setPlaybackRate(rate)
                      if (audioPlayerRef.current) {
                        audioPlayerRef.current.playbackRate = rate
                      }
                    }}
                    className={`py-2 px-2 rounded border text-body-sm transition-colors flex items-center justify-center text-center ${
                      playbackRate === rate
                        ? 'border-cosmic-orange bg-white/10 text-secondary-white'
                        : 'border-white/10 bg-white/5 text-medium-gray hover:bg-white/10 hover:text-secondary-white'
                    }`}
                    aria-pressed={playbackRate === rate}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Settings section (collapsible) */}
          <div>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
            >
              <p className="text-body-sm text-secondary-white font-medium">Settings</p>
              <div className="w-6 flex items-center justify-center">
                <svg className={`w-3.5 h-3.5 text-medium-gray transition-transform ${settingsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {settingsOpen && (
              <div className="space-y-0.5 px-4 pb-3">
                {/* Edit Details */}
                <button
                  onClick={() => setShowEditDetailsModal(true)}
                  className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  <span className="text-body-sm text-secondary-white">Edit Details</span>
                </button>
                
                {/* Reset To Original */}
                {recording.original_transcription && recording.transcription !== recording.original_transcription && (
                  <button
                    onClick={async () => {
                      if (!confirm('Reset transcription to original? This cannot be undone.')) return
                      try {
                        const { error } = await supabase
                          .from('diffuse_recordings')
                          .update({ transcription: recording.original_transcription })
                          .eq('id', recording.id)
                        
                        if (error) throw error
                        
                        setRecording({ ...recording, transcription: recording.original_transcription })
                        setEditedTranscription(null)
                      } catch (error) {
                        console.error('Error resetting transcription:', error)
                        alert('Failed to reset transcription')
                      }
                    }}
                    className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="text-body-sm text-secondary-white">Reset To Original</span>
                  </button>
                )}
                
                {/* Clear All Speakers */}
                {recording.speaker_map && Object.keys(recording.speaker_map).length > 0 && (
                  <button
                    onClick={async () => {
                      if (!confirm('Remove all speaker labels? This cannot be undone.')) return
                      try {
                        const { error } = await supabase
                          .from('diffuse_recordings')
                          .update({ speaker_map: null })
                          .eq('id', recording.id)
                        
                        if (error) throw error
                        
                        setRecording({ ...recording, speaker_map: null })
                      } catch (error) {
                        console.error('Error clearing speakers:', error)
                        alert('Failed to clear speakers')
                      }
                    }}
                    className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="text-body-sm text-secondary-white">Clear All Speakers</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Delete recording — below Settings */}
          <div className="border-t border-white/10 px-4 py-3">
            <button
              onClick={() => setShowDeleteRecordingConfirm(true)}
              className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
            >
              <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="text-body-sm text-red-400">Delete Recording</span>
            </button>
          </div>
        </div>
      </div>

      {/* Edit Details Modal */}
      {showEditDetailsModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowEditDetailsModal(false)
            setEditedTitle(recording.title)
          }}
        >
          <div
            className="glass-container bg-dark-gray/95 backdrop-blur-glass p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-heading-md text-secondary-white font-medium mb-4">
              Edit Details
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-body-sm text-medium-gray mb-2">
                  Title
                </label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm focus:outline-none focus:border-cosmic-orange transition-colors"
                  placeholder="Recording title"
                  autoFocus
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowEditDetailsModal(false)
                  setEditedTitle(recording.title)
                }}
                className="btn-secondary flex-1 py-3"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleUpdateTitle()
                  setShowEditDetailsModal(false)
                }}
                className="btn-primary flex-1 py-3"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteRecordingConfirm}
        onClose={() => setShowDeleteRecordingConfirm(false)}
        onConfirm={handleDeleteRecording}
        title="Delete Recording"
        message="Are you sure you want to permanently delete this recording and all its contents? This action cannot be undone."
        confirmText="Delete Recording"
        variant="danger"
      />
    </div>
  )
}
