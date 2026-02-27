-- Add utterances column to diffuse_recordings for playback-synced transcript
-- Structure: array of { "speaker": "A", "text": "...", "start": 0, "end": 1500 } (start/end in ms)

ALTER TABLE diffuse_recordings
ADD COLUMN IF NOT EXISTS utterances JSONB DEFAULT NULL;
