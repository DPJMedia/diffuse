# Workflow-generated image setup

This doc covers what you need (SQL + config) so workflow-generated cover images are fetched by the server, stored in your bucket, and displayed via your app (no direct Azure/DALL·E URLs in the browser).

## 1. SQL (Supabase)

Run the migration so your database and storage are ready:

**Option A – Supabase Dashboard**

1. Open your project → **SQL Editor**.
2. Paste and run the contents of:
   ```
   supabase/migrations/ensure_workflow_generated_image_support.sql
   ```
3. If you get `function get_my_workspace_ids() does not exist`, run your workspace/org migrations first, or temporarily simplify the SELECT policy in that file to only allow the uploader to read (first path segment = `auth.uid()`).

**Option B – Supabase CLI**

From the repo root:

```bash
supabase db push
```

(or run the migration file manually against your DB if you don’t use `db push`).

**What the migration does**

- Adds (if missing) on `diffuse_project_outputs`:
  - `cover_photo_path` (TEXT) – path in your bucket for the generated image.
  - `workflow_metadata` (JSONB) – can hold `generated_image_url` as fallback.
- Ensures the `project-files` bucket exists and has a 50MB file size limit.
- Ensures storage policies:
  - **INSERT**: user can upload to `project-files` when the first path segment is their `auth.uid()`.
  - **SELECT**: uploader or anyone with project access (owner or org visibility) can read.
  - **DELETE**: user can delete objects under their own folder.

## 2. Environment variables

No new env vars are required. The app already uses:

- Supabase URL + anon key (and optionally service role key for `/api/project-file` if you want all project members to load images without storage RLS blocking).

## 3. Service role key (optional but recommended)

For **Project file** (e.g. `/api/project-file`) to serve images to all project members (not only the uploader), the server should use the **service role** when downloading from storage so storage RLS doesn’t block shared viewers/editors.

- In Supabase: **Settings → API** → copy **service_role** key.
- In your app (e.g. Vercel/local env), set:
  - `SUPABASE_SERVICE_ROLE_KEY=<that key>`
- Keep this key server-only; never expose it to the client.

Your existing `/api/project-file` route already uses `createAdminClient()` when the service role is set, so no code change is needed once the key is set.

## 4. What the app does (no extra steps)

Already implemented in the repo:

1. **Workflow API** (`app/api/workflow/route.ts`):  
   When the workflow returns an image URL, the server:
   - Fetches the image from that URL (server-side).
   - Uploads it to Supabase storage: `project-files` → `{userId}/{projectId}/cover-{outputId}-generated.{ext}`.
   - Updates the output row: `cover_photo_path = that path`, and keeps `workflow_metadata.generated_image_url` if you want a fallback.

2. **Front end**:  
   Output detail (and any place that shows the cover) uses `cover_photo_path` with `/api/project-file?path=...`, so the browser only loads from your domain.

3. **Existing outputs**:  
   Old outputs that only have the external URL in `workflow_metadata` (and no `cover_photo_path`) did not go through this flow. For those, either re-run generate for that project or run a one-off job that fetches the URL and uploads to `project-files` and sets `cover_photo_path`.

## 5. Checklist

- [ ] Run the SQL migration (`ensure_workflow_generated_image_support.sql`) in Supabase.
- [ ] (Optional) Set `SUPABASE_SERVICE_ROLE_KEY` so project members can load images via `/api/project-file`.
- [ ] Run a new workflow that returns an image URL; the cover should save to your bucket and display via your app.
