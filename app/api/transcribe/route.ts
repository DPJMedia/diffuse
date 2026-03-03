import { NextRequest, NextResponse } from 'next/server'
import { AssemblyAI } from 'assemblyai'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireRecordingOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { validateSchema, validateRecordingId, validateAudioUrl, validateTranscription, validateRecordingTitle } from '@/lib/security/validation'

// Increase timeout for long audio files (up to 5 minutes)
// Note: Vercel Pro required for >60s, Vercel Hobby max is 10s
export const maxDuration = 300

// Lazy init: read env at request time so build succeeds without ASSEMBLYAI_API_KEY
function getAssemblyAIClient(): AssemblyAI {
  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY environment variable is required')
  }
  return new AssemblyAI({ apiKey })
}

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODEL = 'anthropic/claude-3.5-haiku'

/** Strip markdown/formatting artifacts from AI-generated title (backticks, code fences, etc.). */
function sanitizeGeneratedTitle(raw: string): string {
  return raw
    .replace(/```+/g, ' ')           // code fences -> space so words don't run together
    .replace(/`/g, '')               // inline backticks
    .replace(/^\s*#+\s*/gm, '')      // leading markdown headers
    .replace(/\*\*?/g, '')           // bold asterisks
    .replace(/__?/g, '')             // bold underscores
    .trim()
    .replace(/\s+/g, ' ')            // collapse multiple spaces/newlines
    .trim()
}

/** Generate a short title from transcription using Open Router (Claude 3.5 Haiku). Returns null if key missing or request fails. */
async function generateTitleWithOpenRouter(transcriptionText: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER
  if (!apiKey || !transcriptionText?.trim()) return null

  // Truncate to first ~4k chars to stay within token limits and avoid huge payloads
  const excerpt = transcriptionText.trim().slice(0, 4000)

  try {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'user',
            content: `Based only on this transcription, suggest a short, clear title (no quotes, no markdown, under 80 characters). Reply with only the title, nothing else.\n\nTranscription:\n${excerpt}`,
          },
        ],
        max_tokens: 80,
      }),
    })

    if (!res.ok) {
      console.warn('Open Router title request failed:', res.status, await res.text().catch(() => ''))
      return null
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data?.choices?.[0]?.message?.content?.trim()
    if (!raw || raw.length === 0) return null
    const title = sanitizeGeneratedTitle(raw)
    if (title.length > 0 && title.length <= 500) return title
    return null
  } catch (err) {
    console.warn('Open Router title generation error:', err)
    return null
  }
}

