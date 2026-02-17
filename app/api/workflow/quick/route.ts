import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireRecordingOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { validateSchema, validateRecordingId, validateTranscription, validateRecordingTitle } from '@/lib/security/validation'
import { getN8nWebhookUrl } from '@/lib/n8n'

interface QuickWorkflowResponse {
  project_title?: string
  project_description?: string
  // Nested format: workflow may put title/description inside article
  article?: Record<string, unknown> & { project_title?: string; project_description?: string }
  // Article fields (flat structure)
  title?: string
  subtitle?: string
  content?: string
  excerpt?: string
  suggested_sections?: string[]
  category?: string
  tags?: string[]
  meta_title?: string
  meta_description?: string
}

// Clean the JSON string for parsing
// The AI sometimes returns JSON with unescaped control characters in string values
function cleanJsonString(str: string): string {
  // Remove any BOM or invisible characters at the start
  let cleaned = str.replace(/^\uFEFF/, '').trim()
  
  // Remove markdown code fences if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }
  cleaned = cleaned.trim()
  
  return cleaned
}

// Escape control characters inside JSON string values
// This handles cases where the AI outputs unescaped newlines in content
function escapeControlCharsInJsonStrings(jsonStr: string): string {
  // Process character by character, only escape when inside a string
  let result = ''
  let inString = false
  let prevChar = ''
  
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i]
    
    // Check if we're entering/exiting a string (unescaped quote)
    if (char === '"' && prevChar !== '\\') {
      inString = !inString
      result += char
    } else if (inString) {
      // Inside a string - escape control characters
      const code = char.charCodeAt(0)
      if (code < 32) {
        // Control character
        if (char === '\n') {
          result += '\\n'
        } else if (char === '\r') {
          result += '\\r'
        } else if (char === '\t') {
          result += '\\t'
        } else {
          // Remove other control characters
          result += ''
        }
      } else {
        result += char
      }
    } else {
      // Outside string - keep as-is (newlines between properties are fine)
      result += char
    }
    
    prevChar = char
  }
  
  return result
}

// Helper to extract JSON text from the n8n response structure
function extractTextFromN8nResponse(n8nResult: any): string | null {
  console.log('Extracting text from n8n response:', JSON.stringify(n8nResult).substring(0, 500))
  
  // The format you showed: [{output: [{content: [{type: "output_text", text: "..."}]}]}]
  if (Array.isArray(n8nResult) && n8nResult.length > 0) {
    const firstItem = n8nResult[0]
    
    // Check for output array with message content
    if (firstItem?.output && Array.isArray(firstItem.output)) {
      for (const outputItem of firstItem.output) {
        if (outputItem?.content && Array.isArray(outputItem.content)) {
          for (const contentItem of outputItem.content) {
            if (contentItem?.type === 'output_text' && contentItem?.text) {
              console.log('Found output_text content')
              return contentItem.text
            }
          }
        }
        // Also check direct text on output item
        if (outputItem?.text) {
          return outputItem.text
        }
      }
    }
    
    // Direct content array on first item
    if (firstItem?.content && Array.isArray(firstItem.content)) {
      for (const contentItem of firstItem.content) {
        if (contentItem?.type === 'output_text' && contentItem?.text) {
          return contentItem.text
        }
        if (contentItem?.text) {
          return contentItem.text
        }
      }
    }
    
    // Direct text on first item
    if (firstItem?.text) {
      return firstItem.text
    }
  }
  
  // Single object with output
  if (n8nResult?.output) {
    if (typeof n8nResult.output === 'string') {
      return n8nResult.output
    }
    if (Array.isArray(n8nResult.output)) {
      for (const outputItem of n8nResult.output) {
        if (outputItem?.content && Array.isArray(outputItem.content)) {
          for (const contentItem of outputItem.content) {
            if (contentItem?.type === 'output_text' && contentItem?.text) {
              return contentItem.text
            }
          }
        }
      }
    }
  }
  
  return null
}

