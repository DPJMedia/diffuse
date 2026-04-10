-- When the source event was recorded (e.g. meeting date parsed from Swagit). UI falls back to created_at when null.
ALTER TABLE diffuse_recordings
ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ NULL;
