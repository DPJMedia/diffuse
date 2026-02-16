-- ============================================
-- Workflow-generated image support
-- Run in Supabase SQL Editor if your DB is missing any of this.
-- ============================================
-- What this does:
-- 1. Ensures diffuse_project_outputs has cover_photo_path and workflow_metadata
-- 2. Ensures project-files bucket exists (for storing fetched images)
-- 3. Ensures storage policies allow uploads/reads for project-files
--
-- If you get "function get_my_workspace_ids() does not exist", run your
-- workspace/organization migrations first, or simplify the SELECT policy
-- to only allow auth.uid() = (storage.foldername(name))[1].
-- ============================================

-- 1. Table: diffuse_project_outputs
-- cover_photo_path: where we store the path after fetching the workflow image into our bucket
ALTER TABLE diffuse_project_outputs
ADD COLUMN IF NOT EXISTS cover_photo_path TEXT DEFAULT NULL;

-- workflow_metadata: we store { "generated_image_url": "https://..." } here; optional, used as fallback
ALTER TABLE diffuse_project_outputs
ADD COLUMN IF NOT EXISTS workflow_metadata JSONB DEFAULT '{}'::JSONB;

-- 2. Bucket: project-files (for cover images and generated images)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-files', 'project-files', false, 52428800)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = GREATEST(storage.buckets.file_size_limit, 52428800);

-- 3. Storage policy: allow INSERT so the app can upload fetched images to user_id/project_id/...
-- Path we use: {user.id}/{project_id}/cover-{output.id}-generated.png
DROP POLICY IF EXISTS "Users can upload to own project files" ON storage.objects;
CREATE POLICY "Users can upload to own project files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'project-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 4. Storage policy: allow SELECT so project members can read (covers + generated images)
-- If you already have "Users can view own project files" with project-access logic, skip or merge.
DROP POLICY IF EXISTS "Users can view own project files" ON storage.objects;
CREATE POLICY "Users can view own project files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-files'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR (
      array_length(storage.foldername(name), 1) >= 2
      AND EXISTS (
        SELECT 1 FROM diffuse_projects p
        WHERE p.id = ((storage.foldername(name))[2])::uuid
        AND (
          p.created_by = auth.uid()
          OR (p.workspace_id IS NOT NULL AND p.workspace_id IN (SELECT get_my_workspace_ids()))
          OR (
            p.visibility = 'public'
            AND p.visible_to_orgs IS NOT NULL
            AND p.visible_to_orgs && ARRAY(SELECT get_my_workspace_ids())::text[]
          )
        )
      )
    )
  )
);

-- Optional: allow DELETE so users can remove their project files
DROP POLICY IF EXISTS "Users can delete own project files" ON storage.objects;
CREATE POLICY "Users can delete own project files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'project-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
