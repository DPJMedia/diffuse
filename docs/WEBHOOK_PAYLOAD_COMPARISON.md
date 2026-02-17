# Webhook payload: Create Project & Article vs Generate / Quick

Same n8n webhook URL is used for both. The **payload** and **response expectations** differ.

---

## 1. "Create Project & Article" (recordings page)

**Trigger:** User is on Recordings, opens a recording, clicks **Create Project & Article**.

**API:** `POST /api/workflow/quick`  
**Body to API:** `{ recording_id, recording_title, transcription }`

**Payload sent to n8n webhook:**

```json
{
  "mode": "quick",
  "recording_id": "uuid-of-the-recording",
  "recording_title": "Recording",
  "transcription": "Full transcription text...",
  "inputs": [
    {
      "id": "uuid-of-the-recording",
      "type": "recording",
      "content": "Full transcription text...",
      "file_name": "Recording",
      "file_path": null,
      "image_url": null
    }
  ]
}
```

- **`inputs`** is the **single source** for this project and article: the recording the user clicked “Create Project and Article” on. The workflow should use `inputs[0].content` (and optionally `inputs[0].file_name`) as the sole source material. Same structure as the main workflow so you can reference `inputs` consistently.
- **`recording_id`** identifies which recording this is (same as `inputs[0].id`).
- No `project_id`, no cover photo, no tone/length/audience.

**Expected n8n response:** JSON containing **project** + **article** (see `app/api/workflow/quick/route.ts` and `QuickWorkflowResponse`). At minimum: `project_title`, `project_description`, `title`, `content`.

---

## 2. "Generate" or "Quick" (project page)

**Trigger:** User is on a project, has inputs, clicks **Generate** (Quick or Refine).

**API:** `POST /api/workflow`  
**Body to API:** `{ project_id, output_type, mode?, tone?, length?, audience?, comments?, number_of_outputs?, article_topics? }`  
The server then loads that project’s inputs and cover photo and builds the webhook payload.

**Payload sent to n8n webhook:**

```json
{
  "project_id": "uuid",
  "user_id": "uuid",
  "output_type": "article",
  "mode": "quick",
  "inputs": [
    {
      "id": "uuid",
      "type": "text",
      "content": "...",
      "file_name": "Untitled",
      "image_url": null,
      "file_path": null
    }
  ],
  "cover_photo_url": "https://...",
  "photo_credit": null,
  "tone": null,
  "length": null,
  "audience": null,
  "comments": null,
  "number_of_outputs": 1,
  "article_topics": null
}
```

- `mode` is `"quick"` or `"refine"` depending on which button was used.
- `inputs` is built from `diffuse_project_inputs` (content inputs only; cover photo is separate).
- `cover_photo_url` is a signed URL when the project has a cover photo.
- Optional fields (`tone`, `length`, etc.) are set when the user used Refine options.

**Expected n8n response:** Article content (and optionally image). See `docs/N8N_WEBHOOK_PAYLOAD.md` and `app/api/workflow/route.ts`.

---

## Side-by-side

| Field              | Create Project & Article | Generate / Quick (project page) |
|--------------------|--------------------------|----------------------------------|
| `project_id`       | ❌ not sent              | ✅ sent                           |
| `user_id`          | ❌ not sent              | ✅ sent                           |
| `output_type`      | ❌ not sent              | ✅ `"article"` or `"ad"`          |
| `mode`             | ✅ `"quick"`             | ✅ `"quick"` or `"refine"`        |
| `cover_photo_url`  | ❌ not sent              | ✅ or null                        |
| `photo_credit`     | ❌ not sent              | ✅ or null                        |
| `tone`             | ❌ not sent              | ✅ or null                        |
| `length`           | ❌ not sent              | ✅ or null                        |
| `audience`         | ❌ not sent              | ✅ or null                        |
| `comments`         | ❌ not sent              | ✅ or null                        |
| `number_of_outputs`| ❌ not sent              | ✅ 1 or 2–10                      |
| `article_topics`   | ❌ not sent              | ✅ or null                        |
| `recording_id`     | ✅ sent                  | ❌ not sent                       |
| `recording_title`  | ✅ sent                  | ❌ not sent                       |
| `transcription`    | ✅ sent                  | ❌ not sent (content is in `inputs`) |
| `inputs`           | ✅ 1 item (this recording as source) | ✅ array of project inputs     |

In n8n you can branch on: **presence of `project_id`** (project-page generate) vs **absence of `project_id`** with **`inputs` length 1 and type `recording`** (Create Project & Article). For Create Project & Article, use **`inputs[0].content`** as the sole source for the project and article.
