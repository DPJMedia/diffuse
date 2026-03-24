'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import OutputDetailView from '@/components/dashboard/OutputDetailView'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
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

  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const projectBackHrefRef = useRef(projectBackHref)
  projectBackHrefRef.current = projectBackHref

  const fetchData = useCallback(async () => {
    if (!projectId || !outputId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data: projectData, error: projectError } = await supabase
        .from('diffuse_projects')
        .select('*')
        .eq('id', projectId)
        .single()

      if (projectError || !projectData) {
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
      setLoading(false)
    } catch (e) {
      console.error('Error loading output detail:', e)
      setLoading(false)
      router.push('/dashboard')
    }
  }, [projectId, outputId, router, supabase])

  useEffect(() => {
    fetchData()
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
          fetchData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [outputId, supabase, fetchData])

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
    return (
      <div className="animate-pulse">
        <div className="mb-6">
          <div className="h-5 w-40 bg-white/10 rounded mb-3" />
          <div className="h-8 w-56 bg-white/10 rounded mb-2" />
        </div>
        <div className="glass-container max-w-4xl mx-auto h-96" />
      </div>
    )
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
          <span className={`uppercase font-medium tracking-wider ${statusColorClass}`}>{statusLabel}</span>
          <span> · </span>
          <span>{formatDateTime(output.created_at)}</span>
        </p>
      </div>

      <OutputDetailView
        layout="page"
        output={output}
        onDismiss={() => router.push(projectBackHref)}
        onUpdate={fetchData}
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
