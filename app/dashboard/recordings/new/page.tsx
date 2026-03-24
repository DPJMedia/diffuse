'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { saveRecordingToStorageAndDb, transcribeSavedRecording } from '@/lib/recording/persistRecordedBlob'
import { useRecordingCapture } from '@/hooks/useRecordingCapture'
import RecordingSessionPanel from '@/components/dashboard/RecordingSessionPanel'

export default function NewRecordingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()
  const capture = useRecordingCapture()

  const handleSave = async (blob: Blob, duration: number, title: string) => {
    if (!user) throw new Error('Not authenticated')

    const saved = await saveRecordingToStorageAndDb({
      supabase,
      userId: user.id,
      blob,
      duration,
      title,
    })

    capture.discardRecording()
    router.push('/dashboard/recordings')

    void transcribeSavedRecording({
      supabase,
      recordingId: saved.id,
      filePath: saved.file_path,
      title,
    })
  }

  return (
    <div className="w-full">
      <RecordingSessionPanel
        variant="page"
        onBack={() => router.push('/dashboard/recordings')}
        onClose={() => router.push('/dashboard/recordings')}
        onSave={handleSave}
        onDiscard={capture.discardRecording}
        isRecording={capture.isRecording}
        recordingTime={capture.recordingTime}
        onStartRecording={capture.startRecording}
        onStopRecording={capture.stopRecording}
        pendingBlob={capture.pendingBlob}
      />
    </div>
  )
}
