# Cover image storage and where to read it

**One cover photo per project.** It is stored as a project-level input (type `cover_photo`) and **is now sent to the workflow** for AI analysis. The workflow can use vision AI to analyze the cover photo and generate subtitles that describe the image in relation to the article content. The cover photo is attached to every output when saving and populates every input and output in the project; when the cover is updated, all of them get the same cover.

Cover image data lives in two places: the **project-level input** (source of truth) and **per-output** `cover_photo_path` (copied from that input so each output has the same cover).

## Database and storage

- **Storage bucket:** `project-files` (Supabase Storage)
- **Path format:** `{user_id}/{project_id}/cover-{...}.{ext}` (or similar; the value is whatever is in the DB)

## 1. Project-level cover (input)

Used as the default cover for the whole project and for new outputs when the workflow runs.

| What | Where |
|------|--------|
| **Table** | `diffuse_project_inputs` |
| **Row** | One row per project with `type = 'cover_photo'` |
| **Path column** | `file_path` (TEXT) – full object path in the `project-files` bucket |
| **Optional** | `file_name` for display |

**Example query (project cover path):**

```sql
SELECT file_path, file_name
FROM diffuse_project_inputs
WHERE project_id = :project_id
  AND type = 'cover_photo'
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 1;
```

**Example in code (e.g. integrations):**

- Fetch inputs for the project, then `inputs.find(i => i.type === 'cover_photo')?.file_path`.
- To get a URL: use Supabase Storage `from('project-files').createSignedUrl(file_path, expirySeconds)`.

---

## 2. Per-output cover

Each output (article/ad) can have its own cover. When the workflow creates an output, it copies the project's cover input path into the output. Users can also set or replace the cover on a specific output in the UI.

| What | Where |
|------|--------|
| **Table** | `diffuse_project_outputs` |
| **Column** | `cover_photo_path` (TEXT, nullable) – full object path in `project-files` |

**Example query (output cover path):**

```sql
SELECT id, project_id, cover_photo_path, output_type, content
FROM diffuse_project_outputs
WHERE project_id = :project_id
  AND deleted_at IS NULL;
```

**Fallback for display:**  
If `cover_photo_path` is null, use the project-level cover from `diffuse_project_inputs` (see above). The dashboard does this via `fallbackCoverPhotoPath`.

---

## Workflow behavior

- **Main workflow** (`POST /api/workflow`):  
  - **Now sends** `cover_photo_url` to n8n when a cover photo exists (signed URL, 1 hour expiry).
  - The n8n workflow can use this URL for vision AI analysis to generate subtitles related to the cover image.
  - After creating a new row in `diffuse_project_outputs`, sets `cover_photo_path` from the project's cover photo input: `coverPhotoInput?.file_path ?? null`.
  - See [N8N_COVER_PHOTO_WORKFLOW.md](N8N_COVER_PHOTO_WORKFLOW.md) for details on updating the n8n workflow.

- **Quick workflow** (`POST /api/workflow/quick`):  
  - Creates project + input + output only; no cover photo input or output cover.  
  - Outputs from quick workflow will have `cover_photo_path = null` unless set later.

---

## For integrations

1. **Output cover (preferred for a specific article/ad):**  
   Read `diffuse_project_outputs.cover_photo_path`. If null, fall back to the project cover.

2. **Project cover only:**  
   Read `diffuse_project_inputs.file_path` where `project_id = ?` and `type = 'cover_photo'` and `deleted_at IS NULL`.

3. **Resolving to a URL:**  
   In the app, cover photos are loaded via **`GET /api/project-file?path=<encoded-path>`**, which checks that the user has access to the project (owner or org viewer/editor) and streams the file. Anyone with project access can see the cover. For integrations, use the stored path with the **`project-files`** bucket and Supabase Storage signed URLs (e.g. `createSignedUrl(path, expirySeconds)`), or call the project-file API with the user's auth.
