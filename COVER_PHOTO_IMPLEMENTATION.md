# Cover Photo Subtitle Feature - Implementation Summary

## Overview

The workflow API now sends cover photos to n8n for AI vision analysis. When a project has a cover photo, the workflow generates a signed URL and includes it in the payload, allowing n8n to analyze the image and generate subtitles that describe the cover photo in relation to the article content.

## Changes Made

### 1. API Route Changes (`app/api/workflow/route.ts`)

**Import addition:**
- Added `createAdminClient` import from `@/lib/supabase/server`

**New functionality (lines 159-172):**
- Generate signed URL for cover photo when present
- Use admin client (or fallback to user client) to create signed URLs
- 1 hour expiry for the signed URL
- Graceful error handling if signed URL generation fails

**Payload update (line 186):**
- Added `cover_photo_url` field to n8n payload
- Only included when a cover photo exists (undefined otherwise)

**Updated comments:**
- Clarified that cover photo is now sent to workflow
- Updated comment to explain vision AI subtitle generation capability

### 2. Documentation Created

**New file: `docs/N8N_COVER_PHOTO_WORKFLOW.md`**
- Comprehensive guide for updating the n8n workflow
- Instructions for "Article From Projects" and "Ad From Projects" nodes
- Two implementation options: Sequential and Integrated processing
- Example prompts for vision AI
- Fallback behavior guidelines
- Testing procedures

### 3. Documentation Updated

**Updated file: `docs/COVER_IMAGE_STORAGE.md`**
- Changed description to reflect that cover photo is now sent to workflow
- Updated "Workflow behavior" section to document the new `cover_photo_url` field
- Added reference to the n8n workflow guide

## What Still Needs to be Done

### n8n Workflow Updates (External - Not in Codebase)

The n8n workflow must be updated to:

1. **Accept the new field:** `cover_photo_url` in webhook payload
2. **Update "Article From Projects" node:**
   - Add conditional check for `cover_photo_url`
   - Add vision AI node (OpenAI GPT-4V, Claude with vision, or similar)
   - Generate subtitle from image + article content
   - Inject subtitle into article JSON

3. **Update "Ad From Projects" node:**
   - Same changes as "Article From Projects"

4. **Test both paths:**
   - With cover photo (vision AI generates subtitle)
   - Without cover photo (existing behavior)

### No Database Changes Required

The subtitle field already exists in the article JSON structure stored in `diffuse_project_outputs.content`. No schema migration is needed unless you want a separate `cover_subtitle` column (optional enhancement documented in the n8n guide).

## Payload Structure

### Before (old payload):
```json
{
  "project_id": "uuid",
  "output_type": "article",
  "inputs": [...]
}
```

### After (new payload):
```json
{
  "project_id": "uuid",
  "output_type": "article",
  "inputs": [...],
  "cover_photo_url": "https://xxx.supabase.co/storage/v1/object/sign/project-files/..." // Optional
}
```

## Testing

Once the n8n workflow is updated:

1. **Test with cover photo:**
   - Create a project with a cover photo and content
   - Click "Generate Article" or "Generate Ad"
   - Verify the article JSON includes a subtitle referencing the image

2. **Test without cover photo:**
   - Create a project with only text/audio inputs
   - Generate output
   - Verify it works as before (subtitle from text content only)

3. **Test error handling:**
   - Check logs if signed URL generation fails
   - Verify workflow continues even if vision AI fails

## Files Modified

- `app/api/workflow/route.ts` - API changes to include cover_photo_url
- `docs/COVER_IMAGE_STORAGE.md` - Updated documentation
- `docs/N8N_COVER_PHOTO_WORKFLOW.md` - New n8n implementation guide (created)

## Next Steps

1. ✅ API changes complete (this PR)
2. ⏳ Update n8n workflow (see `docs/N8N_COVER_PHOTO_WORKFLOW.md`)
3. ⏳ Test both "Article From Projects" and "Ad From Projects" paths
4. ⏳ Monitor for vision API rate limits or errors in production
