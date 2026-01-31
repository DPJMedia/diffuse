import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limit'
import { requireAuth, requireProjectOwnership, unauthorizedResponse, forbiddenResponse } from '@/lib/security/authorization'
import { validateSchema, validateProjectId, validateOutputType } from '@/lib/security/validation'

// N8N webhook URL from environment variable (never hardcode API endpoints)
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL
if (!N8N_WEBHOOK_URL) {
  throw new Error('N8N_WEBHOOK_URL environment variable is required')
}

// Helper to extract the actual article JSON from various n8n/OpenAI response formats
function extractArticleContent(n8nResult: any): string {
  try {
    // Case 1: Direct output string (Simplify Output ON)
    if (typeof n8nResult.output === 'string') {
      return n8nResult.output
    }

    // Case 2: Array response from OpenAI (Simplify Output OFF)
    if (Array.isArray(n8nResult)) {
      const firstItem = n8nResult[0]
      
      // Check for nested output array with message content
      if (firstItem?.output && Array.isArray(firstItem.output)) {
        const message = firstItem.output.find((o: any) => o.type === 'message')
        if (message?.content && Array.isArray(message.content)) {
          const textContent = message.content.find((c: any) => c.type === 'output_text')
          if (textContent?.text) {
            return textContent.text
          }
        }
      }
      
      // Check for direct content
      if (firstItem?.content) {
        if (Array.isArray(firstItem.content)) {
          const textContent = firstItem.content.find((c: any) => c.type === 'output_text' || c.text)
          if (textContent?.text) {
            return textContent.text
          }
        }
        return typeof firstItem.content === 'string' ? firstItem.content : JSON.stringify(firstItem.content)
      }
    }

    // Case 3: Object with output array
    if (n8nResult.output && Array.isArray(n8nResult.output)) {
      const message = n8nResult.output.find((o: any) => o.type === 'message')
      if (message?.content && Array.isArray(message.content)) {
        const textContent = message.content.find((c: any) => c.type === 'output_text')
        if (textContent?.text) {
          return textContent.text
        }
      }
    }

    // Case 4: Direct content property
    if (n8nResult.content) {
      return typeof n8nResult.content === 'string' ? n8nResult.content : JSON.stringify(n8nResult.content)
    }

    // Fallback: stringify the whole thing
    return JSON.stringify(n8nResult)
  } catch (error) {
    console.error('Error extracting content:', error)
    return JSON.stringify(n8nResult)
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
        project_id: {
          required: true,
          type: 'string',
          validator: validateProjectId,
        },
        output_type: {
          required: false,
          type: 'string',
          validator: (val) => val === undefined ? 'article' : validateOutputType(val),
        },
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Validation failed', message: error.message },
        { status: 400 }
      )
    }

    const { project_id, output_type } = validatedData

    // Authorization check - verify user owns the project
    try {
      await requireProjectOwnership(project_id, user.id, supabase)
    } catch (error: any) {
      return forbiddenResponse(error.message)
    }

    // Fetch all inputs for this project
    const { data: inputs, error: inputsError } = await supabase
      .from('diffuse_project_inputs')
      .select('*')
      .eq('project_id', project_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    if (inputsError) {
      console.error('Error fetching inputs:', inputsError)
      return NextResponse.json({ error: 'Failed to fetch inputs' }, { status: 500 })
    }

    if (!inputs || inputs.length === 0) {
      return NextResponse.json({ error: 'No inputs found for this project' }, { status: 400 })
    }

    // Cover photo: one per project, stored in inputs (type cover_photo). Now sent to workflow for subtitle generation.
    // The workflow can analyze the cover photo with vision AI and generate a subtitle related to the image and article.
    // The cover photo is attached to every output when saving and populates every input/output in the project; when updated, all get the same cover.
    const coverPhotoInput = inputs.find((i: any) => i.type === 'cover_photo')
    const coverPhotoPathFromDb = coverPhotoInput?.file_path ?? null
    const photoCreditFromInput =
      coverPhotoInput?.metadata?.photo_credit != null && String(coverPhotoInput.metadata.photo_credit).trim() !== ''
        ? String(coverPhotoInput.metadata.photo_credit).trim()
        : null
    const inputsForWorkflow = inputs.filter((input: any) => input.type !== 'cover_photo')

    if (inputsForWorkflow.length === 0) {
      return NextResponse.json({ error: 'Add at least one content input (text, recording, audio, document, or image) to generate output. Cover photo alone is not enough.' }, { status: 400 })
    }

    // Generate signed URL for cover photo so n8n can fetch it for vision analysis
    let coverPhotoSignedUrl: string | null = null
    if (coverPhotoPathFromDb) {
      const storageClient = createAdminClient() ?? supabase
      const { data: signed, error: signedError } = await storageClient.storage
        .from('project-files')
        .createSignedUrl(coverPhotoPathFromDb, 3600) // 1 hour expiry
      
      if (!signedError && signed?.signedUrl) {
        coverPhotoSignedUrl = signed.signedUrl
      } else if (signedError) {
        console.warn('Failed to generate signed URL for cover photo:', signedError)
      }
    }

    // Prepare payload for n8n - now includes cover_photo_url when present for vision-based subtitle generation
    const n8nPayload = {
      project_id,
      output_type, // 'article' or 'ad' - n8n will branch based on this
      inputs: inputsForWorkflow.map((input: any) => ({
        id: input.id,
        type: input.type,
        content: input.content || '',
        file_name: input.file_name || 'Untitled',
        image_url: input.type === 'image' ? (input.metadata?.storage_url ?? undefined) : undefined,
        file_path: input.file_path || undefined
      })),
      cover_photo_url: coverPhotoSignedUrl ?? undefined, // Cover photo URL for vision AI to generate subtitle
      photo_credit: photoCreditFromInput ?? undefined, // Only include when user set it on cover photo; workflow omits from output if absent
    }

    // Call n8n webhook
    if (!N8N_WEBHOOK_URL) {
      return NextResponse.json(
        { error: 'Workflow service unavailable' },
        { status: 503 }
      )
    }
    
    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(n8nPayload),
    })

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text()
      console.error('n8n webhook error:', errorText)
      return NextResponse.json({ error: 'Workflow execution failed' }, { status: 500 })
    }

    const n8nResult = await n8nResponse.json()
    
    // Extract the AI-generated content from n8n response
    let extractedContent = extractArticleContent(n8nResult)
    // Strip markdown code fences if present (e.g. ```json ... ```)
    const codeBlockMatch = extractedContent.match(/^[\s\n]*```(?:json)?\s*([\s\S]*?)```[\s\n]*$/m)
    if (codeBlockMatch) {
      extractedContent = codeBlockMatch[1].trim()
    }
    
    // Try to parse as JSON and add author field
    let finalContent = extractedContent
    try {
      const parsed = JSON.parse(extractedContent)
      // Add default author
      parsed.author = 'Diffuse.AI'
      finalContent = JSON.stringify(parsed)
    } catch {
      // Not valid JSON, use as-is
    }

    // Save the output to Supabase - cover image comes from the database (same place as input: project-files path from diffuse_project_inputs)
    const primaryInputId = inputsForWorkflow[0]?.id ?? inputs[0]?.id ?? null
    const { data: output, error: outputError } = await supabase
      .from('diffuse_project_outputs')
      .insert({
        project_id,
        input_id: primaryInputId,
        content: finalContent,
        output_type, // 'article' or 'ad'
        workflow_status: 'completed',
        cover_photo_path: coverPhotoPathFromDb, // always set from DB: same storage path as project cover input
      })
      .select()
      .single()

    if (outputError) {
      console.error('Error saving output:', outputError)
      // RLS or permission denial (e.g. shared user before policy allows insert)
      const isPermissionError =
        outputError.code === '42501' ||
        (outputError.message && /policy|permission|row-level security/i.test(outputError.message))
      const status = isPermissionError ? 403 : 500
      const message = isPermissionError
        ? "You don't have permission to add outputs to this project. Only the project owner can generate outputs until the database policy is updated."
        : 'Failed to save output'
      return NextResponse.json({ error: message }, { status })
    }

    const response = NextResponse.json({ 
      success: true, 
      output,
      message: 'Article generated successfully'
    })

    // Add rate limit headers
    const rateLimitHeaders = getRateLimitHeaders(request, 'expensive')
    Object.entries(rateLimitHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    return response

  } catch (error: any) {
    console.error('Workflow API error:', error)
    
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
