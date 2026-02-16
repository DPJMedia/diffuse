# Reliable workflow image: why Azure URL fails and what to do

## What’s going wrong

Your logs show:

```text
getaddrinfo ENOTFOUND oaidalleapiprodscus.blob.core.windows.net
```

**ENOTFOUND** means the machine running the Next.js app (your Mac or your host) **cannot resolve that Azure hostname** (DNS). So:

- The app **never** reaches Azure; the request fails before a connection is made.
- This is an environment/network limitation (DNS, firewall, or VPN), not an Azure or SAS issue.
- As long as the app server cannot resolve that host, **any** attempt by the app to fetch the image from the Azure URL will fail.

So the fix is: **the app must not fetch from Azure.** The image must reach the app in a way that doesn’t require the app to call Azure.

---

## What works 100%: three options

All options rely on **n8n** (which can reach Azure) to get the image; the app never fetches from Azure.

### Option A: n8n sends the image as binary in a multipart response

- n8n fetches the image from the Azure URL (HTTP Request node).
- n8n responds to the webhook with **Content-Type: multipart/form-data** and two parts:
  - **`json`** (or `payload` or `data`): the article + metadata as JSON (string or file).
  - **`image`** (or `file` or `cover` or `cover_image`): the raw image file (binary).
- The Diffuse API parses the multipart response, uploads the image part to Supabase, and sets `cover_photo_path`. Display is unchanged.

### Option B: n8n sends the image as base64 in JSON (recommended if you prefer JSON)

- n8n gets the image URL from DALL·E (or similar).
- **Inside n8n**, use an HTTP Request (or similar) node to **fetch the image** from that URL. n8n’s runtime can resolve Azure DNS.
- Convert the response body to **base64** (e.g. “Convert to File” or expression to get base64).
- In the node that **responds to the webhook** (or the final payload to Diffuse), include the image in the JSON, e.g.:
  - `image_base64`: `<base64 string>`
  - optionally `content_type`: `image/png`
- The Diffuse API **does not call Azure**. It receives the webhook body, finds `image_base64`, decodes it, uploads to Supabase, and sets `cover_photo_path`.

**Response shape we accept (one of these):**

- Top-level or inside your usual object:
  - `image_base64` or `imageBase64` or `image_base64_data` or `image_data` = base64 string (raw, no `data:image/...;base64,` prefix).
- Optional: `content_type` or `image_mime_type` = `image/png` (or `image/jpeg`, etc.).

Example (inside your existing array/object):

```json
{
  "article": { "title": "...", "content": "..." },
  "generated_image_url": "https://...",
  "image_base64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "content_type": "image/png"
}
```

We already look for these keys and, when present, decode and upload to Supabase and set `cover_photo_path`. No fetch from our server to Azure.

---

### Option C: n8n uploads to Supabase and sends the path

- n8n fetches the image from the Azure URL (same as above).
- In n8n, use the **Supabase** node (or Supabase Storage REST API) to **upload** the file to your `project-files` bucket.
- Path format we expect: `{user_id}/{project_id}/cover-{output_id}-generated.png` (or similar). You have `user_id` and `project_id` in the webhook body we send you; `output_id` you don’t have until we create the output, so usually **Option A is simpler** (we create the output, then we upload and set the path).
- If you prefer this flow, n8n can upload to a path like `{user_id}/{project_id}/generated-{timestamp}.png` and return that path in the webhook response under a key we recognize: `cover_photo_path` or `storage_path` or `supabase_path` (we accept any of those). Then we set `cover_photo_path` on the output to that path and **do not** fetch from Azure.

---

## n8n steps for Option A (base64) – concrete

1. After the node that has the image URL (e.g. from DALL·E):
   - Add an **HTTP Request** node:
     - Method: GET  
     - URL: `{{ $json.generated_image_url }}` (or wherever the URL lives).
     - Response format: File (or Binary).
   - Add a node that converts the binary response to base64 (e.g. “Convert to File” / “Binary to base64”, or a Code node that reads the binary and outputs base64).
2. In the node that builds the **final webhook response** (e.g. “Respond to Webhook” or “Set” that merges everything):
   - Include in the JSON body:
     - `image_base64`: the base64 string from the step above.
     - (optional) `content_type`: `image/png`.
   - Keep your existing `article`, `generated_image_url`, etc.; we’ll still use them. We’ll also look for `image_base64` and, if present, use it to save the image and set `cover_photo_path`.

3. Deploy/save the workflow and run a test. The Diffuse app will:
   - Receive the response.
   - Find `image_base64`, decode it, upload to Supabase, set `cover_photo_path`.
   - No request from the app to Azure, so ENOTFOUND cannot happen.

---

## Summary

| Approach | Who fetches from Azure? | Who uploads to Supabase? | Works when app has ENOTFOUND? |
|----------|--------------------------|---------------------------|-------------------------------|
| App fetches URL from webhook | Next.js app | Next.js app | No (your case) |
| n8n sends multipart binary (Option A) | n8n | Next.js app | Yes |
| n8n sends base64 in JSON (Option B) | n8n | Next.js app | Yes |
| n8n uploads to Supabase (Option C) | n8n | n8n | Yes |

The reliable solution is **Option A (multipart binary)**, **Option B (base64 in JSON)**, or **Option C (n8n → Supabase)**. The app supports all three; change the n8n workflow so the image is sent as multipart, base64, or uploaded by n8n with the path returned.
