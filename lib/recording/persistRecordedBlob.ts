import type { SupabaseClient } from '@supabase/supabase-js'

export type SavedRecordingRow = {
  id: string
  file_path: string
}

/**
 * Upload blob to storage and insert diffuse_recordings row (same as recordings modal save).
 */
export async function saveRecordingToStorageAndDb(options: {
  supabase: SupabaseClient
  userId: string
  blob: Blob
  duration: number
  title: string
}): Promise<SavedRecordingRow> {
  const { supabase, userId, blob, duration, title } = options

  const fileName = `${userId}/${Date.now()}.webm`
  // Set an explicit content-type so the stored object serves as audio (not octet-stream),
  // which lets the browser seek/scrub recorded .webm reliably.
  const { error: uploadError } = await supabase.storage
    .from('recordings')
    .upload(fileName, blob, { contentType: blob.type || 'audio/webm' })

  if (uploadError) throw uploadError

  const initialTitle = title || 'Processing...'

  const { data: newRecording, error: dbError } = await supabase
    .from('diffuse_recordings')
    .insert({
      user_id: userId,
      title: initialTitle,
      duration,
      file_path: fileName,
      status: 'generating',
    })
    .select()
    .single()

  if (dbError) throw dbError

  return { id: newRecording.id, file_path: newRecording.file_path }
}

/**
 * Background transcription (matches recordings page after save — failures downgrade status).
 */
export async function transcribeSavedRecording(options: {
  supabase: SupabaseClient
  recordingId: string
  filePath: string
  title: string
}): Promise<void> {
  const { supabase, recordingId, filePath, title } = options

  try {
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('recordings')
      .createSignedUrl(filePath, 3600)

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error('Failed to get audio URL for transcription')
    }

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordingId,
        audioUrl: signedUrlData.signedUrl,
        autoSave: true,
        currentTitle: title,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Transcription failed')
    }
  } catch (error) {
    console.error('Auto-transcription error:', error)
    await supabase
      .from('diffuse_recordings')
      .update({ status: 'recorded', title: title || 'Untitled Recording' })
      .eq('id', recordingId)
  }
}
