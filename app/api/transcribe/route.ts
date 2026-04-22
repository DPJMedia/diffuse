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

/** Build transcript with per-utterance timestamps from utterances. */
function buildTranscriptWithMinuteMarkers(
  utterances: Array<{ speaker: string; text: string; start: number; end?: number }>
): string {
  if (!utterances || utterances.length === 0) return ''

  const formatTimestampFromMs = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00'
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  return utterances
    .map((u) => `[${formatTimestampFromMs(u.start)}] ${u.speaker}: ${u.text}`.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Common false positives from entity detection on phrases like "my name is …" */
const INVALID_PERSON_NAME_TEXT = new Set([
  'name',
  'names',
  'my',
  'me',
  'i',
  'hi',
  'hello',
  'hey',
  'sir',
  'ma\'am',
  'mr',
  'mrs',
  'ms',
  'dr',
])

/** AssemblyAI Entity objects do not include a confidence field — only type/text/times. */
const MIN_NAME_SCORE = 2

function isPlausiblePersonName(text: string): boolean {
  const t = text.trim()
  if (t.length < 2) return false
  if (INVALID_PERSON_NAME_TEXT.has(t.toLowerCase())) return false
  // Reject single generic tokens that are not real names
  if (/^(the|a|an|and|or|but)$/i.test(t)) return false
  return true
}

/**
 * Reject strings that look like addresses, conversational fragments, or mis-tags
 * (e.g. "on Summer street and", "like husband") — often wrongly returned as person_name.
 */
function looksLikeNonPersonLabel(text: string): boolean {
  const t = text.trim()
  const lower = t.toLowerCase()
  if (t.length > 80) return true
  if (/^(on|at|in|like|with|for|to)\s+/i.test(t)) return true
  if (/\b(street|avenue|road|boulevard|blvd|drive|lane|highway|hwy|\bst\b|\bdr\b)\b/i.test(t)) return true
  if (/\b(and|or)\s*$/i.test(t.trim())) return true
  if (/\b(girlfriend|boyfriend|husband|wife|neighbor|owner|landlord)\b/i.test(lower)) return true
  if (/\b(i just|i'm on|i am on|we lose|we didn't|pipe burst|degrees)\b/i.test(lower)) return true
  return false
}

function scoreNameCandidate(text: string, source: 'entity' | 'intro' | 'explicit'): number {
  let s = 0
  const t = text.trim()
  if (!isPlausiblePersonName(t) || looksLikeNonPersonLabel(t)) return -100
  if (source === 'entity') s += 1
  if (source === 'intro') s += 4
  if (source === 'explicit') s += 5
  // Light preference for two-word names (typical First Last)
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length >= 2 && words.length <= 4) s += 1
  return s
}

/** Find which utterance owns this time range (entity midpoint must fall inside utterance). */
function findUtteranceForEntity(
  utterances: Array<{ speaker: string; text: string; start: number; end: number }>,
  entityStart: number,
  entityEnd: number
) {
  const mid = (entityStart + entityEnd) / 2
  const byMid = utterances.find((u) => mid >= u.start && mid <= u.end)
  if (byMid) return byMid
  // Fallback: any overlap with the entity span (handles boundary quirks)
  return utterances.find((u) => entityStart < u.end && entityEnd > u.start)
}

/**
 * Pull a likely self-introduced name from the first thing a speaker says.
 * Complements entity detection when it tags only "name" or misses the full name.
 */
function extractNameFromUtteranceText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null

  // 1–4 words; avoids swallowing "… and I'm …" after the name
  const NAME = String.raw`[A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,3}`

  const patterns: RegExp[] = [
    new RegExp(String.raw`\bmy name is\s+(${NAME})\b`, 'i'),
    new RegExp(String.raw`\bmy name's\s+(${NAME})\b`, 'i'),
    new RegExp(String.raw`\bi am\s+(${NAME})\b`, 'i'),
    new RegExp(String.raw`\bi'm\s+(${NAME})\b`, 'i'),
    new RegExp(String.raw`\bthis is\s+(${NAME})\b`, 'i'),
    new RegExp(String.raw`\bcall me\s+(${NAME})\b`, 'i'),
  ]

  for (const re of patterns) {
    const m = cleaned.match(re)
    if (m?.[1] && isPlausiblePersonName(m[1]) && !looksLikeNonPersonLabel(m[1])) return m[1].trim()
  }
  return null
}

/**
 * Names often appear mid-utterance after setup ("… pipe burst … Stephen Watson. Sorry. Steve Watson.")
 * AssemblyAI may tag an early fragment as person_name; scan the full text for explicit/corrected names.
 */
