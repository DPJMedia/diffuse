# Workflow-generated image: what to verify

Use this checklist to find why the cover image isn’t showing. The UI now **prefers the stored path** over the external URL, so once the image is in your bucket it should load from your domain.

---

## 1. Bug fix applied

**Priority order for cover image:**

- **Before (bug):** UI used `workflow_metadata.generated_image_url` (Azure) before `cover_photo_path` (our bucket), so it kept trying the Azure URL and hit ERR_NAME_NOT_RESOLVED.
- **After (fix):** UI uses `cover_photo_path` first, then `generated_image_url`. Stored images load from `/api/project-file`.

Make sure your app has the latest `OutputDetailModal` where:

`coverPhotoUrl = uploadedPath ?? effectiveCoverPath ?? generatedImageUrl`

(Stored path before external URL.)

---

## 2. Verify after a NEW generate

Run a **new** workflow that returns an image (don’t rely on old outputs). Then check the following.

### A. Database row

In Supabase → **Table Editor** → `diffuse_project_outputs`:

- Find the row for the output you just created (sort by `created_at` desc).
- Check:
  - **`cover_photo_path`**  
    - If it’s set (e.g. `user-uuid/project-uuid/cover-output-uuid-generated.png`), the server fetched the image and uploaded it. The UI should use this and load from `/api/project-file`.  
    - If it’s **null**, either the workflow didn’t return an image URL, or fetch/upload failed (see server logs).
  - **`workflow_metadata`**  
    - If it’s `{}` or null, the workflow response might not be in the expected shape.  
    - If it has `generated_image_url`, the backend saw a URL; if `cover_photo_path` is still null, fetch or upload failed.

### B. Server logs (where the app runs)

When you run **Generate**, look for these lines:

- **`[workflow] Fetching generated image from workflow URL (host: …)`**  
  - If you see this, the backend received an image URL and is trying to fetch it.
- **`[workflow] Generated image saved to storage: …`**  
  - Fetch and upload succeeded; that path should be in `cover_photo_path`.
- **`[workflow] Generated image fetch failed: …`**  
  - HTTP error from the image URL (e.g. 403, 404). Check the URL and any auth/SAS.
- **`[workflow] Failed to persist generated image to storage: …`**  
  - Fetch threw (e.g. timeout, ERR_NAME_NOT_RESOLVED on the server) or upload failed. Check the exact error.
- **`[workflow] No generated image URL in workflow response`**  
  - The backend didn’t find a URL in the workflow payload (see “Workflow response shape” below).

Where to see logs:

- **Local:** Terminal where you run `npm run dev`.
- **Vercel:** Project → Logs (or Deployments → … → View Function Logs for the workflow API).

### C. Network tab (browser)

With the **Output Details** modal open for that output:

1. Open DevTools → **Network**.
2. Reload or open the modal again.
3. Look for a request to **`/api/project-file?path=...`** (your domain).

- If you see it and it returns **200** with an image body: the image is served; the problem may be layout/CSS or a different output.
- If you see **403/404**: path or permissions (see “project-file” below).
- If you **don’t** see `/api/project-file` and instead see a request to `oaidalleapiprodscus.blob.core.windows.net` (or similar): the UI is still using the external URL. Then either:
  - `cover_photo_path` is null for that output (fetch/upload failed), or
  - The front end isn’t using the updated priority (stored path first).

### D. Workflow response shape (n8n)

The backend expects the workflow (n8n) to return JSON that contains the image URL in one of these shapes:

- **Array:** `[ { "url": "https://..." }, { "article": { ... } } ]`  
  - Or `image_url` / `image` instead of `url` in the first object.
- **Single object:** `{ "url": "https://...", "article": { ... } }`  
  - Or `image_url` / `image` instead of `url`.

The URL can be without protocol; the backend normalizes it to `https://`.

To verify:

- In n8n, check the **last node’s output** that holds the image URL.
- Optionally log the **raw response** in the workflow API (e.g. `console.log(JSON.stringify(n8nResult).slice(0, 500))`) and confirm the URL is present in that structure.

If the shape is different (e.g. URL inside a nested `output` or different key), we need to adjust the extraction in `app/api/workflow/route.ts` to match your workflow.

### E. project-file API (storage + RLS)

If `cover_photo_path` is set but the image still doesn’t show:

1. **Direct test:**  
   Open in the browser (while logged in):  
   `https://your-app.com/api/project-file?path=USER_ID/PROJECT_ID/cover-OUTPUT_ID-generated.png`  
   (replace USER_ID, PROJECT_ID, OUTPUT_ID with the values for that output).  
   - 200 + image → API and storage are OK; issue is likely UI or which output is shown.  
   - 403 → RLS or project access (see below).  
   - 404 → Path wrong or file missing in bucket.

2. **Storage:**  
   Supabase → **Storage** → bucket **project-files** → navigate to `user_id/project_id/` and confirm a file like `cover-<output-id>-generated.png` exists.

3. **RLS / access:**  
   - Logged-in user must have access to the project (owner or org member with visibility).  
   - If you use **service role** in `/api/project-file`, it bypasses storage RLS; then 403 is more likely from your app’s `verifyProjectOwnership` (e.g. wrong project or user).

---

## 3. Summary table

| What you see | Likely cause | What to do |
|--------------|--------------|------------|
| `cover_photo_path` is null | No URL in response, or fetch/upload failed | Check server logs and workflow response shape; fix extraction or fix fetch/upload. |
| `cover_photo_path` set, no `/api/project-file` request | UI still using external URL | Ensure front end uses stored path first (see §1). |
| `cover_photo_path` set, `/api/project-file` 404 | File not in bucket or wrong path | Check Storage bucket and path; re-run generate and check logs for “[workflow] Generated image saved to storage”. |
| `cover_photo_path` set, `/api/project-file` 403 | Project/storage permissions | Check RLS, service role, and `verifyProjectOwnership`. |
| Logs: “No generated image URL” | Workflow payload shape | Inspect n8n output and adapt extraction in workflow API. |
| Logs: “Generated image fetch failed” or “Failed to persist” | Server can’t fetch URL or upload failed | Check exact error in logs; fix URL, network, or storage policy. |

---

## 4. Info that helps to debug

If it still doesn’t work, sharing these helps narrow it down:

1. **One row from `diffuse_project_outputs`** (after a new generate): `id`, `cover_photo_path`, `workflow_metadata` (redact if needed).
2. **Exact server log lines** around the next Generate (from “[workflow]” or “Failed to persist”).
3. **Screenshot or copy of Network** for the output modal: one request that should be the cover image (URL + status code).
4. **n8n:** Last node’s output structure (or a sample JSON) that contains the image URL.

With that, we can target the next fix (e.g. extraction logic, path format, or permissions).
