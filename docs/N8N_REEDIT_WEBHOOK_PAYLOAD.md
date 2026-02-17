# n8n Re-edit Webhook Payload

The re-edit feature sends a **POST** request to the URL configured via `N8N_REEDIT_WEBHOOK_URL`. This is a separate workflow from the main generate workflow.

## Payload sent to your webhook

```json
{
  "output_id": "uuid-of-output",
  "project_id": "uuid-of-project",
  "user_id": "uuid-of-user",
  "existing_content": "<full JSON string of current output content>",
  "comments": "User feedback: make the tone more conversational, shorten the excerpt...",
  "workflow_metadata": {}
}
```

## Expected response

The workflow must return **JSON** with an article structure. Same formats as the main workflow are supported:

- **Nested article:** `{ "article": { "title": "...", "content": "...", ... } }`
- **Array format:** `[ { "revised_prompt": "...", "url": "..." }, { "article": { ... } } ]`
- **Flat:** `{ "title": "...", "content": "...", ... }`

## Merge behavior

When the webhook returns, the app **merges** the new content with the existing output:

- **Preserved (not updated):** Image (cover_photo_path, generated_image_url), image caption, image credit
- **Updated from workflow response:** Title, author, subtitle, excerpt, content, category, tags, suggested_sections, meta_title, meta_description

## Environment variable

Set in `.env.local`:

```
N8N_REEDIT_WEBHOOK_URL=https://your-n8n-instance/webhook/reedit
```