/** Fallback title from transcription when Open Router is unavailable or fails. */
function generateTitleFallback(transcriptionText: string | null): string {
  if (transcriptionText) {
    const firstSentence = transcriptionText.split(/[.!?]/)[0]?.trim()
    if (firstSentence && firstSentence.length > 10 && firstSentence.length < 100) {
      return firstSentence
    }
    if (transcriptionText.length > 50) {
      return transcriptionText.substring(0, 50).trim() + '...'
    }
    return transcriptionText.trim()
  }
  return 'Untitled Recording'
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting - expensive operation
    const rateLimitResponse = await checkRateLimit(request, 'expensive')
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    // Authentication check
    let authResult
    try {
      authResult = await requireAuth()
    } catch {
      return unauthorizedResponse()
    }
    const { user, supabase } = authResult

    // Parse and validate request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body. Expected JSON.' },
        { status: 400 }
      )
    }

    // Strict input validation - only allow expected fields
    let validatedData
    try {
      validatedData = validateSchema(body, {
        recordingId: {
          required: false,
          type: 'string',
          validator: (val) => val === undefined ? undefined : validateRecordingId(val),
        },
        audioUrl: {
          required: true,
          type: 'string',
          validator: validateAudioUrl,
        },
        autoSave: {
          required: false,
          type: 'boolean',
        },
        currentTitle: {
          required: false,
          type: 'string',
          validator: (val) => val === undefined ? undefined : validateRecordingTitle(val),
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Validation failed', message: error.message },
        { status: 400 }
      )
    }

    const { recordingId, audioUrl, autoSave, currentTitle } = validatedData

    // Authorization check - if recordingId is provided, verify ownership
    if (recordingId) {
      try {
        await requireRecordingOwnership(recordingId, user.id, supabase)
      } catch (error: any) {
        return forbiddenResponse(error.message)
      }
    }

    console.log('Starting transcription' + (recordingId ? ` for recording: ${recordingId}` : ' for file upload'))
    console.log('Audio URL:', audioUrl.substring(0, 100) + '...')
    console.log('Full audio URL for debugging:', audioUrl)

    const assemblyai = getAssemblyAIClient()
    // Use Universal-2 (free tier standard model) for speaker diarization
    // Universal-3 Pro requires paid plan or special free tier access
    console.log('Submitting to AssemblyAI with speaker_labels: true...')
    const transcript = await assemblyai.transcripts.transcribe({
      audio: audioUrl,
      speaker_labels: true,
    })
    console.log('AssemblyAI processing complete')

    if (transcript.status === 'error') {
      console.error('AssemblyAI transcription error:', transcript.error)
      // Reset status back to 'recorded' on failure (only if this is a recording)
      if (recordingId) {
        await supabase
          .from('diffuse_recordings')
          .update({ status: 'recorded' })
          .eq('id', recordingId)
      }
      return NextResponse.json(
        { error: transcript.error || 'Transcription failed' },
        { status: 500 }
      )
    }

    // Build transcription text and utterances (for speaker diarization / "Who is this?" flow)
    let transcriptionText: string | null = null
    let utterances: Array<{ speaker: string; text: string; start: number; end: number }> | undefined

    console.log('AssemblyAI response - status:', transcript.status)
    console.log('AssemblyAI response - has utterances:', !!transcript.utterances)
    console.log('AssemblyAI response - utterances count:', transcript.utterances?.length ?? 0)
    console.log('AssemblyAI response - has text:', !!transcript.text)
    console.log('AssemblyAI response - text length:', transcript.text?.length ?? 0)
    console.log('AssemblyAI response - audio_duration:', transcript.audio_duration)
    
    // Detect failed diarization: single utterance spanning most/all of the file
    const isSingleGiantUtterance = 
      transcript.utterances?.length === 1 && 
      transcript.audio_duration && 
      transcript.utterances[0].end && 
      (transcript.utterances[0].end / 1000) > (transcript.audio_duration * 0.95)
    
    if (isSingleGiantUtterance) {
      console.log('⚠️  FAILED DIARIZATION DETECTED: Single utterance spans entire file')
      console.log('Retrying with speakers_expected hint...')
      
      // Retry with speakers_expected to force better diarization
      const retryTranscript = await assemblyai.transcripts.transcribe({
        audio: audioUrl,
        speaker_labels: true,
        speakers_expected: 4, // Hint: look for at least 4 speakers
      })
      
      console.log('Retry complete - utterances:', retryTranscript.utterances?.length ?? 0)
      
      if (retryTranscript.status === 'completed' && retryTranscript.utterances && retryTranscript.utterances.length > 1) {
        console.log('✅ Retry successful! Using retry result.')
        // Use retry result
        const uniqueSpeakers = new Set(retryTranscript.utterances.map(u => u.speaker))
        console.log('Retry detected speakers:', Array.from(uniqueSpeakers).sort())
        console.log('Total unique speakers:', uniqueSpeakers.size)
        
        transcriptionText = retryTranscript.utterances
          .map((u) => `${u.speaker}: ${u.text}`)
          .join('\n\n')
        utterances = retryTranscript.utterances.map((u) => ({
          speaker: u.speaker,
          text: u.text,
          start: u.start ?? 0,
          end: u.end ?? 0,
        }))
      } else {
        console.log('❌ Retry also failed - falling back to plain transcript')
        transcriptionText = transcript.text ?? null
        utterances = undefined
      }
    } else if (transcript.utterances && transcript.utterances.length > 0) {
      // Count unique speakers
      const uniqueSpeakers = new Set(transcript.utterances.map(u => u.speaker))
      console.log('AssemblyAI detected speakers:', Array.from(uniqueSpeakers).sort())
      console.log('Total unique speakers:', uniqueSpeakers.size)
      console.log('First 5 utterances:', transcript.utterances.slice(0, 5).map(u => ({
        speaker: u.speaker,
        text: u.text?.substring(0, 50),
        start: u.start,
        end: u.end
      })))
      
      transcriptionText = transcript.utterances
        .map((u) => `${u.speaker}: ${u.text}`)
        .join('\n\n')
      utterances = transcript.utterances.map((u) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start ?? 0,
        end: u.end ?? 0,
      }))
    } else {
      console.log('No utterances returned - falling back to plain text transcript')
      console.log('Plain text first 200 chars:', transcript.text?.substring(0, 200))
      transcriptionText = transcript.text ?? null
    }

    // Generate title: prefer Open Router (Claude 3.5 Haiku), fallback to excerpt from transcription
    const openRouterTitle = transcriptionText
      ? await generateTitleWithOpenRouter(transcriptionText)
      : null
    const suggestedTitle = openRouterTitle ?? generateTitleFallback(transcriptionText)

    // Use user-provided title if they entered one, otherwise use AI-generated
    const shouldAutoGenerateTitle = !currentTitle || currentTitle === 'Processing...' || currentTitle === ''
    const finalTitle = shouldAutoGenerateTitle ? suggestedTitle : currentTitle

    // If autoSave is true and we have a recordingId, save directly to the database
    if (autoSave && recordingId) {
      console.log('Auto-saving transcription to database for recording:', recordingId)
      console.log('Final title:', finalTitle)
      
      const { data: updateData, error: updateError } = await supabase
        .from('diffuse_recordings')
        .update({ 
          title: finalTitle,
          transcription: transcriptionText,
          original_transcription: transcriptionText,
          status: 'transcribed',
          utterances: utterances ?? null,
          original_utterances: utterances ?? null,
        })
        .eq('id', recordingId)
        .select()

      if (updateError) {
        console.error('Error saving transcription:', updateError)
        return NextResponse.json(
          { error: 'Failed to save transcription' },
          { status: 500 }
        )
      }
      
      console.log('Transcription saved successfully:', updateData ? 'Updated' : 'No rows returned')
    }

    const response = NextResponse.json({
      success: true,
      transcription: transcriptionText,
      utterances: utterances ?? undefined,
      suggestedTitle: suggestedTitle,
      finalTitle: finalTitle,
    })

    // Add rate limit headers
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    return response
  } catch (error: any) {
    console.error('Transcription error:', error)
    
    // Don't expose internal error details
    if (error.message && (error.message.includes('Unauthorized') || error.message.includes('Forbidden'))) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes('Unauthorized') ? 401 : 403 }
      )
    }
    
    // Provide safe error messages
    let errorMessage = 'Internal server error'
    
    if (error.message?.includes('timeout') || error.message?.includes('TIMEOUT')) {
      errorMessage = 'Transcription timed out. The audio file may be too long. Try a shorter file or contact support.'
    } else if (error.message?.includes('Invalid audio')) {
      errorMessage = 'Invalid audio file. Please ensure the file is a valid MP3, WAV, or M4A file.'
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

