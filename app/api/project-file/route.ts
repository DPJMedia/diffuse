import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, unauthorizedResponse, forbiddenResponse, verifyProjectOwnership } from '@/lib/security/authorization'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * GET /api/project-file?path=<encoded-storage-path>
 *
 * Serves a file from the project-files bucket. Anyone with access to the project
 * (owner or org viewer/editor) can load it. Access is checked with verifyProjectOwnership;
 * when SUPABASE_SERVICE_ROLE_KEY is set, the download uses the admin client so storage RLS
 * does not block editors/viewers (recommended for cover photos to display for all users).
 *
 * Cover photo: one per project, stored in diffuse_project_inputs (type cover_photo).
 * It is NOT sent to the workflow; the workflow pulls every input except the cover photo.
 * The same cover photo path populates every input and output for that project.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth().catch(() => null)
    if (!authResult) return unauthorizedResponse()
    const { user, supabase } = authResult

    const pathParam = request.nextUrl.searchParams.get('path')
    if (!pathParam) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 })
    }
    let path: string
    try {
      path = pathParam
      for (let i = 0; i < 3; i++) {
        const decoded = decodeURIComponent(path)
        if (decoded === path) break
        path = decoded
      }
    } catch {
      return NextResponse.json({ error: 'Invalid path encoding' }, { status: 400 })
    }
    if (!path || path.includes('..') || path.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }
    const segments = path.split('/').filter(Boolean)
    if (segments.length < 2) {
      return NextResponse.json({ error: 'Invalid path format' }, { status: 400 })
    }
    const projectId = segments[1]
    const hasAccess = await verifyProjectOwnership(projectId, user.id, supabase)
    if (!hasAccess) return forbiddenResponse('You do not have access to this project')

    // Use admin client when available so download bypasses storage RLS (access already verified above)
    const storageClient = createAdminClient() ?? supabase
    const { data, error } = await storageClient.storage
      .from('project-files')
      .download(path)

    if (error || !data) {
      console.error('Project file download error:', error, 'path:', path)
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const ext = path.split('.').pop()?.toLowerCase()
    const contentType =
      ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'webp'
              ? 'image/webp'
              : 'application/octet-stream'

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    console.error('Project file API error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
