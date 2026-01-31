# n8n Workflow: Cover Photo Subtitle Generation

## Overview

The workflow API now sends `cover_photo_url` in the webhook payload when a project has a cover photo. The n8n workflow must be updated to process this image and generate a subtitle that describes the cover image in relation to the article content.

## API Changes (Completed)

The `/api/workflow` route now includes:
- `cover_photo_url` (string, optional) – A signed URL valid for 1 hour that n8n can use to fetch the cover image
- `photo_credit` (string, optional) – Only sent when the user has set it on the cover photo input (e.g. in the Cover Photo modal). If not set, the field is omitted from the payload so the workflow does not include it in the output

## Required n8n Workflow Updates

### 1. Accept cover_photo_url in webhook payload

The webhook trigger node receives:
```json
{
  "project_id": "uuid",
  "output_type": "article" | "ad",
  "inputs": [...],
  "cover_photo_url": "https://...",  // Optional - present when project has cover photo
  "photo_credit": "Photographer Name"  // Optional - only present when user set it (e.g. in cover photo input)
}
```

**Integration output:** The workflow must return article JSON that includes:
- **photo_caption** – Short description of exactly what is in the cover image, with a slight connection to the article text. Always generate when `cover_photo_url` is present. Used by the integration for "Image caption (optional)".
- **photo_credit** – Only include when provided. If `photo_credit` was passed in the payload and is non-empty, add it to the output; otherwise omit the field (do not include an empty string). Used by the integration for "Photo credit (optional)".

### 2. Update "Article From Projects" and "Ad From Projects" nodes

These are the two processing nodes that handle projects (not recordings). Both need vision AI integration:

#### Option A: Sequential Processing (Recommended)
1. Generate the article/ad content first (existing flow)
2. **If `cover_photo_url` is present:**
   - Add a conditional branch to check for `cover_photo_url`
   - Add a vision-capable AI node (OpenAI GPT-4V, Claude with vision, etc.)
   - Pass both the cover image URL and the generated article content
   - Ask the AI to generate:
     - **subtitle** – Supporting headline that describes the image and relates to the article
     - **photo_caption** – Short description of exactly what is in the image, with a slight connection to the article text (for integration "Image caption")
3. Parse the article JSON and inject `subtitle` and `photo_caption`
4. **Photo credit:** If `body.photo_credit` is present and non-empty, add it to the article JSON; otherwise omit the field
5. Return the complete article JSON

#### Option B: Integrated Processing
1. **If `cover_photo_url` is present:**
   - Include the cover image in the initial article generation prompt
   - Use a vision-capable model from the start
   - Prompt: "Analyze the provided cover image and generate an article with a subtitle that both describes the image and supports the article content"
2. The model generates the complete article JSON including the image-informed subtitle
3. Return the article JSON

### 3. Example n8n Node Structure (Option A)

```
Article From Projects
  ↓
Check if cover_photo_url exists
  ↓ (true)
Vision AI Analysis Node
  - Model: OpenAI GPT-4V or Claude Sonnet with vision
  - Input: cover_photo_url + generated article
  - Prompt: "Analyze this cover image and the article content below. 
            Generate a subtitle (15-25 words) that describes the image 
            and relates it to the article. Format: plain text"
  ↓
Parse & Inject Subtitle
  - Parse existing article JSON
  - Add/update subtitle field
  - Re-stringify JSON
  ↓
Return
```

### 4. Example Vision AI Prompt (subtitle + photo_caption)

Ask the vision model for **two** outputs when a cover image is present:

**Subtitle** – Supporting headline (15–25 words): describes the image and relates to the article.

**Photo caption** – Short description (1–2 sentences) that:
1. Describes exactly what is visible in the image (who/what/where)
2. Has a slight connection to the article text (e.g. why it matters to the story)

Example prompt:
```
You are analyzing a cover image for a news article.

Cover Image: [image from cover_photo_url]

Article Content:
{article.content}

Return exactly two lines:
1. SUBTITLE: [15-25 word supporting headline describing the image and relating to the article]
2. PHOTO_CAPTION: [1-2 sentence description of exactly what is in the image, with a slight connection to the article]
```

Parse the response and inject into the article JSON:
```javascript
const article = JSON.parse(generatedArticleContent);
article.subtitle = parsedSubtitle;
article.photo_caption = parsedPhotoCaption;
// Photo credit: only include when provided in the payload
if (body.photo_credit && body.photo_credit.trim() !== '') {
  article.photo_credit = body.photo_credit.trim();
}
// Do NOT set article.photo_credit when not given – integration expects it omitted
return JSON.stringify(article);
```

### 5. Vision API Options

**OpenAI (GPT-4V):**
- Use the Chat Completions API with vision
- Pass `cover_photo_url` in the message content as an image URL
- Model: `gpt-4-vision-preview` or `gpt-4-turbo`

**Anthropic (Claude):**
- Claude 3 Opus/Sonnet supports vision
- Pass image URL in the messages array
- Model: `claude-3-opus-20240229` or `claude-3-sonnet-20240229`

**Google (Gemini):**
- Gemini Pro Vision supports image analysis
- Pass image via URL or base64

### 6. Fallback Behavior

**If `cover_photo_url` is not present:**
- Continue with existing workflow (no changes needed)
- Generate article/ad without vision analysis
- The `subtitle` field will be generated from text content only (existing behavior)

**If vision API fails:**
- Log the error
- Continue with existing subtitle generation
- Don't block the workflow execution

### 7. Testing

After updating the n8n workflow:

1. **Test with cover photo:**
   - Create a project with a cover photo and content inputs
   - Run the workflow
   - Verify the returned article JSON includes a subtitle that references the image

2. **Test without cover photo:**
   - Create a project with only text/audio inputs (no cover photo)
   - Run the workflow
   - Verify it works as before (subtitle generated from content only)

3. **Test vision API error handling:**
   - Simulate a vision API failure
   - Verify the workflow still completes (fallback behavior)

## Example Article JSON Response

**With photo credit provided:**
```json
{
  "title": "City Council Approves New Infrastructure Plan",
  "subtitle": "Construction crews breaking ground on Main Street renovation project, set to begin next month",
  "photo_caption": "Workers in safety vests operate equipment at the Main Street construction site ahead of the planned renovation.",
  "photo_credit": "Jane Smith / Spring-Ford Press",
  "excerpt": "The city council unanimously voted to approve...",
  "content": "Full article content here...",
  "author": "Diffuse.AI",
  "category": "Local Government",
  "tags": ["infrastructure", "city council", "construction"]
}
```

**Without photo credit (omit the field):**
```json
{
  "title": "City Council Approves New Infrastructure Plan",
  "subtitle": "Construction crews breaking ground on Main Street renovation project, set to begin next month",
  "photo_caption": "Workers in safety vests operate equipment at the Main Street construction site ahead of the planned renovation.",
  "excerpt": "The city council unanimously voted to approve...",
  "content": "Full article content here...",
  "author": "Diffuse.AI",
  "category": "Local Government",
  "tags": ["infrastructure", "city council", "construction"]
}
```

- **subtitle** – Supporting headline from the cover image and article.
- **photo_caption** – Short description of exactly what is in the image, with a slight connection to the article (for integration "Image caption").
- **photo_credit** – Only present when the user provided it; otherwise omit so the integration does not show a credit line.

## Next Steps

1. Update the "Article From Projects" node in n8n with vision AI integration
2. Update the "Ad From Projects" node with the same logic
3. Test both paths with and without cover photos
4. Monitor for any vision API rate limits or errors
5. Consider caching or optimizing vision API calls if needed
