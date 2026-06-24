-- Add transcript_id to diffuse_recordings.
-- Stores the AssemblyAI transcript id of the most recent transcription job so a re-run
-- (e.g. after the serverless function times out) can resume / reuse that completed job
-- instead of submitting a fresh transcription, which would re-diarize and can place
-- speaker labels differently. Nullable and additive — safe to apply at any time.
ALTER TABLE diffuse_recordings
  ADD COLUMN IF NOT EXISTS transcript_id TEXT;

COMMENT ON COLUMN diffuse_recordings.transcript_id IS
  'AssemblyAI transcript id of the most recent transcription job; used to resume after a timeout.';
