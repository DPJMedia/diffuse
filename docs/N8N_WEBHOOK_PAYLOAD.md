# n8n Webhook Payload Schema

The workflow API sends a **POST** request with `Content-Type: application/json`. All fields are always present so AI nodes can reliably reference them without existence checks.

## Payload Structure

```json
{
  "project_id": "uuid-string",
  "output_type": "article",
  "mode": "quick",
  "inputs": [...],
  "cover_photo_url": "https://...",
  "photo_credit": "Photo by...",
  "tone": "Professional",
  "length": "Medium",
  "audience": "General reader",
  "comments": "Any extra instructions...",
  "number_of_outputs": 1,
  "article_topics": "Topic A, Topic B, Topic C"
}
```

## Field Reference

| Field | Type | Always Present | Description | Use in AI Nodes |
|-------|------|----------------|-------------|-----------------|
| `project_id` | string | ✅ | UUID of the project | Reference only |
| `output_type` | `"article"` \| `"ad"` | ✅ | Output type; branch workflow logic | Use to select article vs ad prompt |
| `mode` | `"quick"` \| `"refine"` | ✅ | How the user triggered generation. `"quick"` = Quick (article/ad only). `"refine"` = Generate with optional tone, length, audience, comments, number_of_outputs, article_topics. | When `"quick"`: use defaults; when `"refine"`: use `tone`, `length`, `audience`, `comments`, `number_of_outputs`, `article_topics` |
| `inputs` | array | ✅ | Content inputs for generation | Primary source material |
| `cover_photo_url` | string \| null | ✅ | Signed URL to cover image (1hr expiry). `null` if no cover. | Vision AI for subtitle/description |
| `photo_credit` | string \| null | ✅ | User-provided photo credit. `null` if not set. | Include in output metadata |
| `tone` | string \| null | ✅ | e.g. "Professional", "Conversational", "Urgent". `null` if not set. | Add to system/user prompt |
| `length` | string \| null | ✅ | e.g. "Short", "Medium", "Long". `null` if not set. | Add to prompt; control output length |
| `audience` | string \| null | ✅ | e.g. "General reader", "Expert/industry". `null` if not set. | Add to prompt; adjust vocabulary |
| `comments` | string \| null | ✅ | Additional instructions for Diffuse. `null` if not set. | Append to prompt |
| `number_of_outputs` | number | ✅ | `1` = single article. `2`–`10` = split into multiple articles. | When >1: split content by topic, generate N articles |
| `article_topics` | string \| null | ✅ | User-specified topics per article (e.g. "Budget, Safety, Events"). `null` = let AI decide. | When `number_of_outputs` > 1: use to guide topic split |

## Input Item Shape

Each item in `inputs`:

```json
{
  "id": "uuid",
  "type": "text|recording|document|image",
  "content": "Transcribed or extracted text content",
  "file_name": "filename.mp3",
  "image_url": "https://... or null",
  "file_path": "storage/path or null"
}
```

## Usage Examples in n8n

**Branch on mode (quick vs full options):**
```
{{ $json.mode === 'quick' ? 'Use default tone, length, and audience.' : 'Tone: ' + ($json.tone ?? 'neutral') + ', Length: ' + ($json.length ?? 'medium') + ', Audience: ' + ($json.audience ?? 'general reader') }}
```

**Check tone for prompt:**
```
{{ $json.tone !== null ? `Write in a ${$json.tone.toLowerCase()} tone.` : '' }}
```

**Conditional multi-article logic:**
```
{{ $json.number_of_outputs > 1 ? 'Split into ' + $json.number_of_outputs + ' articles.' : 'Generate one article.' }}
```

**Use article topics when provided:**
```
{{ $json.article_topics !== null ? 'Focus on these topics: ' + $json.article_topics : 'Identify topics from the content.' }}
```

**Combine optional fields for AI prompt:**
```
Tone: {{ $json.tone ?? 'neutral' }}
Length: {{ $json.length ?? 'medium' }}
Audience: {{ $json.audience ?? 'general reader' }}
{{ $json.comments ? 'Additional instructions: ' + $json.comments : '' }}
```

## Returning the generated image

Your workflow response can include the generated cover image in one of these ways:

| Method | Response format | Notes |
|--------|------------------|--------|
| **Binary (multipart)** | Response `Content-Type: multipart/form-data` with two parts: one part named `json` (or `payload` or `data`) with the article JSON, and one part named `image` (or `file` or `cover` or `cover_image`) with the raw image file. | n8n fetches the image and attaches it as a file part. The app parses multipart, uploads the image to Supabase, and sets `cover_photo_path`. No Azure fetch from the app. |
| **Base64 in JSON** | In the JSON body: `image_base64` or `imageBase64`, optional `content_type` | n8n fetches the image and sends the bytes as base64 in JSON. The app decodes and uploads to Supabase. Works when the app cannot reach Azure (e.g. DNS ENOTFOUND). |
| **Supabase path** | In the JSON body: `cover_photo_path` or `storage_path` or `supabase_path` | n8n uploads the image to your Supabase `project-files` bucket and returns the path. Path format: `{user_id}/{project_id}/...` (see payload for `user_id`; `project_id` is in the body). |

If you only return `generated_image_url` (Azure blob URL), the app will try to download the image. If the app server cannot resolve the Azure host (e.g. ENOTFOUND), the download will fail. For a reliable setup, use **multipart binary**, **base64**, or **Supabase path**. See **docs/N8N_IMAGE_RELIABLE_SETUP.md** for n8n instructions.
