-- Add speaker_map column to diffuse_recordings table
-- This stores the mapping from speaker labels (e.g. "Speaker A") to actual names and positions
-- Structure: { "Speaker A": { "name": "John Smith", "position": "Mayor" }, ... }

ALTER TABLE diffuse_recordings
ADD COLUMN IF NOT EXISTS speaker_map JSONB DEFAULT NULL;