function extractNameFromFullSpeakerText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null

  // "Sorry. Steve Watson" / "Sorry, Steve Watson"
  const sorryAfter = cleaned.match(
    /\b(?:sorry|I'm sorry)\s*[.,]?\s+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,2})\b/i
  )
  if (sorryAfter?.[1] && isPlausiblePersonName(sorryAfter[1]) && !looksLikeNonPersonLabel(sorryAfter[1])) {
    return sorryAfter[1].trim()
  }

  // "Stephen Watson. Sorry" — name before apology/correction
  const beforeSorry = cleaned.match(
    /\b([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,2})\s*[.,]\s*(?:sorry|I'm sorry)\b/i
  )
  if (beforeSorry?.[1] && isPlausiblePersonName(beforeSorry[1]) && !looksLikeNonPersonLabel(beforeSorry[1])) {
    return beforeSorry[1].trim()
  }

  // Two-word capitalized names (First Last) — prefer last plausible match (often correction)
  const matches = [...cleaned.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)]
  for (let i = matches.length - 1; i >= 0; i--) {
    const cand = matches[i][1].trim()
    if (isPlausiblePersonName(cand) && !looksLikeNonPersonLabel(cand)) return cand
  }

  return null
}

/** Extract person names from entities and map them to speakers based on timestamps */
function extractSpeakerNamesFromEntities(
  entities: Array<{ entity_type: string; text: string; start: number; end: number }> | undefined,
  utterances: Array<{ speaker: string; text: string; start: number; end: number }> | undefined
): Record<string, Array<{ text: string; score: number }>> {
  const speakerNames: Record<string, Array<{ text: string; score: number }>> = {}
  if (!entities || !utterances || utterances.length === 0) return speakerNames

  const personNames = entities.filter((e) => (e.entity_type || '').toLowerCase() === 'person_name')
  if (personNames.length === 0) return speakerNames

  for (const person of personNames) {
    const raw = person.text.trim()
    if (!isPlausiblePersonName(raw) || looksLikeNonPersonLabel(raw)) continue

    const utterance = findUtteranceForEntity(utterances, person.start, person.end)
    if (!utterance) continue
    const sp = utterance.speaker
    if (!speakerNames[sp]) speakerNames[sp] = []
    const sc = scoreNameCandidate(raw, 'entity')
    if (sc >= MIN_NAME_SCORE) speakerNames[sp].push({ text: raw, score: sc })
  }

  return speakerNames
}

function extractSpeakerNamesFromUtteranceHeuristics(
  utterances: Array<{ speaker: string; text: string; start: number; end: number }> | undefined
): Record<string, Array<{ text: string; score: number }>> {
  const out: Record<string, Array<{ text: string; score: number }>> = {}
  if (!utterances || utterances.length === 0) return out

  const perSpeaker: Record<string, string[]> = {}
  for (const u of utterances) {
    if (!perSpeaker[u.speaker]) perSpeaker[u.speaker] = []
    if (perSpeaker[u.speaker].length < 5) perSpeaker[u.speaker].push(u.text)
  }

  for (const [speaker, texts] of Object.entries(perSpeaker)) {
    const combined = texts.join(' ')
    const candidates: Array<{ text: string; score: number }> = []

    for (const t of texts) {
      const intro = extractNameFromUtteranceText(t)
      if (intro) {
        const sc = scoreNameCandidate(intro, 'intro')
        if (sc >= MIN_NAME_SCORE) candidates.push({ text: intro, score: sc })
      }
    }

    const full = extractNameFromFullSpeakerText(combined)
    if (full) {
      const sc = scoreNameCandidate(full, 'explicit')
      if (sc >= MIN_NAME_SCORE) candidates.push({ text: full, score: sc })
    }

    if (candidates.length) {
      candidates.sort((a, b) => b.score - a.score)
      out[speaker] = candidates
    }
  }
  return out
}

