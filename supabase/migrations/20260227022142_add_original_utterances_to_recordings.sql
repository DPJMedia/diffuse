ALTER TABLE diffuse_recordings
ADD COLUMN IF NOT EXISTS original_utterances JSONB DEFAULT NULL;;
