/**
 * Recording-sourced project inputs store a *snapshot* of the recording transcript, copied at the
 * moment the recording was added to the project (see SelectRecordingModal and the quick workflow).
 * If the user identifies speakers — or edits the transcript — *after* adding the recording (or has to
 * re-run identification because the first attempt glitched), that snapshot goes stale: it still holds
 * "Speaker A / Speaker B" labels instead of the real names. The workflow then has no way to know who
 * said what and either attributes quotes to the wrong person or drops names entirely.
 *
 * To prevent that, every generation path refreshes recording-sourced inputs from the *current*
 * diffuse_recordings.transcription right before calling n8n. This is the one choke point that
 * guarantees the enriched ("Name (Position): text") transcript reaches the workflow regardless of the
 * order in which the user added the recording vs. identified speakers.
 */

/**
 * Minimal structural type so this helper works with either the user-scoped or admin Supabase client.
 * Typed as `any` on `from` to avoid reconciling Supabase's deep PostgrestFilterBuilder generics; the
 * awaited result is cast to the shape we actually read.
 */
type SupabaseLike = { from: (table: string) => any }

type RecordingTranscriptRow = { id: string; transcription: string | null }

type InputLike = { content?: string | null; metadata?: unknown }

function recordingIdOf(input: InputLike): string | null {
  const meta = (input?.metadata ?? null) as { recording_id?: unknown } | null
  const id = meta?.recording_id
  return typeof id === 'string' && id.trim() !== '' ? id : null
}

/**
 * Fetch the latest transcript for every recording referenced by these inputs.
 * Returns a map of recording_id -> transcription, containing only recordings that still exist and
 * have a non-empty transcript. Anything absent from the map keeps its stored input content.
 * Never throws: on any query error it returns whatever it has (falling back to stored content is safe).
 */
export async function fetchLatestRecordingTranscripts(
  inputs: InputLike[],
  supabase: SupabaseLike
): Promise<Map<string, string>> {
  const recordingIds = new Set<string>()
  for (const input of inputs) {
    const id = recordingIdOf(input)
    if (id) recordingIds.add(id)
  }

  const map = new Map<string, string>()
  if (recordingIds.size === 0) return map

  try {
    const res = await supabase.from('diffuse_recordings').select('id, transcription').in('id', Array.from(recordingIds))
    const data = (res?.data ?? null) as RecordingTranscriptRow[] | null
    if (res?.error || !data) return map
    for (const row of data) {
      if (typeof row.transcription === 'string' && row.transcription.trim() !== '') {
        map.set(row.id, row.transcription)
      }
    }
  } catch {
    /* fall through — stored content is a safe fallback */
  }
  return map
}

/**
 * Content to send to the workflow for a single input: the latest recording transcript when this input
 * is recording-sourced and a fresh transcript is available, otherwise the stored input content.
 */
export function resolveInputContent(input: InputLike, latestByRecordingId: Map<string, string>): string {
  const id = recordingIdOf(input)
  if (id) {
    const fresh = latestByRecordingId.get(id)
    if (fresh) return fresh
  }
  return input?.content || ''
}
