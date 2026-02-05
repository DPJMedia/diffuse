import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, unauthorizedResponse } from '@/lib/security/authorization'
import { validateSchema, sanitizeString } from '@/lib/security/validation'

const PREF_MAX_LENGTH = 200
const COMMENTS_MAX_LENGTH = 2000

export async function GET() {
  try {
    const { user, supabase } = await requireAuth()
    const { data, error } = await supabase
      .from('user_workflow_preferences')
      .select('tone, length, audience, comments')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      console.error('Workflow preferences fetch error:', error)
      return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 })
    }

    const prefs = data
      ? {
          ...(data.tone != null && data.tone !== '' && { tone: data.tone }),
          ...(data.length != null && data.length !== '' && { length: data.length }),
          ...(data.audience != null && data.audience !== '' && { audience: data.audience }),
          ...(data.comments != null && data.comments !== '' && { comments: data.comments }),
        }
      : {}
    return NextResponse.json(prefs)
  } catch {
    return unauthorizedResponse()
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth()

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body. Expected JSON.' },
        { status: 400 }
      )
    }

    let validated: { tone?: string; length?: string; audience?: string; comments?: string }
    try {
      validated = validateSchema(body, {
        tone: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, PREF_MAX_LENGTH),
        },
        length: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, PREF_MAX_LENGTH),
        },
        audience: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, PREF_MAX_LENGTH),
        },
        comments: {
          required: false,
          type: 'string',
          validator: (val) => (val == null || val === '') ? undefined : sanitizeString(val, COMMENTS_MAX_LENGTH),
        },
      })
    } catch (err: any) {
      return NextResponse.json(
        { error: 'Validation failed', message: err.message },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('user_workflow_preferences')
      .upsert(
        {
          user_id: user.id,
          tone: validated.tone ?? null,
          length: validated.length ?? null,
          audience: validated.audience ?? null,
          comments: validated.comments ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (error) {
      console.error('Workflow preferences save error:', error)
      return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return unauthorizedResponse()
  }
}
