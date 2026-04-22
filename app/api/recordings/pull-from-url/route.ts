import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'
import { validateSchema, validateScrapeUrl, validateUUID } from '@/lib/security/validation'
import { assertUrlSafeForServerFetch, downloadDirectOrPageAudio, PULL_FETCH_TIMEOUT_MS } from '@/lib/recordings/pullAudioFromUrl'
import { extractYouTubeAudio, isYouTubeUrl, YouTubeError } from '@/lib/recordings/ytDlpExtractAudio'

export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'expensive')
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const tStart = Date.now()

  let authResult: Awaited<ReturnType<typeof requireAuth>>
  try {
    authResult = await requireAuth()
  } catch {
    return unauthorizedResponse()
  }
  const { user, supabase } = authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body. Expected JSON.' }, { status: 400 })
  }

  function optionalRecordingId(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    return validateUUID(value)
  }

  let urlString: string
  let recordingId: string | undefined
  try {
    const parsedBody = validateSchema(body, {
      url: { required: true, type: 'string', validator: validateScrapeUrl },
      recordingId: { type: 'string', validator: optionalRecordingId },
    })
    urlString = parsedBody.url
    recordingId = parsedBody.recordingId
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Validation failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const parsed = new URL(urlString)
  try {
    assertUrlSafeForServerFetch(parsed)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid URL'
    return NextResponse.json({ error: message, code: 'URL_NOT_ALLOWED' }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PULL_FETCH_TIMEOUT_MS)

  type AudioPayload = {
    buffer: Buffer
    contentType: string
    ext: string
    sourceRecordedAt?: string | null
  }

  async function extractMp3FromVideoBuffer(video: Buffer): Promise<Buffer> {
    // Resolve at runtime so Next file tracing can include the binary.
    // eslint-disable-next-line no-eval
    const ffmpegPath = (eval('require')('ffmpeg-static') as string | null)
    if (!ffmpegPath) throw new Error('ffmpeg is not available in this environment')
    try {
      await fs.access(ffmpegPath)
    } catch {
      throw new Error(`ffmpeg binary missing at path: ${ffmpegPath}`)
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffuse-pull-'))
    const inPath = path.join(dir, 'input')
    const outPath = path.join(dir, 'output.mp3')
    await fs.writeFile(inPath, video)

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inPath,
        '-vn',
        '-map',
        'a:0',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-b:a',
        '64k',
        outPath,
      ])
      let stderr = ''
      proc.stderr.on('data', (d) => {
        stderr += String(d)
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) return resolve()
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
      })
    })

    const mp3 = await fs.readFile(outPath)
    // Best-effort cleanup
    void fs.rm(dir, { recursive: true, force: true })
    return mp3
  }

  try {
    let audio: AudioPayload | undefined
    let usedFallback = false

    if (isYouTubeUrl(urlString)) {
      try {
        const t0 = Date.now()
        const a = await extractYouTubeAudio(urlString, controller.signal)
        audio = { ...a, sourceRecordedAt: null }
        console.log('[pull-from-url] youtube download bytes=', audio.buffer.length, 'ct=', audio.contentType, 'ms=', Date.now() - t0)
      } catch (ytErr: unknown) {
        const message = ytErr instanceof YouTubeError ? ytErr.message : String(ytErr)
        const code = ytErr instanceof YouTubeError ? ytErr.code : 'YOUTUBE_FAILED'
        console.error('[pull-from-url] YouTube extraction failed:', code, message)
        return NextResponse.json(
          {
            error: message,
            code,
          },
          { status: 502 }
        )
      }
    } else {
      try {
        const t0 = Date.now()
        audio = await downloadDirectOrPageAudio(urlString, controller.signal)
        console.log('[pull-from-url] source download bytes=', audio.buffer.length, 'ct=', audio.contentType, 'ms=', Date.now() - t0)
      } catch (directErr: unknown) {
        const directMessage = directErr instanceof Error ? directErr.message : String(directErr)
        console.error('[pull-from-url] Direct fetch failed:', directMessage)
        return NextResponse.json(
          {
            error: 'Could not download audio from this URL. It may be unsupported, private, geo-blocked, or require login.',
            code: 'PULL_FAILED',
            detail: directMessage,
          },
          { status: 502 }
        )
      }
      usedFallback = true
    }

    if (!audio) {
      return NextResponse.json(
        { error: 'Could not download audio from this URL.', code: 'PULL_EMPTY' },
        { status: 502 }
      )
    }

    // Never store video: if upstream returned video, extract audio-only and store that.
    if (audio.contentType.startsWith('video/')) {
      const t0 = Date.now()
      const mp3 = await extractMp3FromVideoBuffer(audio.buffer)
      console.log('[pull-from-url] extracted mp3 bytes=', mp3.length, 'ms=', Date.now() - t0)
      audio = {
        ...audio,
        buffer: mp3,
        contentType: 'audio/mpeg',
        ext: '.mp3',
      }
    }

    const fileName = `${user.id}/${Date.now()}${audio.ext}`
    const recordedAt =
      typeof audio.sourceRecordedAt === 'string' && audio.sourceRecordedAt.trim().length > 0
        ? audio.sourceRecordedAt.trim()
        : undefined

    if (recordingId) {
      const { data: existing, error: existingError } = await supabase
        .from('diffuse_recordings')
        .select('id,user_id,file_path,status')
        .eq('id', recordingId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existingError || !existing) {
        return NextResponse.json(
          { error: 'Recording not found', code: 'RECORDING_NOT_FOUND' },
          { status: 404 }
        )
      }
      if (existing.status !== 'recorded') {
        return NextResponse.json(
          { error: 'Recording is not in a state that allows pull completion', code: 'INVALID_RECORDING_STATE' },
          { status: 400 }
        )
      }
      const pendingPrefix = `${user.id}/pending-pull-`
      if (!existing.file_path.startsWith(pendingPrefix)) {
        return NextResponse.json(
          { error: 'Invalid placeholder recording for URL pull', code: 'INVALID_PULL_PLACEHOLDER' },
          { status: 400 }
        )
      }
    }

    const tUpload = Date.now()
    const { error: uploadError } = await supabase.storage.from('recordings').upload(fileName, audio.buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: audio.contentType,
    })
    console.log('[pull-from-url] upload ms=', Date.now() - tUpload)

    if (uploadError) {
      console.error('pull-from-url storage upload:', uploadError)
      return NextResponse.json(
        {
          error: uploadError.message || 'Failed to store audio',
          code: 'STORAGE_UPLOAD_FAILED',
          detail: uploadError.message,
        },
        { status: 502 }
      )
    }

    let row: Record<string, unknown>

    if (recordingId) {
      const { data: updated, error: updateError } = await supabase
        .from('diffuse_recordings')
        .update({
          file_path: fileName,
          ...(recordedAt ? { recorded_at: recordedAt } : {}),
        })
        .eq('id', recordingId)
        .eq('user_id', user.id)
        .select()
        .single()

      if (updateError || !updated) {
        console.error('pull-from-url db update:', updateError)
        await supabase.storage.from('recordings').remove([fileName])
        return NextResponse.json(
          {
            error: 'Failed to update recording',
            code: 'DB_UPDATE_FAILED',
            detail: updateError?.message,
          },
          { status: 500 }
        )
      }
      row = updated as Record<string, unknown>
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('diffuse_recordings')
        .insert({
          user_id: user.id,
          title: 'Processing...',
          duration: 0,
          file_path: fileName,
          status: 'recorded',
          ...(recordedAt ? { recorded_at: recordedAt } : {}),
        })
        .select()
        .single()

      if (insertError || !inserted) {
        console.error('pull-from-url db insert:', insertError)
        await supabase.storage.from('recordings').remove([fileName])
        return NextResponse.json(
          {
            error: 'Failed to create recording',
            code: 'DB_INSERT_FAILED',
            detail: insertError?.message,
          },
          { status: 500 }
        )
      }
      row = inserted as Record<string, unknown>
    }

    const res = NextResponse.json({
      recording: row,
      usedFallback,
    })
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      res.headers.set(key, value)
    })
    return res
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        {
          error: 'Pull timed out — try a shorter video or a direct audio link.',
          code: 'TIMEOUT',
        },
        { status: 408 }
      )
    }
    console.error('pull-from-url:', error)
    const message =
      error instanceof Error ? error.message : 'Could not download audio from this URL'
    return NextResponse.json({ error: message, code: 'PULL_FAILED' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
    console.log('[pull-from-url] total_ms=', Date.now() - tStart)
  }
}
