-- Add detected_speaker_names column to diffuse_recordings table
-- This stores auto-detected person names from AssemblyAI entity detection

ALTER TABLE diffuse_recordings
ADD COLUMN IF NOT EXISTS detected_speaker_names JSONB DEFAULT NULL;

-- Add a comment to document the column
COMMENT ON COLUMN diffuse_recordings.detected_speaker_names IS 'Auto-detected speaker names from AssemblyAI entity detection. Format: {"A": "John Doe", "B": "Jane Smith"}';;
