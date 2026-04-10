import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'
import { validateSchema, validateFilePath } from '@/lib/security/validation'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResponse = await checkRateLimit(request, 'authenticated')
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
    const { supabase } = authResult

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

    // Strict input validation
    let validatedData
    try {
      validatedData = validateSchema(body, {
        filePath: {
          required: true,
          type: 'string',
          validator: validateFilePath,
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Validation failed', message: error.message },
        { status: 400 }
      )
    }

    const { filePath } = validatedData

    // Placeholder path from "pull from URL" before upload completes — nothing exists in storage.
    if (filePath.includes('/pending-pull-')) {
      return NextResponse.json(
        {
          error:
            'No audio file for this recording. The URL pull never finished or failed before upload. Delete this entry and try again.',
          code: 'PULL_INCOMPLETE',
        },
        { status: 422 }
      )
    }

    // Get a signed URL for the audio file (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from('recordings')
      .createSignedUrl(filePath, 3600)

    if (error || !data?.signedUrl) {
      console.error('Error getting signed URL:', error)
      const err = error as unknown as { statusCode?: unknown; message?: unknown } | null
      const statusCode = typeof err?.statusCode === 'string' ? err.statusCode : ''
      const msg = typeof err?.message === 'string' ? err.message : ''
      const looksMissing =
        statusCode === '404' ||
        /not\s*found/i.test(msg) ||
        /object\s+not\s+found/i.test(msg)
      if (looksMissing) {
        return NextResponse.json(
          {
            error:
              'That audio file is not in storage. It may have been deleted or the recording was never fully uploaded.',
            code: 'AUDIO_NOT_IN_STORAGE',
          },
          { status: 404 }
        )
      }
      return NextResponse.json({ error: 'Failed to get audio URL' }, { status: 500 })
    }

    const response = NextResponse.json({
      signedUrl: data.signedUrl,
    })

    // Add rate limit headers
    const rateLimitHeaders = getRateLimitHeaders(request, 'authenticated')
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    return response
  } catch (error: any) {
    console.error('Signed URL error:', error)
    
    // Don't expose internal error details
    if (error.message && error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

