'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ModalShell, ModalHeader, ModalBody } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

type RecordingPhase = 'ready' | 'recording' | 'stopped'

const BAR_COUNT = 48

interface RecordingModalProps {
  onClose: () => void
  onSave: (blob: Blob, duration: number, title: string) => Promise<void>
  onDiscard: () => void
  // External recording state (for persistent recording)
  isRecording: boolean
  recordingTime: number
  onStartRecording: () => void
  onStopRecording: () => void
  pendingBlob: Blob | null
}

export default function RecordingModal({ 
  onClose, 
  onSave,
  onDiscard,
  isRecording,
  recordingTime,
  onStartRecording,
  onStopRecording,
  pendingBlob
}: RecordingModalProps) {
  const [phase, setPhase] = useState<RecordingPhase>(
    pendingBlob ? 'stopped' : isRecording ? 'recording' : 'ready'
  )
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(BAR_COUNT).fill(0))
  const [showLowVolumeWarning, setShowLowVolumeWarning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSaveForm, setShowSaveForm] = useState(false)
  
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lowVolumeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lowVolumeCountRef = useRef(0)
  const previousLevelsRef = useRef<number[]>(Array(BAR_COUNT).fill(0))
  const visualizationStartedRef = useRef(false)

  // Sync phase with external recording state
  useEffect(() => {
    if (pendingBlob) {
      setPhase('stopped')
      // Trigger save form animation after a brief delay
      setTimeout(() => setShowSaveForm(true), 100)
    } else if (isRecording) {
      setPhase('recording')
      setShowSaveForm(false)
    } else {
      setPhase('ready')
      setShowSaveForm(false)
    }
  }, [isRecording, pendingBlob])

  // Visualize audio levels with smooth interpolation
  const startVisualization = useCallback((analyser: AnalyserNode) => {
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const updateLevels = () => {
      if (!analyserRef.current) return
      
      analyser.getByteFrequencyData(dataArray)
      
      // Sample frequency bands evenly across the spectrum
      const levels: number[] = []
      const usableRange = Math.floor(bufferLength * 0.8)
      const step = usableRange / BAR_COUNT
      
      for (let i = 0; i < BAR_COUNT; i++) {
        const startIdx = Math.floor(i * step)
        const endIdx = Math.floor((i + 1) * step)
        
        let sum = 0
        let count = 0
        for (let j = startIdx; j < endIdx && j < bufferLength; j++) {
          sum += dataArray[j]
          count++
        }
        
        const rawValue = count > 0 ? sum / count / 255 : 0
        const boostedValue = Math.pow(rawValue, 0.7) * 1.8
        levels.push(Math.min(1, boostedValue))
      }
      
      // Smooth interpolation between frames
      const smoothingFactor = 0.5
      const smoothed = levels.map((level, i) => {
        const prev = previousLevelsRef.current[i]
        const diff = level - prev
        const factor = diff > 0 ? smoothingFactor * 0.4 : smoothingFactor
        return prev + diff * (1 - factor)
      })
      previousLevelsRef.current = smoothed
      setAudioLevels(smoothed)

      // Check for very low volume (likely won't transcribe well)
      const avgLevel = levels.reduce((a, b) => a + b, 0) / levels.length
      if (avgLevel < 0.03) {
        lowVolumeCountRef.current++
        // Show warning after ~5 seconds of very low volume (300 frames at 60fps)
        if (lowVolumeCountRef.current > 300 && !showLowVolumeWarning) {
          setShowLowVolumeWarning(true)
          if (lowVolumeTimeoutRef.current) clearTimeout(lowVolumeTimeoutRef.current)
          lowVolumeTimeoutRef.current = setTimeout(() => {
            setShowLowVolumeWarning(false)
          }, 2500)
        }
      } else {
        lowVolumeCountRef.current = 0
      }

      animationFrameRef.current = requestAnimationFrame(updateLevels)
    }

    updateLevels()
  }, [showLowVolumeWarning])

  // Stop visualization and release mic
  const stopVisualization = useCallback(() => {
    visualizationStartedRef.current = false
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
    setAudioLevels(Array(BAR_COUNT).fill(0))
    previousLevelsRef.current = Array(BAR_COUNT).fill(0)
  }, [])

  // Initialize and start visualization when recording
  useEffect(() => {
    if (isRecording && !visualizationStartedRef.current) {
      visualizationStartedRef.current = true
      
      const initAndStart = async () => {
        try {
          if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
            return
          }

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          streamRef.current = stream

          const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext)
          if (!AudioContextClass) return
          
          const audioContext = new AudioContextClass()
          audioContextRef.current = audioContext
          
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.4
          analyserRef.current = analyser

          const source = audioContext.createMediaStreamSource(stream)
          source.connect(analyser)

          // Start visualization immediately after setup
          startVisualization(analyser)
        } catch (err) {
          console.error('Error initializing visualization:', err)
        }
      }
      
      initAndStart()
    }
    
    if (!isRecording && visualizationStartedRef.current) {
      stopVisualization()
    }
  }, [isRecording, startVisualization, stopVisualization])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (lowVolumeTimeoutRef.current) {
        clearTimeout(lowVolumeTimeoutRef.current)
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Handle start recording
  const handleStartRecording = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Your browser does not support audio recording.')
        return
      }

      if (typeof window !== 'undefined' && !window.isSecureContext) {
        setError('Microphone access requires a secure connection (HTTPS).')
        return
      }

      // Test mic access before starting
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      testStream.getTracks().forEach(track => track.stop())
      
      onStartRecording()
      setPhase('recording')
    } catch (err: any) {
      console.error('Error starting recording:', err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access was denied. Please enable it in your browser settings.')
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect a microphone.')
      } else {
        setError(err.message || 'Failed to access microphone.')
      }
    }
  }

  // Handle stop recording
  const handleStopRecording = () => {
    onStopRecording()
    setPhase('stopped')
  }

  // Discard recording
  const discardRecording = () => {
    setShowSaveForm(false)
    onDiscard()
    setPhase('ready')
    setTitle('')
  }

  // Close modal (also discards if there's a pending recording)
  const handleClose = () => {
    if (pendingBlob) {
      onDiscard()
    }
    onClose()
  }

  // Save recording
  const handleSave = async () => {
    if (!pendingBlob) return

    setSaving(true)
    try {
      // Title is optional - will be auto-generated from transcription
      await onSave(pendingBlob, recordingTime, title.trim() || '')
    } catch (err) {
      console.error('Error saving:', err)
      setError('Failed to save recording.')
      setSaving(false)
    }
  }

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const phaseTitle =
    phase === 'ready' ? 'New Recording' : phase === 'recording' ? 'Recording...' : 'Save Recording'

  return (
    <ModalShell onClose={handleClose} maxWidth="max-w-lg" maxHeight="max-h-[90vh]">
      <div className="w-full max-w-lg max-h-[80vh] min-h-[320px] overflow-hidden relative flex flex-col flex-1 min-h-0">
        <ModalHeader
          icon={<span className={MODAL_ICONS.recording.color}>{MODAL_ICONS.recording.icon}</span>}
          title={phaseTitle}
          onClose={handleClose}
        />
        <ModalBody className="pb-24 relative z-10 flex-1 min-h-0">

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-glass">
              <p className="text-body-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Low Volume Warning - Simple and brief */}
          <div 
            className={`mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-glass text-center transition-all duration-300 ${
              showLowVolumeWarning && phase === 'recording'
                ? 'opacity-100 max-h-16'
                : 'opacity-0 max-h-0 overflow-hidden p-0 mb-0 border-0'
            }`}
          >
            <p className="text-body-sm text-yellow-400">
              Volume may be too low for clear transcription
            </p>
          </div>

          {/* Center content area - fixed height to prevent shifting */}
          <div className="flex-1 flex flex-col items-center justify-center relative">
            {/* Mic Button / Recording Button / Completed Icon */}
            <div className={`flex flex-col items-center transition-all duration-300 ease-out ${
              phase === 'stopped' ? 'transform -translate-y-4' : ''
            }`}>
              {phase === 'ready' && (
                <button
                  onClick={handleStartRecording}
                  disabled={!!error}
                  className="w-32 h-32 rounded-full bg-cosmic-orange/20 border-2 border-cosmic-orange flex items-center justify-center hover:bg-cosmic-orange/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <svg 
                    className="w-14 h-14 text-cosmic-orange group-hover:scale-110 transition-transform" 
                    fill="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                  </svg>
                </button>
              )}

              {phase === 'recording' && (
                <button
                  onClick={handleStopRecording}
                  className="w-32 h-32 rounded-full bg-red-500/20 border-2 border-red-500 flex flex-col items-center justify-center hover:bg-red-500/30 transition-all group"
                >
                  <span className="animate-pulse w-3 h-3 bg-red-500 rounded-full mb-2" />
                  <span className="text-2xl font-bold text-red-400 group-hover:scale-105 transition-transform">
                    {formatTime(recordingTime)}
                  </span>
                </button>
              )}

              {phase === 'stopped' && (
                <div className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-500 flex flex-col items-center justify-center">
                  <svg className="w-6 h-6 text-green-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-bold text-green-400">
                    {formatTime(recordingTime)}
                  </span>
                </div>
              )}
            </div>

            {/* Instruction Text - fades based on phase */}
            <div className={`mt-4 text-center transition-all duration-300 ${
              phase === 'stopped' ? 'opacity-0 h-0' : 'opacity-100'
            }`}>
              {phase === 'ready' && !error && (
                <p className="text-body-sm text-medium-gray">
                  Click the microphone to start recording
                </p>
              )}
              {phase === 'ready' && error && (
                <p className="text-body-sm text-medium-gray">
                  Please grant microphone access to record
                </p>
              )}
              {phase === 'recording' && (
                <p className="text-body-sm text-medium-gray">
                  Click to stop recording
                </p>
              )}
            </div>

            {/* Save Form - slides in smoothly when stopped */}
            <div 
              className={`w-full mt-4 space-y-4 transition-all duration-300 ease-out ${
                showSaveForm 
                  ? 'opacity-100 transform translate-y-0' 
                  : 'opacity-0 transform translate-y-4 pointer-events-none absolute'
              }`}
            >
              <div>
                <label className="block text-caption text-medium-gray mb-2 uppercase tracking-wider">
                  Title <span className="text-medium-gray font-normal normal-case">(optional - auto-generated from content)</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Leave blank to auto-generate"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                  autoFocus={showSaveForm}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={discardRecording}
                  disabled={saving}
                  className="btn-secondary flex-1 py-3 disabled:opacity-50 w-full sm:w-auto"
                >
                  Discard
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex-1 py-3 disabled:opacity-50 w-full sm:w-auto"
                >
                  {saving ? 'Processing...' : 'Save & Transcribe'}
                </button>
              </div>
            </div>
          </div>
        </ModalBody>

        {/* Audio Visualization - Background at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-20 flex items-end overflow-hidden flex-shrink-0">
          <div className="flex items-end w-full h-full">
            {audioLevels.map((level, index) => (
              <div
                key={index}
                className="flex-1 rounded-t-sm transition-all duration-75"
                style={{
                  height: `${Math.max(4, level * 72)}px`,
                  backgroundColor: phase === 'stopped'
                    ? 'rgba(107, 114, 128, 0.2)'
                    : `rgba(107, 114, 128, ${0.3 + level * 0.4})`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