// Helper to extract JSON from various n8n/OpenAI response formats
function extractJsonFromResponse(n8nResult: any): QuickWorkflowResponse {
  try {
    // First, try to extract the text content
    const textContent = extractTextFromN8nResponse(n8nResult)
    
    if (textContent) {
      console.log('Raw text content (first 300 chars):', textContent.substring(0, 300))
      // Clean the string (remove BOM, code fences, etc.)
      const cleaned = cleanJsonString(textContent)
      console.log('Cleaned content (first 100 chars):', cleaned.substring(0, 100))
      
      // Try to parse directly first
      try {
        return JSON.parse(cleaned)
      } catch (parseError) {
        // If that fails due to control characters, escape them and retry
        console.log('Initial parse failed, escaping control characters in strings...')
        const escaped = escapeControlCharsInJsonStrings(cleaned)
        return JSON.parse(escaped)
      }
    }
    
    // Check if n8nResult itself is already the parsed object (flat: title at top level, or nested: article + project_title)
    if (typeof n8nResult === 'object' && !Array.isArray(n8nResult)) {
      if (n8nResult.title || n8nResult.project_title || n8nResult.article) {
        return n8nResult as QuickWorkflowResponse
      }
    }
    
    // Check for direct content property
    if (n8nResult?.content) {
      if (typeof n8nResult.content === 'string') {
        const cleaned = cleanJsonString(n8nResult.content)
        try {
          return JSON.parse(cleaned)
        } catch {
          const escaped = escapeControlCharsInJsonStrings(cleaned)
          return JSON.parse(escaped)
        }
      }
      return n8nResult.content as QuickWorkflowResponse
    }

    console.error('Could not find extractable content in response structure')
    throw new Error('Could not extract content from n8n response')
  } catch (error) {
    console.error('Error extracting JSON from response:', error)
    console.error('Full n8n result:', JSON.stringify(n8nResult).substring(0, 1000))
    throw new Error('Failed to parse AI response')
  }
}

