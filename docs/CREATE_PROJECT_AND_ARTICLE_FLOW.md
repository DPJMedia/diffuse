# Create Project and Article – What Happens and Why It Might Not Work

## What’s supposed to happen

1. **User:** On Recordings, opens a recording (with transcription), clicks **Create Project & Article**.
2. **Frontend:** Sends `POST /api/workflow/quick` with `recording_id`, `recording_title`, `transcription`. Button shows “Creating Project...” until the request finishes.
3. **Backend:**  
   - Calls your n8n webhook with `{ mode: 'quick', recording_title, transcription }`.  
   - Reads the webhook **response body** (must be JSON).  
   - Expects that JSON to contain **project** and **article** data (see below).  
   - If it can’t find that data, it returns an error and **does not** create a project.  
   - If it can, it creates the project, one input (the recording), and one output (the article), then returns `{ project_id, ... }`.
4. **Frontend:** If the API returns success and `project_id`, it closes the modal, refreshes the router, and navigates to `/dashboard/projects/<project_id>?tab=outputs`. If the API returns an error, it shows an **alert** with the error message and does **not** redirect.

So: **if the workflow “completed” and the button stopped loading but you didn’t get redirected and don’t see the output, the API almost certainly returned an error.** The button stops in both success and error cases; only on success do we redirect.

---

## Why you might not get redirected

- **API returned an error (most likely)**  
  Then the frontend shows an **alert** with the message (e.g. “Internal server error”, “Could not read workflow response...”, “Workflow execution failed”). If you didn’t see a redirect, check whether an alert appeared (or was dismissed quickly).

- **API returned 200 but without `project_id`**  
  Then the frontend throws “No project ID returned from workflow” and shows that in an alert; no redirect.

- **Rare:** Success response and redirect logic runs but something else fails (e.g. JS error after response). Easiest check: Network tab for `/api/workflow/quick` – status code and response body.

So the core question is: **what did the API actually return?** That tells you whether the problem is in the workflow response shape or elsewhere.

---

## What the workflow must return (so the app can create the project and open it)

The app reads the **entire webhook response body** as JSON. It then looks for **one** of these shapes.

### Option A – Direct JSON (recommended)

The response body is a **single JSON object** that has:

- **Project (required):**  
  - `project_title` (string)  
  - `project_description` (string)
- **Article (required):** Either  
  - **Nested:** an `article` object with at least `title` and `content`, e.g.  
    `article: { title: "...", subtitle: "...", excerpt: "...", content: "..." }`  
  - **Flat:** or the same fields at the top level: `title`, `content`, etc.

Example (nested article):

```json
{
  "project_title": "My New Project",
  "project_description": "Short description.",
  "article": {
    "title": "Article Headline",
    "subtitle": "...",
    "excerpt": "...",
    "content": "<p>...</p>"
  }
}
```

Other top-level keys (e.g. `image_base64`, `image_prompt`, `suggested_sections`, `category`, `tags`, `meta_title`, `meta_description`) are allowed; the app uses `project_title`, `project_description`, and the `article` object (or flat title/content) to create the project and output.

### Option B – Wrapped by n8n

If n8n puts that object inside another property, the app will unwrap **one** level from:

- `response.json`, or  
- `response.body`, or  
- `response.data`

So for example if the **response body** is:

```json
{ "json": { "project_title": "...", "project_description": "...", "article": { "title": "...", "content": "..." } } }
```

the app will use the inner object. If your workflow uses “Respond with: First Incoming Item” and that item’s payload is under `json`, this should work.

If the payload is nested deeper (e.g. `response.result.data`) or under a different key, the app does **not** unwrap it; you’d need to either change the workflow so the response body is Option A (or Option B with `json`/`body`/`data`) or change the app to look at your shape.

---

## What can go wrong (and what you’ll see)

| What’s wrong | API response | What you see |
|--------------|--------------|---------------|
| Workflow returns non-JSON or empty body | 500 “Workflow execution failed” or “Workflow returned empty response” | Alert, no redirect |
| Workflow returns JSON but without `project_title` / `article` (or equivalent) in a place the app checks | 502 “Could not read workflow response...” | Alert, no redirect |
| Workflow returns valid shape but DB/create fails | 500 “Failed to create project” / “Failed to create input” / “Failed to create output” | Alert, no redirect |
| Workflow and DB succeed | 200 `{ project_id: "..." }` | Modal closes, **redirect** to project with Outputs tab |

So: **if the button stops loading and you don’t get redirected, the API did not return 200 with a valid `project_id`.** The alert text (or Network tab) tells you which of the above happened.

---

## What to do

1. **Run “Create Project & Article” again and watch for an alert**  
   If one appears, that message is the reason the app didn’t create the project or redirect (e.g. “Could not read workflow response...”, “Internal server error”, “Workflow execution failed”).

2. **Check the Network tab (F12 → Network)**  
   - Find the request to **`/api/workflow/quick`**.  
   - Check **Status** (200 vs 4xx/5xx).  
   - Open the response **body**.  
   - If it’s 200 and has `project_id`, the bug is on the frontend (e.g. redirect). If it’s an error, the body’s `error` field explains what the server didn’t like.

3. **Check server logs**  
   When the quick workflow runs, the server logs:
   - “n8n raw response (first 500 chars): …”
   - If parsing fails: “n8n response top-level keys: …”
   That shows exactly what the app received and why it might have rejected it.

4. **Match the workflow response to Option A or B**  
   - Ensure the **webhook response body** is JSON.  
   - Ensure it has `project_title`, `project_description`, and either an `article` object (with `title` and `content`) or flat `title`/`content`.  
   - If you use a wrapper, use exactly one level and put the payload in `json`, `body`, or `data`.

5. **No workflow changes needed for redirect itself**  
   Redirect is entirely driven by the API response: success + `project_id` → redirect; anything else → show alert, no redirect. So you don’t “change something in the workflow” to “enable redirect”; you change the workflow so its **response** matches what the app expects, and then the app will create the project and redirect.

---

## Summary

- **Workflow “completed” + button stopped loading but no redirect** → The app received an **error** from `/api/workflow/quick` (or a success without `project_id`). An alert should have appeared.
- **Fix:** Make the workflow’s **webhook response** a single JSON object (or one level wrapped in `json`/`body`/`data`) with `project_title`, `project_description`, and `article` (with `title` and `content`). Then check Network tab and server logs to confirm the API returns 200 and `project_id` and that the frontend redirect runs.
