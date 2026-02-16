# Why diffuse_project_outputs don’t get “updated” every run

## What happens each time you run Generate

Each Generate run does **one INSERT** and **at most one UPDATE** on `diffuse_project_outputs`:

1. **INSERT (always)**  
   We insert a **new** row with:
   - `content` = article from workflow
   - `workflow_status` = `'completed'`
   - `cover_photo_path` = project cover path (from DB) or null
   - `workflow_metadata` = `{ generated_image_url: "..." }` **only if** we found an image URL in the n8n response; otherwise this column is not set (so it stays default, often `{}`)

2. **UPDATE (only sometimes)**  
   After the insert, we **only** update that **same new row** to set `cover_photo_path` (and `updated_at`) when:
   - We have **image bytes** (base64 from workflow **or** a successful fetch from the image URL), and
   - We **successfully upload** that image to the `project-files` bucket.

So:

- **Every run creates a new output row** (INSERT). We never update an *existing* output from a previous run.
- **The only UPDATE we do** is on the row we just inserted, and only to set `cover_photo_path` (and `updated_at`) when we successfully save the generated image.

## Why it looks like “outputs aren’t getting updated”

### 1. **`workflow_metadata` stays empty**

- We set `workflow_metadata` **on INSERT** only when we find an image URL in the n8n response.
- If we don’t find a URL (wrong shape, different node, etc.), we don’t set `workflow_metadata`, so it stays `{}`.
- So “not updated” here really means: **we never found the URL on that run**, so we had nothing to put in `workflow_metadata` at insert time.

### 2. **`cover_photo_path` never changes from project cover**

- On INSERT we set `cover_photo_path` to the project’s cover path (or null).
- We then run the **UPDATE** only when we have a generated image (base64 or URL fetch) and the upload succeeds.
- If we **don’t find** image URL or base64 → we don’t upload → we **don’t run the UPDATE** → `cover_photo_path` stays as set on insert.
- If we **find** the URL but **fetch or upload fails** → we don’t run the UPDATE → `cover_photo_path` again stays as on insert.

So “outputs not getting updated” often means: **either we didn’t find the image in the workflow response, or we found it but couldn’t upload it**, so the UPDATE step is skipped.

### 3. **We never update old outputs**

- We only update the **brand‑new** row we just inserted (to set `cover_photo_path` after a successful image upload).
- We **never** update outputs from previous runs. Each Generate = one new output row.

## How to confirm what’s happening

After a Generate, check **server logs** for:

| Log message | Meaning |
|-------------|--------|
| `[workflow] Found image URL in n8n response` | We found a URL; we’ll try to fetch and upload. |
| `[workflow] Found image_base64 in n8n response` | We found base64; we’ll upload. |
| `[workflow] Generated image saved to storage; output row updated: ...` | Upload and **UPDATE** both succeeded; that new row has `cover_photo_path` set. |
| `[workflow] No image URL or base64 in workflow response; output row not updated` | We didn’t find image data, so no upload and **no UPDATE**. |
| `[workflow] Had image URL/base64 but upload failed; output row not updated` | We found image data but fetch or upload failed; **no UPDATE**. |
| `[workflow] DB update failed (cover_photo_path): ...` | We tried to UPDATE but the DB call failed (e.g. RLS). |

So: **outputs “not getting updated” every time** = either we’re not finding the image (URL/base64) in the response, or we find it but upload/update fails. The logs above tell you which case it is.
