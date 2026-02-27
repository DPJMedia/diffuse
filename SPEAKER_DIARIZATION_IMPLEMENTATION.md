# Speaker Diarization + Name Mapping Implementation Summary

## Overview
Successfully implemented speaker diarization with name mapping for the transcribe modal on the recordings page. The feature uses AssemblyAI's free speaker_labels feature to identify distinct speakers and allows users to map them to real names and titles within the modal flow.

## Implementation Complete ✅

### 1. API Changes (app/api/transcribe/route.ts)
- ✅ Enabled `speaker_labels: true` in AssemblyAI transcribe request
- ✅ Parse utterances array from API response with speaker, text, start, end timestamps
- ✅ Build plain text transcript from utterances for backward compatibility
- ✅ Return both `transcription` (string) and `utterances` (array) in API response
- ✅ Handle cases where diarization doesn't produce utterances (fallback to plain text)

### 2. Database Schema (supabase-add-speaker-map.sql)
- ✅ Created migration file to add `speaker_map JSONB` column to `diffuse_recordings`
- ✅ Structure: `{ "Speaker A": { "name": "John Smith", "position": "Mayor" }, ... }`
- ✅ Updated TypeScript types in types/database.ts to include speaker_map

### 3. Recordings Page State & Logic (app/dashboard/recordings/page.tsx)
- ✅ Added speaker identification state:
  - `transcribePhase`: 'idle' | 'transcribing' | 'identifying_speakers' | 'done'
  - `utterances`: Array of speaker utterances with timestamps
  - `speakerList`: Unique speaker labels in first-appearance order
  - `speakerMap`: Built mapping from labels to names/positions
  - `currentSpeakerIndex`: Current speaker being identified
  - Audio playback state (clipPlaying, clipError)
- ✅ Implemented `playCurrentSpeakerClip()` function:
  - Finds first utterance for current speaker
  - Seeks to start time and plays 5-second clip
  - Auto-stops at end time
  - Graceful fallback if autoplay fails
- ✅ Implemented `handleIdentifySpeaker()` function:
  - Validates name input (required)
  - Stores name and optional position in speakerMap
  - Advances to next speaker or builds enriched transcript
  - Enriched format: `"John Smith (Mayor): \"transcript text\""`
- ✅ Updated `transcribeRecording()` to handle utterances response:
  - Extract unique speakers in order
  - Enter identification phase if utterances exist
  - Trigger automatic clip playback
- ✅ Updated `saveTranscription()` to persist speaker_map to database

### 4. UI Implementation (app/dashboard/recordings/page.tsx)
- ✅ Added speaker identification modal state between "Generating..." and transcript view
- ✅ Shows "We detected a new speaker. Who is this?" prompt
- ✅ Progress indicator: "Speaker 1 of N"
- ✅ Hidden audio element for clip playback
- ✅ Clip playback status (auto-played, playing, or manual play button)
- ✅ Required "Name" input field
- ✅ Optional "Position or Title" input field
- ✅ "Next" / "Confirm" button based on speaker count
- ✅ Consistent styling with existing modal (glass-container, btn-primary, etc.)
- ✅ Modal never closes during identification - state changes inline

## Data Flow

```
User clicks "Generate Transcription"
  ↓
POST /api/transcribe with audioUrl and recordingId
  ↓
AssemblyAI processes with speaker_labels: true
  ↓
API returns: { transcription, utterances, suggestedTitle, finalTitle }
  ↓
IF utterances exist:
  Modal enters 'identifying_speakers' phase
    ↓
  For each unique speaker:
    - Show "Who is this?" form
    - Auto-play 3-5 second audio clip
    - User enters Name (required) and Position (optional)
    - Click "Next" to continue
    ↓
  Build enriched transcript from utterances + speaker map
  Modal shows enriched transcript in textarea
ELSE:
  Modal shows plain transcript (no speaker labels)
  ↓
User clicks "Save"
  ↓
Persist to DB: transcription, original_transcription, speaker_map
  ↓
Modal closes, recordings list refreshes
```

## Key Features

1. **Automatic Speaker Detection**: Uses AssemblyAI's free tier speaker_labels feature
2. **Audio Clip Playback**: Plays 3-5 second sample of each speaker automatically
3. **Graceful Fallback**: Manual play button if autoplay fails or is blocked
4. **Single Speaker Support**: Shows one identification card even if only one speaker
5. **Enriched Transcript**: Replaces "Speaker A" with "John Smith (Mayor)"
6. **Persistent Speaker Map**: Stored in database for future reference
7. **Inline Modal Flow**: Never closes modal, just changes state
8. **Consistent Styling**: Matches existing modal design system

## Testing Notes

- ✅ Code compiles successfully (no TypeScript errors)
- ✅ No linter errors
- ✅ Dev server runs successfully on http://localhost:3001
- ⚠️ **Database migration required**: Run `supabase-add-speaker-map.sql` in Supabase SQL Editor before testing in production
- ⚠️ **Manual testing needed**: Upload/record audio with multiple speakers and verify:
  - Utterances are returned from API
  - Identification UI appears correctly
  - Audio clips play automatically
  - Enriched transcript is generated correctly
  - Speaker map is saved to database
  - Transcript shows enriched names instead of labels

## Files Modified

1. `app/api/transcribe/route.ts` - API endpoint with diarization
2. `app/dashboard/recordings/page.tsx` - UI, state, and logic
3. `types/database.ts` - TypeScript types for speaker_map
4. `supabase-add-speaker-map.sql` - Database migration (NEW)

## Next Steps for User

1. **Run Database Migration**:
   ```sql
   -- In Supabase SQL Editor:
   ALTER TABLE diffuse_recordings
   ADD COLUMN IF NOT EXISTS speaker_map JSONB DEFAULT NULL;
   ```

2. **Test the Flow**:
   - Navigate to http://localhost:3001/dashboard/recordings
   - Create a new recording or upload an audio file with multiple speakers
   - Click "Generate Transcription"
   - Verify speaker identification UI appears
   - Enter names and positions for each speaker
   - Verify enriched transcript is generated correctly
   - Click Save and verify data persists

3. **Optional Enhancements** (not implemented, future work):
   - Add "Edit Speakers" button to re-map speakers after saving
   - Show speaker_map in recording detail view for already-transcribed recordings
   - Allow skipping identification and keeping "Speaker A" labels
   - Add speaker identification to project page audio uploads (currently recordings page only)

## Edge Cases Handled

- ✅ No utterances returned (diarization failed) → Normal transcript flow
- ✅ Single speaker detected → Show one identification card
- ✅ Autoplay blocked by browser → Show manual "Play Sample" button
- ✅ Audio seek not supported → setClipError and show manual play button
- ✅ Empty name input → Alert validation before proceeding
- ✅ Missing position → Optional, enriched transcript omits position if empty

## Implementation Status: COMPLETE ✅

All todos completed. Feature is ready for testing and deployment.
