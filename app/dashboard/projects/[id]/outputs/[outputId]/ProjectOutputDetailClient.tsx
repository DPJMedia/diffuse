'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import OutputDetailView from '@/components/dashboard/OutputDetailView'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import { OutputDetailSkeleton } from '@/components/dashboard/Skeletons'
import { getRoleLevel } from '@/lib/projects/projectRoles'
import { formatDateTime } from '@/lib/utils/format'
import type { DiffuseProject, DiffuseProjectOutput } from '@/types/database'

/** Avoid useSearchParams() here — it suspends and has caused blank main content behind dashboard Suspense. */
function useReturnToFromUrl() {
  const [returnTo, setReturnTo] = useState<string | null>(null)
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('returnTo')
      setReturnTo(q)
    } catch {
      setReturnTo(null)
    }
  }, [])
  return returnTo
}

export default function ProjectOutputDetailClient() {
  const params = useParams()
  const router = useRouter()
  const returnTo = useReturnToFromUrl()
  const { user } = useAuth()
  const projectId = (params?.id as string) || ''
  const outputId = (params?.outputId as string) || ''

  const projectBackHref = useMemo(() => {
    return returnTo && returnTo.startsWith('/dashboard/')
      ? `/dashboard/projects/${projectId}?returnTo=${encodeURIComponent(returnTo)}`
      : `/dashboard/projects/${projectId}`
  }, [projectId, returnTo])

  const [project, setProject] = useState<DiffuseProject | null>(null)
  const [output, setOutput] = useState<DiffuseProjectOutput | null>(null)
  const [fallbackCoverPhotoPath, setFallbackCoverPhotoPath] = useState<string | null>(null)
  const [userProjectRole, setUserProjectRole] = useState<string>('viewer')
  const [loading, setLoading] = useState(true)
  /** Synced from OutputDetailView — drives header status line on full-page layout */
  const [outputDetailEditing, setOutputDetailEditing] = useState(false)
  const [outputDetailPendingRegen, setOutputDetailPendingRegen] = useState(false)

  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const projectBackHrefRef = useRef(projectBackHref)
  projectBackHrefRef.current = projectBackHref

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!projectId || !outputId) {
      setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
    }
    try {
      const { data: projectData, error: projectError } = await supabase
        .from('diffuse_projects')
        .select('*')
        .eq('id', projectId)
        .single()

      if (projectError || !projectData) {
        if (!silent) setLoading(false)
        router.push('/dashboard')
        return
      }
      setProject(projectData)

      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (currentUser) {
        if (projectData.created_by === currentUser.id) {
          setUserProjectRole('owner')
        } else if (projectData.visible_to_orgs && projectData.visible_to_orgs.length > 0) {
          let highestRole = 'viewer'
          for (const orgId of projectData.visible_to_orgs) {
            const { data: orgData } = await supabase
              .from('diffuse_workspaces')
              .select('owner_id')
              .eq('id', orgId)
              .single()

            if (orgData?.owner_id === currentUser.id) {
              highestRole = 'owner'
              break
            }

            const { data: memberData } = await supabase
              .from('diffuse_workspace_members')
              .select('role')
              .eq('workspace_id', orgId)
              .eq('user_id', currentUser.id)
              .single()

            if (memberData && getRoleLevel(memberData.role) > getRoleLevel(highestRole)) {
              highestRole = memberData.role
            }
          }
          setUserProjectRole(highestRole)
        } else {
          setUserProjectRole('viewer')
        }
      }

      const { data: outputData, error: outputError } = await supabase
        .from('diffuse_project_outputs')
        .select('*')
        .eq('id', outputId)
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .single()

      if (outputError || !outputData) {
        if (!silent) setLoading(false)
        router.push(projectBackHrefRef.current)
        return
      }
      setOutput(outputData)

      const { data: coverInput } = await supabase
        .from('diffuse_project_inputs')
        .select('file_path')
        .eq('project_id', projectId)
        .eq('type', 'cover_photo')
        .is('deleted_at', null)
        .maybeSingle()

      setFallbackCoverPhotoPath(coverInput?.file_path ?? null)
      if (!silent) {
        setLoading(false)
      }
    } catch (e) {
      console.error('Error loading output detail:', e)
      if (!silent) {
        setLoading(false)
      }
      router.push('/dashboard')
    }
  }, [projectId, outputId, router, supabase])

  useEffect(() => {
    fetchData({ silent: false })
  }, [fetchData])

  useEffect(() => {
    if (!outputId) return

    const channel = supabase
      .channel(`output-detail-${outputId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_project_outputs',
          filter: `id=eq.${outputId}`,
        },
        () => {
          fetchData({ silent: true })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [outputId, supabase, fetchData])

  useEffect(() => {
    setOutputDetailEditing(false)
  }, [outputId])

  const isProjectOwner = project?.created_by === user?.id
  const canEdit = isProjectOwner || getRoleLevel(userProjectRole) >= getRoleLevel('editor')
  const canDelete = isProjectOwner || getRoleLevel(userProjectRole) >= getRoleLevel('admin')

  const handleDeleteOutput = async (id: string) => {
    if (!confirm('Are you sure you want to delete this output? This cannot be undone.')) return

    try {
      const { error } = await supabase.from('diffuse_project_outputs').delete().eq('id', id)

      if (error) throw error
      router.push(projectBackHrefRef.current)
    } catch (error) {
      console.error('Error deleting output:', error)
      alert('Failed to delete output')
      throw error
    }
  }

  if (loading) {
    return <OutputDetailSkeleton />
  }

  if (!project || !output) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-medium-gray">
        <LoadingSpinner size="lg" />
        <p className="text-body-sm">Redirecting…</p>
      </div>
    )
  }

  const ws = output.workflow_status
  const reeditCount = output.reedit_count ?? 0
  const statusLabel =
    ws === 'completed'
      ? `COMPLETED (${reeditCount} EDIT${reeditCount !== 1 ? 'S' : ''})`
      : (ws && String(ws).toUpperCase()) || 'UNKNOWN'
  const statusColorClass =
    ws === 'pending'
      ? 'text-pale-blue'
      : ws === 'processing'
        ? 'text-cosmic-orange'
        : ws === 'completed'
          ? project.project_type === 'advertisement'
            ? 'text-amber-400'
            : 'text-teal-400'
          : ws === 'failed'
            ? 'text-red-400'
            : 'text-medium-gray'

  const headerPendingSurface = outputDetailEditing || outputDetailPendingRegen
  const headerStatusLabel = headerPendingSurface
    ? 'UNSAVED CHANGES (PENDING EDITS)'
    : statusLabel
  const headerStatusClassName = headerPendingSurface
    ? 'uppercase font-medium tracking-wider text-cosmic-orange'
    : `uppercase font-medium tracking-wider ${statusColorClass}`

  return (
    <div>
      <div className="mb-6">
        <button
          type="button"
          onClick={() => router.push(projectBackHref)}
          className="inline-flex items-center gap-1.5 text-medium-gray hover:text-secondary-white transition-colors text-body-sm mb-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {project.name}
        </button>
        <h1 className="text-heading-lg text-secondary-white font-medium leading-tight">Output Details</h1>
        <p className="text-body-sm text-medium-gray mt-1">
          <span className={headerStatusClassName}>{headerStatusLabel}</span>
          <span> · </span>
          <span>{formatDateTime(output.created_at)}</span>
        </p>
      </div>

      <OutputDetailView
        layout="page"
        output={output}
        onEditingChange={setOutputDetailEditing}
        onRegenPendingChange={setOutputDetailPendingRegen}
        onDismiss={() => router.push(projectBackHref)}
        onUpdate={() => fetchData({ silent: true })}
        onReeditComplete={(updated) => setOutput(updated)}
        onDelete={handleDeleteOutput}
        canEdit={canEdit}
        canDelete={canDelete}
        fallbackCoverPhotoPath={fallbackCoverPhotoPath}
        projectType={
          project.project_type === 'advertisement'
            ? 'advertisement'
            : project.project_type === 'project'
              ? 'article'
              : undefined
        }
      />
    </div>
  )
}