/** Merge entity-based and heuristic names; pick highest-scoring candidate per speaker */
function buildDetectedSpeakerNames(
  entities: Array<{ entity_type: string; text: string; start: number; end: number }> | undefined,
  utterances: Array<{ speaker: string; text: string; start: number; end: number }> | undefined
): Record<string, string> | undefined {
  if (!utterances || utterances.length === 0) return undefined

  const fromEntities = extractSpeakerNamesFromEntities(entities, utterances)
  const fromHeuristics = extractSpeakerNamesFromUtteranceHeuristics(utterances)

  const speakers = new Set([...Object.keys(fromEntities), ...Object.keys(fromHeuristics)])
  const merged: Record<string, string> = {}

  for (const sp of speakers) {
    const all: Array<{ text: string; score: number }> = [
      ...(fromEntities[sp] || []),
      ...(fromHeuristics[sp] || []),
    ]
    if (all.length === 0) continue
    all.sort((a, b) => b.score - a.score)
    const best = all[0]
    if (best && best.score >= MIN_NAME_SCORE && isPlausiblePersonName(best.text)) {
      merged[sp] = best.text
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
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
      entity_detection: true, // Enable entity detection to extract person names
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
    /** Entities must come from the same transcript object as utterances (timestamps align). */
    let entitiesForNames: Array<{ entity_type: string; text: string; start: number; end: number }> | undefined =
      transcript.entities as typeof entitiesForNames

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
        entity_detection: true, // Enable entity detection to extract person names
      })
      
      console.log('Retry complete - utterances:', retryTranscript.utterances?.length ?? 0)
      
      if (retryTranscript.status === 'completed' && retryTranscript.utterances && retryTranscript.utterances.length > 1) {
        console.log('✅ Retry successful! Using retry result.')
        // Use retry result
        const uniqueSpeakers = new Set(retryTranscript.utterances.map(u => u.speaker))
        console.log('Retry detected speakers:', Array.from(uniqueSpeakers).sort())
        console.log('Total unique speakers:', uniqueSpeakers.size)
        
        // Build transcript with minute markers
        transcriptionText = buildTranscriptWithMinuteMarkers(retryTranscript.utterances)
        utterances = retryTranscript.utterances.map((u) => ({
          speaker: u.speaker,
          text: u.text,
          start: u.start ?? 0,
          end: u.end ?? 0,
        }))
        entitiesForNames = retryTranscript.entities as typeof entitiesForNames
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
      
      // Build transcript with minute markers
      transcriptionText = buildTranscriptWithMinuteMarkers(transcript.utterances)
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

    // Extract speaker names from entities + self-intro heuristics (entities must match utterance timestamps)
    const detectedSpeakerNames = buildDetectedSpeakerNames(entitiesForNames, utterances)
    if (detectedSpeakerNames) {
      console.log('Detected speaker names from entities:', detectedSpeakerNames)
    }

    // Generate title: prefer Open Router (Claude 3.5 Haiku), fallback to excerpt from transcription
    const openRouterTitle = transcriptionText
      ? await generateTitleWithOpenRouter(transcriptionText)
      : null
    const suggestedTitle = openRouterTitle ?? generateTitleFallback(transcriptionText)

    // Use user-provided title if they entered one, otherwise use AI-generated.
    // Treat URL-pull placeholders as “no title yet”.
    const shouldAutoGenerateTitle =
      !currentTitle ||
      currentTitle === '' ||
      currentTitle === 'Processing...' ||
      currentTitle === 'Pulling audio...'
    const finalTitle = shouldAutoGenerateTitle ? suggestedTitle : currentTitle

    // Persist length in seconds for UI (same audio as AssemblyAI; utterances are fallback).
    let durationSeconds: number | undefined
    const ad = transcript.audio_duration
    if (ad != null && Number.isFinite(ad) && ad > 0) {
      durationSeconds = Math.round(ad)
    }
    if ((durationSeconds == null || durationSeconds <= 0) && utterances?.length) {
      const lastMs = Math.max(...utterances.map((u) => u.end ?? 0))
      if (lastMs > 0) durationSeconds = Math.max(1, Math.ceil(lastMs / 1000))
    }

    // If autoSave is true and we have a recordingId, save directly to the database
    if (autoSave && recordingId) {
      console.log('Auto-saving transcription to database for recording:', recordingId)
      console.log('Final title:', finalTitle)
      if (durationSeconds != null && durationSeconds > 0) {
        console.log('Saving duration (seconds):', durationSeconds)
      }
      
      const { data: updateData, error: updateError } = await supabase
        .from('diffuse_recordings')
        .update({ 
          title: finalTitle,
          transcription: transcriptionText,
          original_transcription: transcriptionText,
          status: 'transcribed',
          utterances: utterances ?? null,
          original_utterances: utterances ?? null,
          detected_speaker_names: detectedSpeakerNames ?? null,
          ...(durationSeconds != null && durationSeconds > 0 ? { duration: durationSeconds } : {}),
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
      detectedSpeakerNames: detectedSpeakerNames ?? undefined,
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

