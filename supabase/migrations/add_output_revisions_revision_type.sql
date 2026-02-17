-- Add revision_type to distinguish renditions: 'previous' = content before re-edit, 'proposed' = workflow result
-- Enables comparing versions from DB and knowing which rendition is which
ALTER TABLE diffuse_project_output_revisions
ADD COLUMN IF NOT EXISTS revision_type TEXT;

-- Backfill existing rows as 'previous' (they were pre-reedit snapshots)
UPDATE diffuse_project_output_revisions
SET revision_type = 'previous'
WHERE revision_type IS NULL;

-- Optional: index for querying by type when comparing
CREATE INDEX IF NOT EXISTS idx_output_revisions_type ON diffuse_project_output_revisions(output_id, revision_type, created_at DESC);
