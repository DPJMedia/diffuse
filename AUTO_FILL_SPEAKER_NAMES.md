# Auto-Fill Speaker Names Implementation

## Overview
Successfully implemented automatic speaker name detection and pre-filling using AssemblyAI's Entity Detection feature.

## How It Works

### 1. **Name Detection (Backend)**
- When audio is transcribed, AssemblyAI detects person names mentioned in the audio (via `entity_detection: true`)
- The system matches these names to speaker labels based on timestamps (who was speaking when the name was mentioned)
- Detected names are stored in the `detected_speaker_names` column as JSON: `{"A": "John Doe", "B": "Jane Smith"}`

### 2. **Automatic Display (Frontend)**
- **Transcript Display**: Detected names automatically appear in the transcript BEFORE the user clicks "Identify Speakers"
  - Priority: Custom names (speaker_map) → Detected names → Default "Speaker 1, 2, 3..."
- **Identify Speakers Button**: Shows progress as "X/Y" format
  - X = number of speakers with custom names in speaker_map (confirmed by user)
  - Y = total unique speakers detected
  - Example: "(2/4)" means 2 out of 4 speakers have been identified

### 3. **Pre-filled Identification Form**
When user clicks "Identify Speakers":
- Name field is automatically pre-filled with detected name (if available)
- User can keep the auto-filled name or change it
- User can add position/title
- Clicking Next/Confirm saves to speaker_map and increments the count

## Files Modified

### Backend Changes
1. **`app/api/transcribe/route.ts`**
   - Added `entity_detection: true` to AssemblyAI requests
   - Created `extractSpeakerNames()` helper function
   - Returns `detectedSpeakerNames` in API response
   - Saves detected names to database

### Frontend Changes
2. **`app/dashboard/recordings/[id]/page.tsx`**
   - Updated `getSpeakerLabel()` to check detected names (priority: speaker_map → detected_names → default)
   - Updated all calls to `getSpeakerLabel()` to pass `recording.detected_speaker_names`
   - Modified "Identify Speakers" button to show "X/Total" count
   - Updated `startSpeakerIdentification()` to pre-fill name field with detected name
   - Updated `handleIdentifySpeaker()` to pre-fill next speaker's name

### Type Updates
3. **`types/database.ts`**
   - Added `detected_speaker_names?: Record<string, string> | null` to Recording type

### Database Migration
4. **`supabase-add-detected-speaker-names.sql`** (NEW FILE)
   - Adds `detected_speaker_names JSONB` column to `diffuse_recordings` table

## Setup Required

### Database Migration
Run this SQL in your Supabase SQL Editor:

```sql
ALTER TABLE diffuse_recordings
ADD COLUMN IF NOT EXISTS detected_speaker_names JSONB DEFAULT NULL;
```

## User Experience Flow

### Before (without auto-fill):
1. User records/uploads audio
2. Transcription shows "Speaker 1", "Speaker 2", etc.
3. User clicks "Identify Speakers"
4. User manually types each person's name
5. Transcript updates with custom names

### After (with auto-fill):
1. User records/uploads audio
2. **Transcription automatically shows detected names** (e.g., "John Doe", "Jane Smith")
3. Button shows "(0/4)" - 0 confirmed, 4 total speakers
4. User clicks "Identify Speakers"
5. **Name field is pre-filled** with detected name
6. User can:
   - Keep the name as-is and click Next
   - Edit the name if it's wrong
   - Add a position/title
7. After confirming, count updates to "(1/4)", "(2/4)", etc.
8. Transcript continues to show the names (now confirmed)

## Example Scenario

**Audio transcript:**
- "Hi, I'm John Doe from the city council"
- "Thanks John, I'm Jane Smith, the mayor"

**System behavior:**
1. AssemblyAI detects entities: `{"A": "John Doe", "B": "Jane Smith"}`
2. Transcript immediately displays:
   - **John Doe**: Hi, I'm John Doe from the city council
   - **Jane Smith**: Thanks John, I'm Jane Smith, the mayor
3. Button shows "Identify Speakers (0/2)"
4. User clicks button → Name field shows "John Doe" (pre-filled)
5. User adds position "City Council Member" and clicks Next
6. Button updates to "(1/2)"
7. Next screen shows "Jane Smith" (pre-filled)
8. User adds position "Mayor" and clicks Confirm
9. Button updates to "(2/2)"

## Benefits
- **Saves time**: Users don't need to type names that were already mentioned in the audio
- **Improves accuracy**: Names are captured exactly as spoken
- **Better UX**: Visual progress indicator shows completion status
- **Flexible**: Users can still correct or override any auto-detected names

## Testing Notes
- Entity detection works best when people introduce themselves or are addressed by name
- Names must be clearly spoken to be detected
- If no names are detected, the form works as before (empty name field)
- The system gracefully handles cases where only some speakers have detected names
