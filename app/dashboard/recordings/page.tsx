'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime, formatDuration } from '@/lib/utils/format'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import EmptyState from '@/components/dashboard/EmptyState'
import AudioPlayer from '@/components/dashboard/AudioPlayer'
import RecordingModal from '@/components/dashboard/RecordingModal'
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
  status: RecordingStatus
  created_at: string
}

// Component to show diff between original and edited transcription
function TranscriptionDiffView({ original, current }: { original: string; current: string }) {
  // Split into words while preserving whitespace
  const originalWords = original.split(/(\s+)/)
  const currentWords = current.split(/(\s+)/)
  
  const result: { text: string; type: 'same' | 'added' | 'removed' }[] = []
  
  let i = 0
  let j = 0
  
  while (i < originalWords.length || j < currentWords.length) {
    if (i >= originalWords.length) {
      result.push({ text: currentWords[j], type: 'added' })
      j++
    } else if (j >= currentWords.length) {
      result.push({ text: originalWords[i], type: 'removed' })
      i++
    } else if (originalWords[i] === currentWords[j]) {
      result.push({ text: originalWords[i], type: 'same' })
      i++
      j++
    } else {
      // Look ahead to find matches
      let foundInOriginal = -1
      let foundInCurrent = -1
      
      for (let k = i; k < Math.min(i + 15, originalWords.length); k++) {
        if (originalWords[k] === currentWords[j]) {
          foundInOriginal = k
          break
        }
      }
      
      for (let k = j; k < Math.min(j + 15, currentWords.length); k++) {
        if (currentWords[k] === originalWords[i]) {
          foundInCurrent = k
          break
        }
      }
      
      if (foundInCurrent !== -1 && (foundInOriginal === -1 || foundInCurrent - j <= foundInOriginal - i)) {
        while (j < foundInCurrent) {
          result.push({ text: currentWords[j], type: 'added' })
          j++
        }
      } else if (foundInOriginal !== -1) {
        while (i < foundInOriginal) {
          result.push({ text: originalWords[i], type: 'removed' })
          i++
        }
      } else {
        result.push({ text: originalWords[i], type: 'removed' })
        result.push({ text: currentWords[j], type: 'added' })
        i++
        j++
      }
    }
  }
  
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

type SubscriptionTier = 'free' | 'pro' | 'pro_max'

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
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  
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
  }, [generatingProject])

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

    setUploading(true)
    setUploadProgress(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`)

    try {
      // Determine file extension for storage
      const ext = fileExt || '.mp3'
      const fileName = `${user.id}/${Date.now()}${ext}`
      
      // For files over 6MB, use resumable uploads (TUS protocol)
      // For smaller files, use standard upload
      const useResumable = file.size > 6 * 1024 * 1024 // 6MB threshold
      
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
              const percent = ((bytesUploaded / bytesTotal) * 100).toFixed(1)
              setUploadProgress(`Uploading ${file.name}... ${percent}% (${(bytesUploaded / 1024 / 1024).toFixed(1)}MB / ${(bytesTotal / 1024 / 1024).toFixed(1)}MB)`)
            },
            onSuccess: () => {
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
      }

      setUploadProgress('Extracting audio duration...')

      // Get signed URL to extract duration
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

      setUploadProgress('Creating recording entry...')

      // Create recording entry with detected duration
      const { data: newRecording, error: dbError } = await supabase
        .from('diffuse_recordings')
        .insert({
          user_id: user.id,
          title: 'Processing...',
          duration: detectedDuration,
          file_path: fileName,
          status: 'generating',
        })
        .select()
        .single()

      if (dbError) throw dbError

      // Show the recording detail
      setSelectedRecording(newRecording)
      await fetchRecordings()

      setUploadProgress('Transcribing audio... (this may take a few minutes for large files)')

      // Start transcription
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('recordings')
        .createSignedUrl(newRecording.file_path, 3600)

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw new Error('Failed to get audio URL for transcription')
      }

      // Create AbortController for timeout handling (10 minutes max for very large files)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 minutes

      try {
        const response = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recordingId: newRecording.id,
            audioUrl: signedUrlData.signedUrl,
            autoSave: true,
            currentTitle: '', // Let it auto-generate from transcription
          }),
          signal: controller.signal,
        })
        
        clearTimeout(timeoutId)

        // Handle non-JSON responses
        let data
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          data = await response.json()
        } else {
          const text = await response.text()
          console.error('Non-JSON response:', text)
          throw new Error('Transcription service returned an unexpected response. The file may be too large or the service timed out.')
        }

        if (!response.ok) {
          throw new Error(data.error || 'Transcription failed')
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          throw new Error('Transcription timed out after 10 minutes. The file may be too large. Please try a shorter recording or contact support.')
        }
        throw fetchError
      }

      // Refresh to show the updated recording
      await fetchRecordings()
      
      // Update selected recording
      const { data: updatedRecording } = await supabase
        .from('diffuse_recordings')
        .select('*')
        .eq('id', newRecording.id)
        .single()
      
      if (updatedRecording) {
        setSelectedRecording(updatedRecording)
        
        // If duration is still 0, try to update it from the audio URL
        if (updatedRecording.duration === 0 && signedUrlData?.signedUrl) {
          try {
            const finalDuration = await new Promise<number>((resolve) => {
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
              audio.src = signedUrlData.signedUrl
              
              setTimeout(() => {
                audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
                audio.removeEventListener('error', handleError)
                resolve(0)
              }, 10000)
            })
            
            // Update duration in database if we detected it
            if (finalDuration > 0) {
              await supabase
                .from('diffuse_recordings')
                .update({ duration: finalDuration })
                .eq('id', newRecording.id)
              
              // Refresh again to show updated duration
              await fetchRecordings()
              const { data: finalRecording } = await supabase
                .from('diffuse_recordings')
                .select('*')
                .eq('id', newRecording.id)
                .single()
              
              if (finalRecording) {
                setSelectedRecording(finalRecording)
              }
            }
          } catch (error) {
            console.warn('Failed to update duration after transcription:', error)
          }
        }
      }

      setUploadProgress(null)
    } catch (error) {
      console.error('Upload error:', error)
      alert(error instanceof Error ? error.message : 'Failed to upload recording')
      setUploadProgress(null)
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

  const transcribeRecording = async (recording: Recording) => {
    setTranscribing(true)

    try {
      await supabase
        .from('diffuse_recordings')
        .update({ status: 'generating' })
        .eq('id', recording.id)

      setSelectedRecording({ ...recording, status: 'generating' })
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

      setPendingTranscription(data.transcription)
      setSelectedRecording({ ...recording, status: 'generating' })
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
      // Save both transcription and original_transcription (first time saving)
      const { error } = await supabase
        .from('diffuse_recordings')
        .update({ 
          transcription: pendingTranscription,
          original_transcription: pendingTranscription,
          status: 'transcribed'
        })
        .eq('id', selectedRecording.id)

      if (error) throw error

      // Update local state and close modal
      setPendingTranscription(null)
      setSelectedRecording(null)
      fetchRecordings()
    } catch (error) {
      console.error('Error saving transcription:', error)
      alert('Failed to save transcription')
    }
  }

  const saveEditedTranscription = async () => {
    if (!selectedRecording || editedTranscription === null) return

    setSavingTranscription(true)
    try {
      const { error } = await supabase
        .from('diffuse_recordings')
        .update({ transcription: editedTranscription })
        .eq('id', selectedRecording.id)

      if (error) throw error

      setSelectedRecording({ 
        ...selectedRecording, 
        transcription: editedTranscription 
      })
      setEditedTranscription(null)
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

  useEffect(() => {
    if (selectedRecording) {
      fetchAudioUrl(selectedRecording.file_path)
    } else {
      setAudioUrl(null)
    }
  }, [selectedRecording, fetchAudioUrl])

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

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  // Dynamic button based on recording state
  const RecordingButton = ({ className = '' }: { className?: string }) => {
    if (isRecording || pendingBlob) {
      // Recording in progress or pending save
      return (
        <button
          onClick={() => setShowRecordingModal(true)}
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
      <button
        onClick={() => setShowRecordingModal(true)}
        className={`btn-primary px-4 py-2 flex items-center justify-center gap-2 text-body-sm ${className}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
        Start Recording
      </button>
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
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-secondary-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {uploading ? 'Uploading...' : 'Upload Recording'}
          </button>
          <RecordingButton />
        </div>
      </div>

      {/* Upload Progress Banner */}
      {uploadProgress && (
        <div className="mb-6 p-4 glass-container border border-cosmic-orange/30 bg-cosmic-orange/5">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-cosmic-orange animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-body-sm text-secondary-white">{uploadProgress}</span>
          </div>
        </div>
      )}

      {/* Recordings Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
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
            <div className="flex flex-col sm:flex-row items-center gap-3 mt-4">
              <button
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-secondary-white hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Recording
              </button>
              <span className="text-medium-gray text-caption">or</span>
              <button
                onClick={() => setShowRecordingModal(true)}
                className="btn-primary px-4 py-2 flex items-center justify-center gap-2 text-body-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Start Recording
              </button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {/* Mobile Buttons - full width at top of grid */}
          <div className="md:hidden col-span-1 flex gap-2">
            <button
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 px-4 py-2 flex items-center justify-center gap-2 text-body-sm rounded-glass-sm border border-white/20 text-secondary-white hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload
            </button>
            <RecordingButton className="flex-1" />
          </div>
          {recordings.map((rec) => (
            <div
              key={rec.id}
              onClick={() => openRecording(rec)}
              className="glass-container p-6 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <h3 className="text-heading-md text-secondary-white font-medium mb-4">
                {rec.title}
              </h3>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-caption uppercase tracking-wider">
                  <span className="text-accent-purple">{formatDuration(rec.duration)}</span>
                  <span className="text-medium-gray">•</span>
                  {rec.status === 'transcribed' ? (
                    <span className="text-cosmic-orange">TRANSCRIBED</span>
                  ) : rec.status === 'generating' ? (
                    <span className="text-pale-blue flex items-center gap-1.5">
                      <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      GENERATING
                    </span>
                  ) : (
                    <span className="text-medium-gray">RECORDED</span>
                  )}
                </div>
                
                <div className="text-caption text-medium-gray uppercase tracking-wider">
                  {new Date(rec.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                </div>
              </div>
            </div>
          ))}
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
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setSelectedRecording(null)
            setEditingTitle(false)
            setEditedTitle('')
          }}
        >
          <div
            className="glass-container p-8 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden"
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateRecordingTitle(editedTitle)}
                        className="btn-primary px-4 py-2 text-body-sm"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingTitle(false)
                          setEditedTitle('')
                        }}
                        className="btn-secondary px-4 py-2 text-body-sm"
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
                    <h2 className="text-heading-lg text-secondary-white">
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
                {/* Delete button */}
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this recording?')) {
                      deleteRecording(selectedRecording.id, selectedRecording.file_path)
                      setSelectedRecording(null)
                      setEditedTranscription(null)
                    }
                  }}
                  className="text-medium-gray hover:text-red-400 transition-colors p-1"
                  title="Delete recording"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                {/* Close button */}
                <button
                  onClick={() => {
                    setSelectedRecording(null)
                    setEditingTitle(false)
                    setEditedTitle('')
                    setPendingTranscription(null)
                    setEditedTranscription(null)
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

            <div className="mb-6 flex-shrink-0">
              <h3 className="text-body-sm text-medium-gray mb-3">Audio Playback</h3>
              {loadingAudio ? (
                <div className="flex items-center justify-center py-4 bg-white/5 rounded-glass">
                  <LoadingSpinner size="sm" />
                  <span className="ml-2 text-body-sm text-medium-gray">Loading audio...</span>
                </div>
              ) : audioUrl ? (
                <AudioPlayer 
                  src={audioUrl} 
                  onError={() => setAudioUrl(null)} 
                  initialDuration={selectedRecording?.duration || 0}
                />
              ) : (
                <div className="p-4 bg-white/5 rounded-glass text-center">
                  <p className="text-body-sm text-red-400">Failed to load audio. The file may be unavailable.</p>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h3 className="text-body-sm text-medium-gray">
                  Transcription
                  {editedTranscription !== null && editedTranscription !== selectedRecording.transcription && (
                    <span className="text-cosmic-orange ml-2">(unsaved changes)</span>
                  )}
                  {selectedRecording.original_transcription && 
                   selectedRecording.transcription !== selectedRecording.original_transcription &&
                   editedTranscription === null && (
                    <span className="text-medium-gray ml-2">(edited)</span>
                  )}
                </h3>
                {/* Edit button when viewing diff */}
                {selectedRecording.status === 'transcribed' && 
                 selectedRecording.transcription && 
                 editedTranscription === null && (
                  <button
                    onClick={() => setEditedTranscription(selectedRecording.transcription || '')}
                    className="text-body-sm text-cosmic-orange hover:text-cosmic-orange/80 flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Edit
                  </button>
                )}
              </div>
              {selectedRecording.status === 'transcribed' && selectedRecording.transcription ? (
                <div className="flex flex-col flex-1 min-h-0">
                  {editedTranscription !== null ? (
                    /* Editing mode - show textarea */
                    <>
                      <textarea
                        value={editedTranscription}
                        onChange={(e) => setEditedTranscription(e.target.value)}
                        className="flex-1 min-h-[150px] px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors resize-none leading-relaxed overflow-y-auto"
                      />
                      <div className="flex gap-2 mt-3 flex-shrink-0">
                        <button
                          onClick={() => setEditedTranscription(null)}
                          className="btn-secondary px-4 py-2 text-body-sm"
                          disabled={savingTranscription}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveEditedTranscription}
                          className="btn-primary px-4 py-2 text-body-sm disabled:opacity-50"
                          disabled={savingTranscription || editedTranscription === selectedRecording.transcription}
                        >
                          {savingTranscription ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </>
                  ) : (
                    /* View mode - show diff if edited, plain text if not */
                    <>
                      <div className="flex-1 min-h-[150px] px-4 py-3 bg-white/5 border border-white/10 rounded-glass overflow-y-auto">
                        {selectedRecording.original_transcription && 
                         selectedRecording.transcription !== selectedRecording.original_transcription ? (
                          <TranscriptionDiffView 
                            original={selectedRecording.original_transcription} 
                            current={selectedRecording.transcription} 
                          />
                        ) : (
                          <p className="text-body-md text-secondary-white leading-relaxed whitespace-pre-wrap">
                            {selectedRecording.transcription}
                          </p>
                        )}
                      </div>
                      {/* Action Buttons */}
                      <div className="mt-4 flex-shrink-0 flex gap-3">
                        <button
                          onClick={() => setSelectedRecording(null)}
                          disabled={generatingProject}
                          className="flex-1 px-4 py-3 flex items-center justify-center gap-2 text-body-sm rounded-glass btn-secondary"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Save & Close
                        </button>
                        <button
                          onClick={handleCreateProjectAndArticle}
                          disabled={generatingProject}
                          className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 text-body-sm rounded-glass transition-colors ${
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
                      </div>
                    </>
                  )}
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
              <div className="flex gap-3 pt-4 border-t border-white/10 flex-shrink-0">
                <button
                  onClick={saveTranscription}
                  className="btn-primary flex-1 py-3"
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
