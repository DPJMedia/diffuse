# Why the URL works in the browser but not in the app — and how to fix it

## Why pasting the image URL in the browser works

When you paste `https://oaidalleapiprodscus.blob.core.windows.net/...` in your browser:

- The **browser** makes the request directly to Azure.
- Your machine’s DNS and network can reach that host.
- There’s no app origin, CORS, or CSP involved — it’s a top-level navigation.

So it often works when you paste it.

## Why the same URL fails in the app

In the app we tried to use that URL as the `src` of an `<img>`.

- The **browser** still makes the request to Azure, but from the **page’s origin** (e.g. your app or localhost).
- Many users (and sometimes your server) see **`net::ERR_NAME_NOT_RESOLVED`**: DNS can’t resolve `oaidalleapiprodscus.blob.core.windows.net`. That can be due to:
  - Different network (e.g. VPN, corporate DNS, different WiFi).
  - Different environment (e.g. Vercel server vs your laptop).
- So “copy/paste works in browser” can be true on your machine, while the app (or server) is in a context where that hostname doesn’t resolve. It’s not that the URL is wrong; it’s that **who** is loading it (and from where) matters.

So the robust approach is: **don’t depend on the browser (or our server) being able to load Azure**. Get the image into **our** storage (Supabase) and serve it from there.

---

## Three ways to get the image to display

### Option 1: Proxy (already in place)

- We **receive** the Azure URL in `workflow_metadata.generated_image_url`.
- The UI loads the image via **our** API: `/api/proxy-image?url=...`.
- **Our server** fetches the image from Azure and streams it to the browser.
- **Works when:** Our server can resolve and fetch the Azure URL (often works on Vercel).
- **Fails when:** Our server also gets ERR_NAME_NOT_RESOLVED or 502; then use Option 2 or 3.

### Option 2: Workflow sends image as base64 (already supported)

- In n8n, after the node that has the image URL:
  1. **HTTP Request** node: GET the image URL (n8n runs on its own infra and can often reach Azure).
  2. **Code** or **Convert to Base64** (or similar): get the response body as base64.
  3. In the webhook response, include that string in a field we recognize:  
     `image_base64`, `imageBase64`, `image_base64_data`, `image_data`, or `image.data`.
- Our API finds the base64, decodes it, uploads to Supabase `project-files`, and sets `cover_photo_path`.
- **No Azure URL is ever loaded by the browser or our server** — we only receive bytes and store them.

### Option 3: n8n uploads to Supabase and returns the path (recommended)

- n8n **uploads the image to your Supabase bucket** and returns the **storage path** in the webhook response.
- Our API uses that path as `cover_photo_path` and does **no** fetch from Azure.
- The app then serves the image from **our** domain via `/api/project-file?path=...`.

**Why this is reliable:**

- n8n runs in an environment (e.g. n8n cloud) that can usually reach the image URL.
- Only n8n talks to Azure; the app and the browser only talk to Supabase and your API.
- No proxy, no base64 in the response — just a path we already know how to serve.

---

## Option 3 step-by-step: n8n uploads to Supabase

### 1. What we send to n8n (already in the payload)

- `project_id`
- **`user_id`** (we added this so n8n can build the storage path)
- `inputs`, `output_type`, etc.

### 2. Path format we expect

Files in the `project-files` bucket must use paths like:

```text
{user_id}/{project_id}/generated-{unique}.png
```

Example:

```text
a1b2c3d4-e5f6-7890-abcd-ef1234567890/f9e8d7c6-b5a4-3210-fedc-ba0987654321/generated-1739123456789.png
```

We **only** accept paths that match: **two UUIDs** (user_id, project_id) followed by a slash and a filename (no `..`, no `http`). So n8n must build the path from `user_id` and `project_id` we send.

### 3. In n8n: add nodes after the image URL is produced

1. **HTTP Request** (or similar)  
   - Method: GET  
   - URL: the image URL from the previous node (e.g. from DALL·E / image gen node).

2. **Supabase** node (or **HTTP Request** to Supabase Storage API)  
   - **Upload file** to bucket `project-files`.  
   - **File path:**  
     `{{ $json.user_id }}/{{ $json.project_id }}/generated-{{ $now.toMillis() }}.png`  
     (use the `user_id` and `project_id` from the webhook body; you may need to carry them through from the trigger.)
   - **File content:** binary/body from the HTTP Request step above.

   If you use **HTTP Request** to Supabase instead of the Supabase node:
   - POST to `https://<project-ref>.supabase.co/storage/v1/object/project-files/{path}`  
   - Headers: `Authorization: Bearer <service_role or anon key>`, `Content-Type: image/png`  
   - Body: binary from the GET image step.

3. **Respond to Webhook** (or whatever returns the final payload)  
   Include the **storage path** in the response. We look for any of these keys (anywhere in the payload):

   - `cover_photo_path`
   - `storage_path`
   - `supabase_path`
   - `image_storage_path`
   - `image_path`

   The **value** must be the full path you used when uploading, e.g.:

   ```text
   a1b2c3d4-e5f6-7890-abcd-ef1234567890/f9e8d7c6-b5a4-3210-fedc-ba0987654321/generated-1739123456789.png
   ```

### 4. What our API does

- We search the webhook response for a string that looks like that path (two UUIDs, slash, filename).
- If we find it, we set **`cover_photo_path`** to that value on the new output row.
- We **do not** fetch the image from Azure or upload it ourselves; we trust that n8n already uploaded it to `project-files`.
- The UI then loads the image via `/api/project-file?path=...` and it displays.

### 5. n8n credentials

- To upload to Supabase Storage, n8n needs access to your project (e.g. **Supabase** node with credentials, or **HTTP Request** with an API key).
- Use the **service role** key only in a secure server-side context (e.g. n8n backend). Never expose it in the front end.

---

## Summary

| Question | Answer |
|----------|--------|
| Why does paste in browser work but the app doesn’t? | Different context (DNS/network). The app (and sometimes our server) can’t resolve or load the Azure URL. |
| Can we “just display” the URL we receive? | We can try via the proxy; if the server can’t reach Azure, we need the image in our storage (base64 or n8n → Supabase). |
| Easiest robust approach? | Have n8n upload the image to Supabase and return the storage path; we use it as `cover_photo_path` and serve from our domain. |
| Do we need a code node? | Not for “right format” — we accept URL, base64, or storage path. A code node can help in n8n to build the path or convert to base64 if you prefer Option 2. |

So: **receiving** the URL is fine; **displaying** it reliably means not depending on the browser or our server loading Azure. Having n8n upload to Supabase and return the path (Option 3) is the most straightforward way to get a solution that works everywhere.
