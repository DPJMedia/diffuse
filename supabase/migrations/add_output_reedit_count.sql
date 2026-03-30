-- Track how many times "Edit Content" has been applied for each output
ALTER TABLE diffuse_project_outputs
ADD COLUMN IF NOT EXISTS reedit_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN diffuse_project_outputs.reedit_count IS 'Number of times Edit Content has been applied for this output';
