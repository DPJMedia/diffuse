-- Output revisions: stores each rendition of an output's content for diff/history
-- Each re-edit creates a revision before applying; we can compare versions from DB
CREATE TABLE IF NOT EXISTS diffuse_project_output_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    output_id UUID NOT NULL REFERENCES diffuse_project_outputs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_output_revisions_output ON diffuse_project_output_revisions(output_id);
CREATE INDEX IF NOT EXISTS idx_output_revisions_created ON diffuse_project_output_revisions(output_id, created_at DESC);
