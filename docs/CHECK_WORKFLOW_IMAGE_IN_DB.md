# Check workflow image download/save in the database

Use this to confirm whether the app is downloading the workflow image and saving it correctly when you still see 502.

---

## 1. Recent outputs: cover path vs workflow URL

Run in **Supabase → SQL Editor**:

```sql
SELECT
  id,
  project_id,
  created_at,
  cover_photo_path,
  workflow_metadata->>'generated_image_url' AS generated_image_url,
  CASE
    WHEN cover_photo_path IS NOT NULL THEN 'saved to storage'
    WHEN workflow_metadata->>'generated_image_url' IS NOT NULL AND workflow_metadata->>'generated_image_url' != '' THEN 'had URL but not saved (download/upload failed)'
    ELSE 'no workflow image'
  END AS image_status
FROM diffuse_project_outputs
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 20;
```

**How to read it:**

| What you see | Meaning |
|--------------|--------|
| `cover_photo_path` has a value (e.g. `abc123/def456/cover-xyz-generated.png`) | Image was downloaded and saved. UI should use `/api/project-file`, not proxy. No 502 for that output. |
| `generated_image_url` has a value but `cover_photo_path` is NULL | We had the URL from the webhook but **download or upload failed**. UI falls back to proxy → 502 if Azure fails. Check server logs and steps below. |
| Both NULL / empty | No image in the webhook response for that output, or we didn’t find the URL. |

---

## 2. Storage: does the file exist?

If `cover_photo_path` is set in the query above, the file should exist in Storage.

- In **Supabase → Storage** open the **project-files** bucket.
- The path in the DB is **relative to the bucket** (no `project-files/` prefix).
- Example: if `cover_photo_path` = `8091958d-66fb-4150-a31e-795ff959a732/9a1c81f3-8b63-41af-99b8-a67a1611aabf/cover-abc123-generated.png`, then in the bucket you should see:
  - folder `8091958d-66fb-4150-a31e-795ff959a732/`
  - inside it `9a1c81f3-8b63-41af-99b8-a67a1611aabf/`
  - inside that a file like `cover-abc123-generated.png`.

If the row has `cover_photo_path` but the file is **missing** in Storage, the upload reported success but the object isn’t there (e.g. different bucket or path).

---

## 3. If `generated_image_url` is set but `cover_photo_path` is NULL

Then the failure is in **download** or **upload**. Check:

1. **Server logs** when you ran the workflow. Look in the **same place your API runs**:
   - **Local:** The terminal where you ran `npm run dev`. Right after you click Generate, look for lines starting with `[workflow]`.
   - **Production (e.g. Vercel):** Project → Logs (or Runtime Logs). Filter by the time you ran the workflow.
   Look for:
   - `[workflow] SUPABASE_SERVICE_ROLE_KEY not set` → Set the key in env so storage upload can succeed.
   - `[workflow] Downloading generated image (attempt 1)` → We are trying to download; next line will show success or failure.
   - `[workflow] Generated image fetch failed: 403` (or 404, 500) → **Download** failed (e.g. Azure SAS expired or URL blocked).
   - `[workflow] Generated image upload failed:` → **Upload** to Supabase failed (message/code will say why).
   - `[workflow] Failed to persist generated image (attempt N):` → Exception during download or upload (message will say what broke).

2. **Environment**
   - Is **SUPABASE_SERVICE_ROLE_KEY** set? The workflow uses the admin client for the upload; without it we fall back to the user client and RLS might block the upload.

3. **Azure URL**
   - Open `workflow_metadata->>'generated_image_url'` in the DB (or from the query above). Paste it in a browser (or use `curl`). If it returns 403/404 or “SAS expired”, the URL is no longer valid and the server download will fail the same way; the proxy will then 502 when the UI tries to show it.

---

## 4. One-off: list outputs that have URL but no saved path

Useful to find outputs that are still depending on the proxy (and thus can 502):

```sql
SELECT id, project_id, created_at,
       workflow_metadata->>'generated_image_url' AS url
FROM diffuse_project_outputs
WHERE deleted_at IS NULL
  AND workflow_metadata->>'generated_image_url' IS NOT NULL
  AND workflow_metadata->>'generated_image_url' != ''
  AND cover_photo_path IS NULL
ORDER BY created_at DESC;
```

If you see rows here, those outputs never got a successful download/upload; the UI will try the proxy and you may get 502 if the URL is expired or unreachable.

---

## Summary

- **DB:** Use the first query to see `cover_photo_path` vs `generated_image_url` and `image_status`.
- **Storage:** Confirm the file exists under **project-files** at the path in `cover_photo_path`.
- **502:** If `cover_photo_path` is NULL and `generated_image_url` is set, the problem is download or upload; use server logs + `SUPABASE_SERVICE_ROLE_KEY` + Azure URL check above.
