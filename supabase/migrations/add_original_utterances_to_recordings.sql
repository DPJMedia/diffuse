-- Add original_utterances column to diffuse_recordings for diff display after edits
-- Structure: array of { "speaker": "A", "text": "...", "start": 0, "end": 1500 } (start/end in ms)

ALTER TABLE diffuse_recordings
ADD COLUMN IF NOT EXISTS original_utterances JSONB DEFAULT NULL;

