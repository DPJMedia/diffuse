# n8n Webhook Payload Schema

The workflow API sends a **POST** request with `Content-Type: application/json`. All fields are always present so AI nodes can reliably reference them without existence checks.

## Payload Structure

```json
{
  "project_id": "uuid-string",
  "output_type": "article",
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
