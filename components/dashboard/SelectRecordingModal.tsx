'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  formatRelativeTime,
  formatDuration,
  recordingDisplayTimestamp,
  effectiveRecordingDurationSeconds,
} from '@/lib/utils/format'
import { SelectRecordingModalSkeleton } from './Skeletons'
import { ModalShell, ModalHeader, ModalBody, ModalScrollRegion, ModalFooter } from './ModalShell'
import { MODAL_ICONS } from './modalIcons'

// Inline SVG icons
const MicrophoneIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
  </svg>
)

interface Recording {
  id: string
  user_id: string
  title: string
  duration: number
  file_path: string
  transcription: string | null
  status: string
  recorded_at?: string | null
  created_at: string
}

interface SelectRecordingModalProps {
  projectId: string
  onClose: () => void
  onSuccess: () => void
}

export default function SelectRecordingModal({
  projectId,
  onClose,
  onSuccess,
}: SelectRecordingModalProps) {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [alreadyAddedIds, setAlreadyAddedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const supabase = createClient()

  const fetchRecordings = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch recordings that have transcriptions
      const { data: recordingsData, error: recordingsError } = await supabase
        .from('diffuse_recordings')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'transcribed')
        .not('transcription', 'is', null)
        .order('created_at', { ascending: false })

      if (recordingsError) {
        console.error('Error fetching recordings:', recordingsError)
        return
      }

      // Fetch existing inputs for this project to check which recordings are already added
      const { data: existingInputs, error: inputsError } = await supabase
        .from('diffuse_project_inputs')
        .select('metadata')
        .eq('project_id', projectId)

      if (inputsError) {
        console.error('Error fetching existing inputs:', inputsError)
      }

      // Extract recording IDs that are already added as inputs
      const addedRecordingIds = new Set<string>()
      if (existingInputs) {
        existingInputs.forEach((input) => {
          if (input.metadata?.recording_id) {
            addedRecordingIds.add(input.metadata.recording_id)
          }
        })
      }

      setAlreadyAddedIds(addedRecordingIds)
      setRecordings(recordingsData || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase, projectId])

  useEffect(() => {
    fetchRecordings()
  }, [fetchRecordings])

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleAddSelected = async () => {
    if (selectedIds.size === 0) return

    setAdding(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const selectedRecordings = recordings.filter(r => selectedIds.has(r.id))
      
      // Insert all selected recordings as inputs
      const inputs = selectedRecordings.map(recording => ({
        project_id: projectId,
        type: 'text',
        content: recording.transcription,
        file_name: recording.title,
        metadata: {
          source: 'recording',
          recording_id: recording.id,
          recording_title: recording.title,
          recording_duration: recording.duration,
        },
        created_by: user.id,
      }))

      const { error } = await supabase
        .from('diffuse_project_inputs')
        .insert(inputs)

      if (error) throw error

      onSuccess()
      onClose()
    } catch (error) {
      console.error('Error adding recordings as inputs:', error)
      alert('Failed to add recordings as inputs')
    } finally {
      setAdding(false)
    }
  }

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl" maxHeight="max-h-[90vh]">
      <ModalHeader
        icon={<span className={MODAL_ICONS.selectRecording.color}>{MODAL_ICONS.selectRecording.icon}</span>}
        title="Add from Recordings"
        onClose={onClose}
      />
      <ModalBody>
        <ModalScrollRegion>
          {loading ? (
            <SelectRecordingModalSkeleton />
          ) : recordings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MicrophoneIcon className="w-16 h-16 text-medium-gray mb-4" />
              <p className="text-body-md text-secondary-white mb-2">No Transcribed Recordings</p>
              <p className="text-body-sm text-medium-gray">
                Record audio and generate transcriptions first, then you can use them as inputs.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recordings.map((recording) => {
                const isSelected = selectedIds.has(recording.id)
                const isAlreadyAdded = alreadyAddedIds.has(recording.id)
                
                return (
                  <button
                    key={recording.id}
                    onClick={() => !isAlreadyAdded && toggleSelection(recording.id)}
                    disabled={adding || isAlreadyAdded}
                    className={`w-full text-left p-4 rounded-glass border transition-colors ${
                      isAlreadyAdded
                        ? 'bg-white/5 border-white/10 opacity-60 cursor-not-allowed'
                        : isSelected 
                          ? 'bg-cosmic-orange/10 border-cosmic-orange/30' 
                          : 'bg-white/5 hover:bg-white/10 border-white/10'
                    } ${adding ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Checkbox or Already Added indicator */}
                      {isAlreadyAdded ? (
                        <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 bg-green-500/20 border-green-500/50">
                          <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected 
                            ? 'bg-cosmic-orange border-cosmic-orange' 
                            : 'border-medium-gray'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      )}
                      
                      {/* Recording Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <MicrophoneIcon className={`w-5 h-5 flex-shrink-0 ${isAlreadyAdded ? 'text-green-400' : 'text-cosmic-orange'}`} />
                          <p className="text-body-md text-secondary-white font-medium truncate">
                            {recording.title}
                          </p>
                          {isAlreadyAdded && (
                            <span className="text-caption text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                              Added
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-body-sm text-medium-gray ml-8">
                          <span>{formatDuration(effectiveRecordingDurationSeconds(recording))}</span>
                          <span>•</span>
                          <span>{formatRelativeTime(recordingDisplayTimestamp(recording))}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </ModalScrollRegion>
      </ModalBody>
      <ModalFooter>
        <button onClick={onClose} className="btn-secondary flex-1 py-3" disabled={adding}>
          Cancel
        </button>
        <button
          onClick={handleAddSelected}
          disabled={adding || selectedIds.size === 0}
          className="btn-primary flex-1 py-3 disabled:opacity-50"
        >
          {adding ? 'Adding...' : `Add ${selectedIds.size > 0 ? `(${selectedIds.size})` : 'Selected'}`}
        </button>
      </ModalFooter>
    </ModalShell>
  )
}