// Transform the response into project and article data.
// Supports: top-level or article.project_title/description, nested article, flat format, array-wrapped response.
function extractQuickWorkflowContent(n8nResult: any): {
  project_title: string
  project_description: string
  article: Record<string, any>
} {
  const parsed = extractJsonFromResponse(n8nResult)
  
  console.log('Parsed response:', JSON.stringify(parsed).substring(0, 500))
  
  // Project fields: top level first, then inside article (Merge/agent often put them in article)
  const project_title =
    parsed.project_title ??
    parsed.article?.project_title ??
    parsed.title ??
    'Untitled Project'
  const project_description =
    parsed.project_description ??
    parsed.article?.project_description ??
    parsed.excerpt ??
    ''
  
  // Article: use nested object when present, otherwise flatten from top-level fields
  let article: Record<string, any>
  if (parsed.article && typeof parsed.article === 'object') {
    article = { ...parsed.article }
    // Don't store project-level fields inside the article output
    delete article.project_title
    delete article.project_description
    // Merge in top-level article-like fields (workflow may put them at root)
    const topLevelArticleFields = [
      'suggested_sections', 'category', 'tags', 'meta_title', 'meta_description',
      'image_prompt', 'suggested_image_prompt', 'photo_caption',
    ]
    const parsedRecord = parsed as Record<string, unknown>
    for (const key of topLevelArticleFields) {
      if (parsedRecord[key] !== undefined && article[key] === undefined) {
        article[key] = parsedRecord[key]
      }
    }
  } else {
    const { project_title: _pt, project_description: _pd, ...articleFields } = parsed as Record<string, unknown>
    article = articleFields
  }
  
  return {
    project_title,
    project_description,
    article,
  }
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
        recording_id: {
          required: true,
          type: 'string',
          validator: validateRecordingId,
        },
        recording_title: {
          required: false,
          type: 'string',
          validator: (val) => val === undefined ? 'Recording' : validateRecordingTitle(val),
        },
        transcription: {
          required: true,
          type: 'string',
          validator: validateTranscription,
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Validation failed', message: error.message },
        { status: 400 }
      )
    }

    const { recording_id, recording_title, transcription } = validatedData

    // Authorization check - verify user owns the recording
    try {
      await requireRecordingOwnership(recording_id, user.id, supabase)
    } catch (error: any) {
      return forbiddenResponse(error.message)
    }

    // Call n8n webhook with quick mode. Pass the recording as the explicit single source so the
    // workflow knows exactly what to use for the project and article (same shape as main workflow inputs).
    const n8nPayload = {
      mode: 'quick',
      recording_id,
      recording_title: recording_title || 'Recording',
      transcription,
      // Single source input: the recording the user clicked "Create Project and Article" on.
      // Use same shape as main workflow (inputs array) so the workflow can use inputs[0].content etc.
      inputs: [
        {
          id: recording_id,
          type: 'recording',
          content: transcription,
          file_name: recording_title || 'Recording',
          file_path: null,
          image_url: null,
        },
      ],
    }

    const webhookUrl = getN8nWebhookUrl()
    console.log('Calling n8n webhook...')
    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Workflow service unavailable' },
        { status: 503 }
      )
    }

    const n8nResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(n8nPayload),
    })

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text()
      console.error('n8n webhook error:', n8nResponse.status, errorText)
      return NextResponse.json({ error: 'Workflow execution failed' }, { status: 500 })
    }

    // Get raw text first to handle edge cases
    const responseText = await n8nResponse.text()
    console.log('n8n raw response (first 500 chars):', responseText.substring(0, 500))
    
    if (!responseText || responseText.trim() === '') {
      console.error('n8n returned empty response')
      return NextResponse.json({ error: 'Workflow returned empty response' }, { status: 500 })
    }

    let n8nResult: any
    try {
      n8nResult = JSON.parse(responseText)
    } catch (parseError) {
      console.error('Failed to parse n8n response as JSON:', parseError)
      return NextResponse.json({ error: 'Invalid workflow response format' }, { status: 500 })
    }

    // Unwrap common n8n response shapes
    // - Respond to Webhook "First Incoming Item": payload in .json
    // - Or body is array from Merge: [{ json: response }] -> use first item's .json or the item itself
    let unwrapped = n8nResult?.json ?? n8nResult?.body ?? n8nResult?.data
    if (Array.isArray(n8nResult) && n8nResult.length > 0) {
      const first = n8nResult[0]
      unwrapped = first?.json ?? first
    }
    if (unwrapped && typeof unwrapped === 'object' && (unwrapped.project_title ?? unwrapped.article ?? unwrapped.title)) {
      n8nResult = unwrapped
    }

    // Extract the AI-generated content
    let content
    try {
      content = extractQuickWorkflowContent(n8nResult)
    } catch (parseError: any) {
      console.error('Quick workflow: could not extract content from n8n response.', parseError?.message)
      console.error('n8n response top-level keys:', n8nResult && typeof n8nResult === 'object' ? Object.keys(n8nResult) : typeof n8nResult)
      return NextResponse.json(
        {
          error:
            'Could not read workflow response. The workflow must return JSON with project_title, project_description, and article (with title and content). See server logs for details.',
        },
        { status: 502 }
      )
    }
    
    console.log('Extracted content:', { 
      project_title: content.project_title, 
      project_description: content.project_description?.substring(0, 100),
      article_title: content.article.title 
    })

    // Create the project (always private when created from quick workflow)
    const { data: project, error: projectError } = await supabase
      .from('diffuse_projects')
      .insert({
        workspace_id: null, // Personal project
        name: content.project_title,
        description: content.project_description,
        visibility: 'private', // Always private for quick workflow
        status: 'active',
        created_by: user.id,
      })
      .select()
      .single()

    if (projectError) {
      console.error('Error creating project:', projectError)
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
    }
    
    console.log('Created project:', project.id)

    // Create the input (linked to recording)
    const { data: input, error: inputError } = await supabase
      .from('diffuse_project_inputs')
      .insert({
        project_id: project.id,
        type: 'text',
        content: transcription,
        file_name: recording_title || 'Recording Transcription',
        metadata: {
          source: 'recording',
          recording_id: recording_id,
        },
        created_by: user.id,
      })
      .select()
      .single()

    if (inputError) {
      console.error('Error creating input:', inputError)
      // Try to clean up the project
      await supabase.from('diffuse_projects').delete().eq('id', project.id)
      return NextResponse.json({ error: 'Failed to create input' }, { status: 500 })
    }
    
    console.log('Created input:', input.id)

    // Prepare article content with author
    const articleContent = {
      ...content.article,
      author: 'Diffuse.AI',
    }

    // Extract image from workflow response (same shape as main workflow: image_base64 + content_type)
    const imageBase64 =
      typeof n8nResult?.image_base64 === 'string' && n8nResult.image_base64.length > 100
        ? {
            data: n8nResult.image_base64.replace(/\s/g, ''),
            contentType: typeof n8nResult?.content_type === 'string' ? n8nResult.content_type : undefined,
          }
        : typeof n8nResult?.imageBase64 === 'string' && n8nResult.imageBase64.length > 100
          ? {
              data: n8nResult.imageBase64.replace(/\s/g, ''),
              contentType: typeof n8nResult?.content_type === 'string' ? n8nResult.content_type : undefined,
            }
          : null
    const hasWorkflowImage = !!imageBase64

    // Create the output (cover_photo_path set after we upload the workflow image, if any)
    const { data: output, error: outputError } = await supabase
      .from('diffuse_project_outputs')
      .insert({
        project_id: project.id,
        input_id: input.id,
        content: JSON.stringify(articleContent),
        workflow_status: 'completed',
        cover_photo_path: hasWorkflowImage ? null : undefined,
      })
      .select()
      .single()

    if (outputError) {
      console.error('Error creating output:', outputError)
      // Try to clean up
      await supabase.from('diffuse_project_inputs').delete().eq('id', input.id)
      await supabase.from('diffuse_projects').delete().eq('id', project.id)
      return NextResponse.json({ error: 'Failed to create output' }, { status: 500 })
    }

    console.log('Created output:', output.id)

    // Persist workflow image and set cover + add as input (same as main workflow)
    let generatedImagePathForInput: string | null = null
    if (output?.id && imageBase64) {
      const storageClient = createAdminClient() ?? supabase
      if (!createAdminClient()) {
        console.warn('[workflow/quick] SUPABASE_SERVICE_ROLE_KEY not set; using user client for storage upload.')
      }
      try {
        const buf = Buffer.from(imageBase64.data, 'base64')
        const contentType = imageBase64.contentType || 'image/png'
        const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
        const storagePath = `${user.id}/${project.id}/cover-${output.id}-generated.${ext}`
        const { error: uploadError } = await storageClient.storage
          .from('project-files')
          .upload(storagePath, buf, { contentType: contentType.split(';')[0].trim(), upsert: true })
        if (!uploadError) {
          generatedImagePathForInput = storagePath
          await supabase
            .from('diffuse_project_outputs')
            .update({ cover_photo_path: storagePath, updated_at: new Date().toISOString() })
            .eq('id', output.id)
          console.log('[workflow/quick] Generated image uploaded at', storagePath)
        } else {
          console.error('[workflow/quick] Image upload failed:', uploadError.message)
        }
      } catch (e) {
        console.error('[workflow/quick] Image decode/upload failed:', e instanceof Error ? e.message : e)
      }
    }

    if (output?.id && generatedImagePathForInput) {
      const article = content.article
      const imageTitle = (typeof article?.title === 'string' && article.title.trim()) ? article.title.trim() : 'Diffuse Generated Image'
      const photoCaption = (typeof article?.photo_caption === 'string' && article.photo_caption.trim()) ? article.photo_caption.trim() : undefined
      const photoCredit = (typeof article?.photo_credit === 'string' && article.photo_credit.trim()) ? article.photo_credit.trim() : undefined
      const ext = generatedImagePathForInput.includes('.') ? generatedImagePathForInput.split('.').pop()?.toLowerCase() || 'png' : 'png'
      const safeExt = /^(png|jpg|jpeg|webp|gif)$/i.test(ext || '') ? ext : 'png'
      const { error: inputErr } = await supabase
        .from('diffuse_project_inputs')
        .insert({
          project_id: project.id,
          type: 'image',
          content: null,
          file_path: generatedImagePathForInput,
          file_name: imageTitle,
          metadata: {
            source: 'workflow_generated',
            output_id: output.id,
            ...(photoCaption && { photo_caption: photoCaption }),
            ...(photoCredit && { photo_credit: photoCredit }),
          },
          created_by: user.id,
        })
      if (inputErr) {
        console.error('[workflow/quick] Failed to add generated image as input:', inputErr.message)
      } else {
        console.log('[workflow/quick] Generated image added as input for output', output.id)
      }
    }

    console.log('Quick workflow completed successfully for project:', project.id)

    const response = NextResponse.json({ 
      success: true, 
      project_id: project.id,
      project: project,
      input: input,
      output: output,
      message: 'Project and article created successfully'
    })

    // Add rate limit headers
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    return response

  } catch (error: any) {
    console.error('Quick workflow API error:', error)
    
    // Don't expose internal error details
    if (error.message && (error.message.includes('Unauthorized') || error.message.includes('Forbidden'))) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes('Unauthorized') ? 401 : 403 }
      )
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

