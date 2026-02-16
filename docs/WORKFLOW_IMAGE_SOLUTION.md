# Workflow image: end-to-end solution

## What was going wrong

1. **Browser never talks to Azure**  
   The image URL from the workflow points at `oaidalleapiprodscus.blob.core.windows.net`. The browser was loading that URL directly and getting `net::ERR_NAME_NOT_RESOLVED` (DNS/network can’t reach that host).

2. **Database often empty**  
   Many outputs had empty `workflow_metadata` because the app only looked for the image URL in one place. The n8n response can have the URL in a different node or shape, so we often didn’t find it and never saved it.

3. **Fetch-and-store failed when URL wasn’t found**  
   When we did find the URL, we tried to fetch it on the server and upload to Supabase. If we never found the URL, we never ran that step, so nothing was saved to the bucket.

## What’s in place now

### 1. Image proxy (fixes display for existing outputs with a URL)

- **Route:** `GET /api/proxy-image?url=<encoded-image-url>`
- **Behavior:** The **server** fetches the image from the given URL and streams it back. The **browser** only requests your app (e.g. `yourapp.com/api/proxy-image?url=...`), so it never hits Azure.
- **When it’s used:** For outputs that have `workflow_metadata.generated_image_url` but no `cover_photo_path`, the UI uses this proxy URL instead of the raw Azure URL.
- **Auth:** Requires a logged-in user.
- **If you get 502:** The server also couldn’t reach the image URL (e.g. same DNS/network issue). In that case use base64 (below) so we never depend on fetching that URL.

### 2. Prefer stored path; use proxy only when needed

- **Order of use:**  
  1. User-uploaded cover  
  2. **Stored path** (`cover_photo_path` → `/api/project-file?path=...`)  
  3. **External URL** → **via proxy** (`/api/proxy-image?url=...`)
- So whenever we have a file in your bucket, we serve it from your domain. We only use the proxy when we have a URL but no stored file.

### 3. Base64 image support (best for new runs)

- If the **workflow sends the image as base64** in the webhook response, we:
  - Decode it
  - Upload it to the `project-files` bucket
  - Set `cover_photo_path` on the output
- Then the image is always served from your bucket; we never fetch from Azure.
- **Where we look for base64:** Any of these in the n8n response (anywhere in the payload):
  - `image_base64` (string)
  - `imageBase64` (string)
  - `image_base64_data` (string)
  - `image_data` (string)
  - `image.data` (string)

### 4. Broader URL detection

- We search the **entire** n8n response (all nodes, nested objects/arrays) for a string that looks like an image URL (`url`, `image_url`, `image`, etc.).
- So the image URL can live in any node; we don’t require a single fixed shape.

### 5. Fetch-and-store when we have a URL

- When we find a URL (and no base64), we still try to fetch it on the server and upload to Supabase.
- If that succeeds, we set `cover_photo_path` and the UI uses `/api/project-file` (no proxy needed).

## What you should do

### For outputs that already have `workflow_metadata.generated_image_url`

- **No DB change needed.**  
- Open Output Details again; the app will use `/api/proxy-image?url=...` instead of the raw Azure URL.  
- If the image loads: your server can reach Azure; you’re good.  
- If you get 502: your server can’t reach Azure either; for **new** runs, add base64 (below).

### For new runs: make sure we get the image (URL or base64)

**Option A – We already find the URL**

- After a new Generate, check **server logs** for:
  - `[workflow] Found image URL in n8n response`
  - Then either `[workflow] Generated image saved to storage` or an error.
- If you see “Found image URL” but not “saved to storage”, the server fetch or upload failed (e.g. DNS, timeout). Use Option B.

**Option B – Send the image as base64 from n8n (recommended)**

- In n8n, after the node that produces the image URL (e.g. DALL·E):
  1. Add an **HTTP Request** (or similar) node that **GETs the image URL** and returns the body.
  2. Encode that body as **base64** (e.g. “Convert to Base64” or an expression).
  3. Include that base64 string in the **webhook response** that goes back to your app.
- Name the field one of: `image_base64`, `imageBase64`, `image_base64_data`, `image_data`, or put the string in `image.data`.
- Then our API will:
  - Find the base64
  - Decode and upload to Supabase
  - Set `cover_photo_path`
- The browser will only ever load from your domain; no Azure, no proxy needed for that output.

### If most outputs still have empty `workflow_metadata`

- The webhook response shape may not include the node that has the image URL (or base64).
- In n8n, ensure the **last node** (or the node that “Respond to Webhook” uses) actually receives and outputs:
  - Either the image **URL** (in a field we search: `url`, `image_url`, `image`, etc.), or  
  - The image **base64** (in one of the fields above).
- Check **server logs** after a Generate:  
  `[workflow] No image URL found in n8n response. Top-level keys: ... | Sample: ...`  
  The “Sample” shows what we received; adjust the workflow so the response body includes the URL or base64 in that payload.

## Summary

| Scenario | What happens |
|----------|----------------|
| Output has `cover_photo_path` | Image loaded from `/api/project-file` (your bucket). |
| Output has only `workflow_metadata.generated_image_url` | Image loaded from `/api/proxy-image?url=...` (server fetches Azure, streams to browser). |
| Workflow sends image as base64 | We decode, upload to bucket, set `cover_photo_path`; no Azure fetch. |
| We find URL, server fetch succeeds | We upload to bucket, set `cover_photo_path`. |
| We find URL, server fetch fails | We still set `workflow_metadata.generated_image_url`; UI uses proxy (may get 502 if server can’t reach Azure). |

The browser **never** loads `oaidalleapiprodscus.blob.core.windows.net` directly anymore; it only loads your app (project-file or proxy-image). For the most reliable behavior, have the workflow send the image as **base64** so we always store it in your bucket.
