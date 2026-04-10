'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatDuration, sanitizeStorageFilename } from '@/lib/utils/format'
import { useAuth } from '@/contexts/AuthContext'
import { ProjectDetailSkeleton } from '@/components/dashboard/Skeletons'
import EmptyState from '@/components/dashboard/EmptyState'
import InputDetailModal from '@/components/dashboard/InputDetailModal'
import SelectRecordingModal from '@/components/dashboard/SelectRecordingModal'
import WebScrapingModal from '@/components/dashboard/WebScrapingModal'
import GenerateOptionsModal, { WORKFLOW_PREFERENCES_KEY, type WorkflowPreferences } from '@/components/dashboard/GenerateOptionsModal'
import QuickGenerateModal from '@/components/dashboard/QuickGenerateModal'
import { addRecentProject } from '@/components/dashboard/DashboardNav'
import { useBodyScrollLock } from '@/components/dashboard/ModalShell'
import { ConfirmModal } from '@/components/dashboard/ConfirmModal'
import type { DiffuseProject, DiffuseProjectInput, DiffuseProjectOutput, ProjectVisibility, UserRole, InputType, OutputType } from '@/types/database'
import { getRoleLevel } from '@/lib/projects/projectRoles'
import { parseOutputContentToStructuredArticle } from '@/lib/output-content'
// tus-js-client will be dynamically imported when needed

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, workspaces } = useAuth()
  const projectId = params.id as string

  // Get initial tab from URL query parameter
  const tabParam = searchParams.get('tab')
  const initialTab = (tabParam === 'inputs' || tabParam === 'outputs' || tabParam === 'visibility' || tabParam === 'trash') 
    ? tabParam 
    : 'inputs'

  // Back destination: if we came from an organization, return there; otherwise dashboard
  const returnTo = searchParams.get('returnTo')
  const backHref = returnTo && returnTo.startsWith('/dashboard/') ? returnTo : '/dashboard'

  const hrefToOutputDetail = (outputId: string) => {
    const path = `/dashboard/projects/${projectId}/outputs/${outputId}`
    return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path
  }

  const [project, setProject] = useState<DiffuseProject | null>(null)
  const [inputs, setInputs] = useState<DiffuseProjectInput[]>([])
  const [outputs, setOutputs] = useState<DiffuseProjectOutput[]>([])
  const [activeTab, setActiveTab] = useState<'inputs' | 'outputs' | 'visibility' | 'trash'>(initialTab)
  const [loading, setLoading] = useState(true)
  const [selectedInput, setSelectedInput] = useState<DiffuseProjectInput | null>(null)
  const [showRecordingModal, setShowRecordingModal] = useState(false)
  const [showWebScrapingModal, setShowWebScrapingModal] = useState(false)
  const [showTextInputModal, setShowTextInputModal] = useState(false)
  const [textInputContent, setTextInputContent] = useState('')
  const [textInputTitle, setTextInputTitle] = useState('')
  const [savingTextInput, setSavingTextInput] = useState(false)
  const [editProjectName, setEditProjectName] = useState('')
  const [editProjectDescription, setEditProjectDescription] = useState('')
  const [visibility, setVisibility] = useState<ProjectVisibility>('private')
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([])
  const [selectedHomeOrg, setSelectedHomeOrg] = useState<string | null>(null)
  const [savingVisibility, setSavingVisibility] = useState(false)
  const [userProjectRole, setUserProjectRole] = useState<string>('viewer')
  const [generatingArticle, setGeneratingArticle] = useState(false)
  const [generateSource, setGenerateSource] = useState<'quick' | 'refine' | null>(null)
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [showAddInputDropdown, setShowAddInputDropdown] = useState(false)
  const [showQuickGenerateModal, setShowQuickGenerateModal] = useState(false)
  const [showGenerateOptionsModal, setShowGenerateOptionsModal] = useState(false)
  const [generateOptionsInitialValues, setGenerateOptionsInitialValues] = useState<WorkflowPreferences>({})
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const addInputDropdownRef = useRef<HTMLDivElement>(null)
  const threeDotsRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const [showThreeDotsMenu, setShowThreeDotsMenu] = useState(false)
  const [expandedOutputId, setExpandedOutputId] = useState<string | null>(null)
  const [visibilitySectionOpen, setVisibilitySectionOpen] = useState(false)
  const [settingsSectionOpen, setSettingsSectionOpen] = useState(false)
  const [imagesSectionOpen, setImagesSectionOpen] = useState(true)
  const [loadingDots, setLoadingDots] = useState('.')
  const [showDeleteInputsConfirm, setShowDeleteInputsConfirm] = useState(false)
  const [showDeleteOutputsConfirm, setShowDeleteOutputsConfirm] = useState(false)
  const [showDeleteProjectConfirm, setShowDeleteProjectConfirm] = useState(false)
  useBodyScrollLock(showTextInputModal || showProjectSettings)

  const primaryOutputAwaitingWorkflow =
    outputs[0] &&
    (outputs[0].workflow_status === 'pending' || outputs[0].workflow_status === 'processing')

  // Animate loading dots (generate in flight, or newest output still running async workflow)
  useEffect(() => {
    if (!generatingArticle && !primaryOutputAwaitingWorkflow) {
      setLoadingDots('.')
      return
    }
    const interval = setInterval(() => {
      setLoadingDots(prev => {
        if (prev === '.') return '..'
        if (prev === '..') return '...'
        return '.'
      })
    }, 500)
    return () => clearInterval(interval)
  }, [generatingArticle, primaryOutputAwaitingWorkflow])

  // Close Add Input dropdown when clicking outside (same behavior as modals)
  useEffect(() => {
    if (!showAddInputDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (addInputDropdownRef.current && !addInputDropdownRef.current.contains(e.target as Node)) {
        setShowAddInputDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddInputDropdown])

  // Close three-dots menu when clicking outside
  useEffect(() => {
    if (!showThreeDotsMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (threeDotsRef.current && !threeDotsRef.current.contains(e.target as Node)) {
        setShowThreeDotsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showThreeDotsMenu])

  // Permission helpers
  const isProjectOwner = project?.created_by === user?.id
  const canEdit = isProjectOwner || getRoleLevel(userProjectRole) >= getRoleLevel('editor')
  const canDelete = isProjectOwner || getRoleLevel(userProjectRole) >= getRoleLevel('admin')

  // Helper to extract article info from output content (same merge rules as output detail)
  const getOutputInfo = (output: DiffuseProjectOutput) => {
    const structured = parseOutputContentToStructuredArticle(output.content)
    if (structured) {
      return {
        title: structured.title || 'Untitled Article',
        subtitle: structured.subtitle ?? null,
        author: structured.author || 'Diffuse.AI',
        excerpt: structured.excerpt || null,
        photo_caption: structured.photo_caption ?? null,
        photo_credit: structured.photo_credit ?? null,
      }
    }
    return {
      title: 'Untitled Article',
      subtitle: null,
      author: 'Diffuse.AI',
      excerpt: null,
      photo_caption: null,
      photo_credit: null,
    }
  }

  // Helper to truncate text
  const truncateText = (text: string | null, maxLength: number): string => {
    if (!text) return ''
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + '...'
  }

  // Input type label, color, and icon for cards (shared by main and trashed inputs). Accent colors only (no orange/purple).
  const getInputTypeInfo = (input: DiffuseProjectInput) => {
    const isFromRecording = input.metadata?.source === 'recording'
    if (isFromRecording) {
      return { label: 'RECORDING', color: 'text-rose-400', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )}
    }
    switch (input.type) {
      case 'audio':
        return { label: 'AUDIO', color: 'text-fuchsia-400', icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        )}
      case 'document':
        return { label: 'DOCUMENT', color: 'text-emerald-400', icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )}
      case 'image':
        return { label: 'IMAGE', color: 'text-yellow-400', icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      case 'cover_photo':
        return { label: 'COVER PHOTO', color: 'text-lime-400', icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      case 'web_scrape':
        return { label: 'WEB SCRAPE', color: 'text-sky-400', icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        )}
      default:
        return { label: 'TEXT', color: 'text-indigo-400', icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )}
    }
  }

  const fetchProjectData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setLoading(true)
    try {
      // Fetch project
      const { data: projectData, error: projectError } = await supabase
        .from('diffuse_projects')
        .select('*')
        .eq('id', projectId)
        .single()

      if (projectError) throw projectError
      setProject(projectData)
      setVisibility(projectData.visibility || 'private')
      setSelectedOrgs(projectData.visible_to_orgs || [])
      setSelectedHomeOrg(projectData.workspace_id || null)

      // Determine user's role for this project
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (currentUser) {
        // If user created the project, they are the owner
        if (projectData.created_by === currentUser.id) {
          setUserProjectRole('owner')
        } else if (projectData.visible_to_orgs && projectData.visible_to_orgs.length > 0) {
          // Check user's role in the organizations this project is shared with
          // Get the highest role the user has across all orgs the project is shared with
          let highestRole = 'viewer'
          for (const orgId of projectData.visible_to_orgs) {
            // Check if user is the org owner
            const { data: orgData } = await supabase
              .from('diffuse_workspaces')
              .select('owner_id')
              .eq('id', orgId)
              .single()
            
            if (orgData?.owner_id === currentUser.id) {
              highestRole = 'owner'
              break
            }
            
            // Check user's member role
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

      // Fetch active inputs (not deleted)
      const { data: inputsData, error: inputsError } = await supabase
        .from('diffuse_project_inputs')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (inputsError) throw inputsError
      setInputs(inputsData || [])
      setSelectedInput(prev => {
        if (!prev) return null
        const found = (inputsData || []).find((i: DiffuseProjectInput) => i.id === prev.id)
        return found ?? prev
      })

      // Fetch active outputs (not deleted)
      const { data: outputsData, error: outputsError } = await supabase
        .from('diffuse_project_outputs')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (outputsError) throw outputsError
      setOutputs(outputsData || [])
    } catch (error) {
      console.error('Error fetching project data:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [projectId, supabase])

  useEffect(() => {
    fetchProjectData()
  }, [fetchProjectData])

  // Supabase Realtime subscriptions for instant updates
  useEffect(() => {
    if (!projectId) return

    // Subscribe to this project's changes
    const projectChannel = supabase
      .channel(`project-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_projects',
          filter: `id=eq.${projectId}`,
        },
        () => {
          void fetchProjectData({ silent: true })
        }
      )
      .subscribe()

    // Subscribe to inputs changes for this project
    const inputsChannel = supabase
      .channel(`project-inputs-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_project_inputs',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void fetchProjectData({ silent: true })
        }
      )
      .subscribe()

    // Subscribe to outputs changes for this project
    const outputsChannel = supabase
      .channel(`project-outputs-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'diffuse_project_outputs',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void fetchProjectData({ silent: true })
        }
      )
      .subscribe()

    // Cleanup subscriptions on unmount
    return () => {
      supabase.removeChannel(projectChannel)
      supabase.removeChannel(inputsChannel)
      supabase.removeChannel(outputsChannel)
    }
  }, [projectId, supabase, fetchProjectData])

  // Sync active tab with URL parameter changes
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam === 'inputs' || tabParam === 'outputs' || tabParam === 'visibility' || tabParam === 'trash') {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  // Track recent project view
  useEffect(() => {
    if (project) {
      addRecentProject({ id: project.id, name: project.name })
    }
  }, [project])

  // Filter selectedOrgs to only include organizations the user is still a member of
  useEffect(() => {
    if (workspaces && selectedOrgs.length > 0) {
      const currentOrgIds = workspaces.map(({ workspace }) => workspace.id)
      const validSelectedOrgs = selectedOrgs.filter(orgId => currentOrgIds.includes(orgId))
      
      // Only update if there's a difference (user left an org)
      if (validSelectedOrgs.length !== selectedOrgs.length) {
        setSelectedOrgs(validSelectedOrgs)
        
        // If no valid orgs left, switch to private
        if (validSelectedOrgs.length === 0 && visibility === 'public') {
          setVisibility('private')
        }
      }
    }
  }, [workspaces, selectedOrgs, visibility])

  const handleSaveTextInput = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!textInputContent.trim()) return

    setSavingTextInput(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('diffuse_project_inputs')
        .insert({
          project_id: projectId,
          type: 'text',
          content: textInputContent,
          file_name: textInputTitle || 'Text Input',
          metadata: {
            source: 'manual',
          },
          created_by: user.id,
        })

      if (error) throw error

      setTextInputContent('')
      setTextInputTitle('')
      setShowTextInputModal(false)
      fetchProjectData()
    } catch (error) {
      console.error('Error saving text input:', error)
      alert('Failed to save text input')
    } finally {
      setSavingTextInput(false)
    }
  }

  const handleScrapedContent = async (data: {
    title: string
    content: string
    url: string
    description?: string
    scrapedAt?: string
  }) => {
    setShowWebScrapingModal(false)
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    if (!currentUser) {
      alert('Not authenticated')
      return
    }
    const { error } = await supabase
      .from('diffuse_project_inputs')
      .insert({
        project_id: projectId,
        type: 'web_scrape' as InputType,
        content: data.content,
        file_name: data.title || 'Web Page',
        metadata: {
          url: data.url,
          description: data.description ?? undefined,
          scraped_at: data.scrapedAt ?? new Date().toISOString(),
        },
        created_by: currentUser.id,
      })
    if (error) {
      console.error('Error saving scraped content:', error)
      alert('Failed to save scraped content')
      return
    }
    await fetchProjectData()
  }

  const handleDeleteInput = async (inputId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this input? This cannot be undone.')) return
    
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .delete()
        .eq('id', inputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error deleting input:', error)
      alert('Failed to delete input')
    }
  }

  const handleSaveInput = async (inputId: string, title: string, content: string, metadata?: Record<string, unknown>) => {
    try {
      const updatePayload: { file_name: string | null; content: string; metadata?: Record<string, unknown> } = {
        file_name: title || null,
        content,
      }
      if (metadata != null && Object.keys(metadata).length > 0) {
        updatePayload.metadata = metadata
      }
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .update(updatePayload)
        .eq('id', inputId)

      if (error) throw error
      
      setSelectedInput(null)
      fetchProjectData()
    } catch (error) {
      console.error('Error saving input:', error)
      alert('Failed to save input')
      throw error
    }
  }

  const handleDeleteInputFromModal = async (inputId: string) => {
    if (!confirm('Are you sure you want to delete this input? This cannot be undone.')) return
    
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .delete()
        .eq('id', inputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error deleting input:', error)
      alert('Failed to delete input')
      throw error
    }
  }

  const handleDeleteAllInputs = async () => {
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .delete()
        .eq('project_id', projectId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error deleting all inputs:', error)
      alert('Failed to delete inputs')
    }
  }

  const handleDeleteAllOutputs = async () => {
    try {
      const { error } = await supabase
        .from('diffuse_project_outputs')
        .delete()
        .eq('project_id', projectId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error deleting all outputs:', error)
      alert('Failed to delete outputs')
    }
  }

  const handleDeleteProject = async () => {
    try {
      // Delete inputs first
      const { error: inputsError } = await supabase
        .from('diffuse_project_inputs')
        .delete()
        .eq('project_id', projectId)

      if (inputsError) throw inputsError

      // Delete outputs
      const { error: outputsError } = await supabase
        .from('diffuse_project_outputs')
        .delete()
        .eq('project_id', projectId)

      if (outputsError) throw outputsError

      // Delete the project
      const { error: projectError } = await supabase
        .from('diffuse_projects')
        .delete()
        .eq('id', projectId)

      if (projectError) throw projectError

      router.push('/dashboard')
    } catch (error: any) {
      console.error('Error deleting project:', error)
      alert('Failed to delete project')
    }
  }

  const handleSaveVisibility = async () => {
    if (!project) return
    setSavingVisibility(true)
    try {
      const { error } = await supabase
        .from('diffuse_projects')
        .update({ 
          visibility: visibility,
          visible_to_orgs: visibility === 'public' ? selectedOrgs : []
        })
        .eq('id', project.id)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error saving visibility:', error)
      alert('Failed to save visibility settings')
    } finally {
      setSavingVisibility(false)
    }
  }

  const toggleOrgSelection = (orgId: string) => {
    setSelectedOrgs(prev => 
      prev.includes(orgId) 
        ? prev.filter(id => id !== orgId)
        : [...prev, orgId]
    )
  }

  const handleGenerate = async (
    outputType: OutputType,
    options?: {
      tone?: string
      length?: string
      audience?: string
      comments?: string
      numberOfOutputs?: number
      articleTopics?: string
    },
    source: 'quick' | 'refine' = 'refine'
  ) => {
    if (nonImageInputsCount === 0) {
      alert('Please add at least one input before generating')
      return
    }

    setGenerateSource(source)
    setGeneratingArticle(true)
    setShowGenerateOptionsModal(false)
    setShowQuickGenerateModal(false)
    try {
      const body: Record<string, string | number> = { project_id: projectId, output_type: outputType, mode: source }
      if (options?.tone) body.tone = options.tone
      if (options?.length) body.length = options.length
      if (options?.audience) body.audience = options.audience
      if (options?.comments) body.comments = options.comments
      if (options?.numberOfOutputs != null && options.numberOfOutputs > 1) body.number_of_outputs = options.numberOfOutputs
      if (options?.articleTopics) body.article_topics = options.articleTopics
      const response = await fetch('/api/workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate')
      }

      // Async workflow: n8n acked immediately — pending row exists; refresh without full-page skeleton.
      if (result.pending === true) {
        await fetchProjectData({ silent: true })
      } else {
        await fetchProjectData()
      }
    } catch (error) {
      console.error('Error generating:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate')
    } finally {
      setGeneratingArticle(false)
      setGenerateSource(null)
    }
  }

  // File upload handlers
  const handleFileUpload = async (files: FileList | null, type: 'audio' | 'document' | 'image' | 'cover_photo') => {
    if (!files || files.length === 0) return

    setUploadingFile(true)
    setShowAddInputDropdown(false)

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser) throw new Error('Not authenticated')

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setUploadProgress(`Processing ${file.name} (${i + 1}/${files.length})...`)

        if (type === 'audio') {
          // Check file size (500MB limit to match bucket limit)
          const maxSize = 500 * 1024 * 1024 // 500MB
          if (file.size > maxSize) {
            throw new Error(`Audio file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 500MB.`)
          }
          
          // Upload audio to storage first
          setUploadProgress(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`)
          const filePath = `${currentUser.id}/${projectId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
          
          // For files over 6MB, use resumable uploads (TUS protocol)
          const useResumable = file.size > 6 * 1024 * 1024 // 6MB threshold
          
          if (useResumable) {
            // Get Supabase URL and extract project ref
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
            const urlMatch = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)
            if (!urlMatch) {
              throw new Error('Invalid Supabase URL configuration')
            }
            const projectRef = urlMatch[1]
            
            // Get session token
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) {
              throw new Error('Not authenticated')
            }
            
            // Use resumable upload for large files
            const uploadUrl = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
            
            // Dynamically import tus-js-client for client-side usage
            const tusModule = await import('tus-js-client')
            // Handle both default and named exports
            const TusUpload = tusModule.Upload || tusModule.default?.Upload || tusModule.default
            
            await new Promise<void>((resolve, reject) => {
              const upload = new TusUpload(file, {
                endpoint: uploadUrl,
                retryDelays: [0, 3000, 5000, 10000, 20000],
                uploadDataDuringCreation: true,
                removeFingerprintOnSuccess: true,
                metadata: {
                  bucketName: 'project-files',
                  objectName: filePath,
                  contentType: file.type || 'audio/mpeg',
                  cacheControl: '3600',
                },
                headers: {
                  authorization: `Bearer ${session.access_token}`,
                },
                chunkSize: 6 * 1024 * 1024, // Must be exactly 6MB for Supabase
                onError: (error) => {
                  console.error('Resumable upload error:', error)
                  reject(error)
                },
                onProgress: (bytesUploaded, bytesTotal) => {
                  const percent = ((bytesUploaded / bytesTotal) * 100).toFixed(1)
                  setUploadProgress(`Uploading ${file.name}... ${percent}% (${(bytesUploaded / 1024 / 1024).toFixed(1)}MB / ${(bytesTotal / 1024 / 1024).toFixed(1)}MB)`)
                },
                onSuccess: () => {
                  resolve()
                },
              })
              
              // Check for previous uploads to resume
              upload.findPreviousUploads().then((previousUploads) => {
                if (previousUploads.length) {
                  upload.resumeFromPreviousUpload(previousUploads[0])
                }
                upload.start()
              }).catch((error) => {
                // If findPreviousUploads fails, just start the upload
                upload.start()
              })
            })
          } else {
            // Standard upload for smaller files
            const { error: uploadError } = await supabase.storage
              .from('project-files')
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || 'audio/mpeg',
              })

            if (uploadError) {
              if (uploadError.message?.includes('exceeded the maximum allowed size')) {
                throw new Error('File is too large. The storage bucket limit may need to be increased.')
              }
              if (uploadError.message?.includes('Payload too large') || uploadError.message?.includes('413')) {
                throw new Error('Audio file is too large. Try compressing it or using a shorter recording.')
              }
              throw uploadError
            }
          }

          // Generate a signed URL for the audio file
          const { data: signedUrlData, error: signedUrlError } = await supabase.storage
            .from('project-files')
            .createSignedUrl(filePath, 60 * 60 * 24 * 365) // 1 year

          if (signedUrlError || !signedUrlData?.signedUrl) {
            throw new Error('Failed to get audio URL for transcription')
          }

          setUploadProgress(`Transcribing ${file.name}... (this may take a few minutes for longer files)`)

          // Send signed URL to transcription API
          const response = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioUrl: signedUrlData.signedUrl,
              // No recordingId - this is a project input, not a recording
            }),
          })

          // Handle non-JSON responses (e.g., timeout errors, server errors)
          let result
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            result = await response.json()
          } else {
            const text = await response.text()
            console.error('Non-JSON response from transcription API:', text)
            throw new Error('Transcription service returned an unexpected response. The file may be too large or the service timed out.')
          }

          if (!response.ok) {
            throw new Error(result.error || 'Failed to transcribe audio')
          }

          // Create the input with transcribed text
          const { error: inputError } = await supabase
            .from('diffuse_project_inputs')
            .insert({
              project_id: projectId,
              type: 'audio' as InputType,
              content: result.transcription,
              file_path: filePath,
              file_name: file.name,
              file_size: file.size,
              metadata: {
                source: 'upload',
                original_type: file.type,
                storage_url: signedUrlData?.signedUrl || null,
              },
              created_by: currentUser.id,
            })

          if (inputError) throw inputError

        } else if (type === 'document') {
          // Check file size (50MB limit for documents)
          const maxDocSize = 50 * 1024 * 1024 // 50MB
          if (file.size > maxDocSize) {
            throw new Error(`Document is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 50MB.`)
          }
          
          // Extract text from document
          setUploadProgress(`Extracting text from ${file.name}...`)

          const formData = new FormData()
          formData.append('file', file)

          const response = await fetch('/api/extract-text', {
            method: 'POST',
            body: formData,
          })

          const result = await response.json()

          if (!response.ok) {
            throw new Error(result.error || 'Failed to extract text from document')
          }

          // Create the input with extracted text
          const { error: inputError } = await supabase
            .from('diffuse_project_inputs')
            .insert({
              project_id: projectId,
              type: 'document' as InputType,
              content: result.text,
              file_name: file.name,
              file_size: file.size,
              metadata: {
                source: 'upload',
                original_type: file.type,
                file_type: result.file_type,
              },
              created_by: currentUser.id,
            })

          if (inputError) throw inputError

        } else if (type === 'image' || type === 'cover_photo') {
          // Check file size (20MB limit for images)
          const maxImgSize = 20 * 1024 * 1024 // 20MB
          if (file.size > maxImgSize) {
            throw new Error(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 20MB.`)
          }
          
          // Upload image to storage (sanitize filename so signed URLs don't 400 on : ? # etc.)
          const filePath = `${currentUser.id}/${projectId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
          const uploadOptions = type === 'cover_photo'
            ? { contentType: (file.type && /^image\/(jpeg|png|jpg)$/i.test(file.type)) ? file.type : 'image/jpeg' }
            : {}
          const { error: uploadError } = await supabase.storage
            .from('project-files')
            .upload(filePath, file, uploadOptions)

          if (uploadError) throw uploadError

          // Generate a signed URL (valid for 1 year)
          const { data: signedUrlData } = await supabase.storage
            .from('project-files')
            .createSignedUrl(filePath, 60 * 60 * 24 * 365) // 1 year

          if (type === 'cover_photo') {
            // Only one cover photo per project: update existing or insert new
            const { data: existingCover } = await supabase
              .from('diffuse_project_inputs')
              .select('id')
              .eq('project_id', projectId)
              .eq('type', 'cover_photo')
              .is('deleted_at', null)
              .maybeSingle()

            if (existingCover) {
              const { error: updateError } = await supabase
                .from('diffuse_project_inputs')
                .update({
                  file_path: filePath,
                  file_name: file.name,
                  file_size: file.size,
                  metadata: {
                    source: 'upload',
                    original_type: file.type,
                    storage_url: signedUrlData?.signedUrl || null,
                  },
                })
                .eq('id', existingCover.id)
              if (updateError) throw updateError
            } else {
              const { error: inputError } = await supabase
                .from('diffuse_project_inputs')
                .insert({
                  project_id: projectId,
                  type: 'cover_photo' as InputType,
                  content: null,
                  file_path: filePath,
                  file_name: file.name,
                  file_size: file.size,
                  metadata: {
                    source: 'upload',
                    original_type: file.type,
                    storage_url: signedUrlData?.signedUrl || null,
                  },
                  created_by: currentUser.id,
                })
              if (inputError) throw inputError
            }
            // Attach cover to all existing outputs so image section shows it
            await supabase
              .from('diffuse_project_outputs')
              .update({ cover_photo_path: filePath })
              .eq('project_id', projectId)
              .is('deleted_at', null)
          } else {
            // Regular image input (passed to workflow; not used as output cover)
            const { error: inputError } = await supabase
              .from('diffuse_project_inputs')
              .insert({
                project_id: projectId,
                type: 'image' as InputType,
                content: null,
                file_path: filePath,
                file_name: file.name,
                file_size: file.size,
                metadata: {
                  source: 'upload',
                  original_type: file.type,
                  storage_url: signedUrlData?.signedUrl || null,
                },
                created_by: currentUser.id,
              })
            if (inputError) throw inputError
          }
        }
      }

      fetchProjectData()
    } catch (error) {
      console.error('Error uploading file:', error)
      alert(error instanceof Error ? error.message : 'Failed to upload file')
    } finally {
      setUploadingFile(false)
      setUploadProgress(null)
      // Reset file inputs
      if (audioInputRef.current) audioInputRef.current.value = ''
      if (documentInputRef.current) documentInputRef.current.value = ''
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  if (loading) {
    return <ProjectDetailSkeleton />
  }

  if (!project) {
    return (
      <EmptyState
        title="Project Not Found"
        description="The project you're looking for doesn't exist or you don't have access to it."
        action={{
          label: backHref.startsWith('/dashboard/organization') ? 'Back to Organization' : 'Back to Dashboard',
          onClick: () => router.push(backHref),
        }}
      />
    )
  }

  const workflowStatusColors = {
    pending: 'bg-pale-blue/20 text-pale-blue border-pale-blue/30',
    processing: 'bg-cosmic-orange/20 text-cosmic-orange border-cosmic-orange/30',
    completed: 'bg-green-500/20 text-green-400 border-green-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  const isOutputWorkflowRunning = (o: DiffuseProjectOutput) =>
    o.workflow_status === 'pending' || o.workflow_status === 'processing'

  const generatingIsAd = project?.project_type === 'advertisement'
  const generatingOutputColor = generatingIsAd ? 'text-amber-400' : 'text-teal-400'
  const generatingOutputLabel = generatingIsAd ? 'ADVERTISEMENT' : 'ARTICLE'
  
  // Filter out image-type inputs for counts
  const nonImageInputs = inputs.filter(i => i.type !== 'cover_photo' && i.type !== 'image')
  const nonImageInputsCount = nonImageInputs.length

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-6">
        <button
          onClick={() => router.push(backHref)}
          className="inline-flex items-center gap-1.5 text-medium-gray hover:text-secondary-white transition-colors text-body-sm mb-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Projects
        </button>
                <h1 className="text-heading-lg text-secondary-white font-medium leading-tight">
                  {project.name}
                </h1>
                {project.description && (
                  <p className="text-body-sm text-medium-gray mt-1">
                    {project.description}
                  </p>
                )}
      </div>

      {/* ── Two-column layout ──────────────────────────────── */}
      <div
        className={`flex flex-col lg:flex-row gap-4 ${
          outputs.length === 0 && !generatingArticle ? 'lg:items-stretch' : 'items-start'
        }`}
      >

        {/* ── Left: Output column ───────────────────────── */}
        <div
          className={`flex-1 min-w-0 ${
            outputs.length === 0 && !generatingArticle ? 'flex flex-col min-h-0' : ''
          }`}
        >

          {/* Output display area */}
          <div
            className={
              outputs.length === 0 && !generatingArticle ? 'flex flex-1 flex-col min-h-0' : ''
            }
          >
            {/* Generating placeholder card — shown as first item */}
            {/* Shown while POST /api/workflow is in flight, until the pending DB row is visible (async n8n ack). */}
            {generatingArticle && !primaryOutputAwaitingWorkflow && (
              <div className="glass-container p-5 mb-4">
                <div className={`flex items-center gap-2 text-caption uppercase tracking-wider ${generatingOutputColor} mb-2`}>
                  <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                    <svg fill="none" viewBox="0 0 24 24" className="animate-spin">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </span>
                  <span>{generatingOutputLabel}</span>
                </div>
                <h3 className="text-body-md text-secondary-white font-semibold">Generating output{loadingDots}</h3>
              </div>
            )}

            {outputs.length === 0 && !generatingArticle ? (
              <div className="glass-container flex flex-1 min-h-0 items-center justify-center p-5">
                <p className="text-body-md text-medium-gray text-center">No output generated yet.</p>
              </div>
            ) : (
              <>
                {/* First output — primary card */}
                {outputs.length > 0 && (() => {
                  const output = outputs[0]
                  const workflowRunning = isOutputWorkflowRunning(output)
                  const info = workflowRunning
                    ? {
                        title: `Generating output${loadingDots}`,
                        subtitle: null as string | null,
                        excerpt: null as string | null,
                        author: 'Diffuse.AI',
                        photo_caption: null as string | null,
                        photo_credit: null as string | null,
                      }
                    : getOutputInfo(output)
                  const isAd = output.output_type === 'ad'
                  const outputLabel = isAd ? 'ADVERTISEMENT' : 'ARTICLE'
                  const outputColor = isAd ? 'text-amber-400' : 'text-teal-400'
                  return (
                    <div
                      key={output.id}
                      role={workflowRunning ? 'status' : undefined}
                      aria-busy={workflowRunning || undefined}
                      onClick={() => {
                        if (workflowRunning) return
                        router.push(hrefToOutputDetail(output.id))
                      }}
                      className={`glass-container p-5 transition-colors ${
                        workflowRunning
                          ? 'cursor-wait opacity-95'
                          : 'hover:bg-white/10 cursor-pointer'
                      }`}
                    >
                      <div className={`flex items-center gap-2 text-caption uppercase tracking-wider ${outputColor} mb-2`}>
                        <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                          {workflowRunning ? (
                            <svg fill="none" viewBox="0 0 24 24" className="animate-spin">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          ) : (
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </span>
                        <span>{outputLabel}</span>
                        {output.workflow_status &&
                          output.workflow_status !== 'completed' &&
                          !workflowRunning && (
                          <span className={`ml-auto px-2 py-0.5 rounded text-caption border ${workflowStatusColors[output.workflow_status as keyof typeof workflowStatusColors] || ''}`}>
                            {output.workflow_status.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <h3 className="text-body-md text-secondary-white font-semibold mb-1 line-clamp-2">{info.title}</h3>
                      {!workflowRunning && info.subtitle && (
                        <p className={`text-caption uppercase tracking-wider mb-2 line-clamp-2 ${outputColor}`}>{info.subtitle.toUpperCase()}</p>
                      )}
                      {!workflowRunning && info.excerpt && (
                        <p className="text-body-sm text-medium-gray mb-3 line-clamp-3">{info.excerpt}</p>
                      )}
                      {!workflowRunning && (
                        <div className="text-caption uppercase tracking-wider">
                          <span className={outputColor}>{info.author.toUpperCase()}</span>
                          <span className="text-medium-gray"> • </span>
                          <span className="text-medium-gray">
                            {new Date(output.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Past outputs accordion */}
                {outputs.length > 1 && (
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <p className="text-caption text-medium-gray uppercase tracking-wider mb-1">Past Outputs</p>
                    {outputs.slice(1).map((output) => {
                      const pastWorkflowRunning = isOutputWorkflowRunning(output)
                      const listTitle = pastWorkflowRunning
                        ? `Generating output${loadingDots}`
                        : getOutputInfo(output).title
                      const isAd = output.output_type === 'ad'
                      const outputColor = isAd ? 'text-amber-400' : 'text-teal-400'
                      const isExpanded = expandedOutputId === output.id
                      return (
                        <div key={output.id} className="border-b border-white/10 last:border-b-0">
                          <button
                            onClick={() => setExpandedOutputId(isExpanded ? null : output.id)}
                            className="w-full flex items-center justify-between py-2.5 text-left hover:bg-white/5 transition-colors rounded px-1"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5 ${outputColor}`}>
                                {pastWorkflowRunning ? (
                                  <svg fill="none" viewBox="0 0 24 24" className="animate-spin">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                ) : (
                                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                )}
                              </span>
                              <span className="text-body-sm text-secondary-white truncate">{listTitle}</span>
                              <span className="text-caption text-medium-gray flex-shrink-0">
                                {new Date(output.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}
                              </span>
                            </div>
                            <svg className={`w-3.5 h-3.5 text-medium-gray flex-shrink-0 ml-2 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {isExpanded && (
                            <div
                              onClick={() => {
                                if (pastWorkflowRunning) return
                                router.push(hrefToOutputDetail(output.id))
                              }}
                              className={`pb-3 px-1 group/expanded ${pastWorkflowRunning ? 'cursor-wait' : 'cursor-pointer'}`}
                            >
                              <div className={`transition-colors rounded p-2 -m-2 ${pastWorkflowRunning ? '' : 'group-hover/expanded:bg-white/5'}`}>
                                {pastWorkflowRunning ? (
                                  <p className="text-body-sm text-medium-gray">This output is still generating. It will open when ready.</p>
                                ) : (() => {
                                  const fullInfo = getOutputInfo(output)
                                  return (
                                    <>
                                      {fullInfo.subtitle && (
                                        <p className={`text-caption uppercase tracking-wider mb-1 ${outputColor}`}>{fullInfo.subtitle.toUpperCase()}</p>
                                      )}
                                      {fullInfo.excerpt && (
                                        <p className="text-body-sm text-medium-gray mb-2 line-clamp-3">{fullInfo.excerpt}</p>
                                      )}
                                      <div className="text-caption uppercase tracking-wider">
                                        <span className={outputColor}>{fullInfo.author.toUpperCase()}</span>
                                        <span className="text-medium-gray"> • </span>
                                        <span className="text-medium-gray">{new Date(output.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
                                      </div>
                                    </>
                                  )
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right sidebar — single container ──────────── */}
        <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 glass-container overflow-hidden">

          {/* Quick + Generate buttons — top of sidebar */}
          {canEdit && (
            <div className="flex border-b border-white/10">
              <button
                onClick={() => setShowQuickGenerateModal(true)}
                disabled={generatingArticle || nonImageInputsCount === 0}
                className="btn-secondary border-0 border-r border-secondary-white/25 flex-1 py-3 gap-1.5 text-body-sm rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
                title={nonImageInputsCount === 0 ? 'Add inputs first' : 'Quick generate'}
              >
                {generatingArticle && generateSource === 'quick' ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                Quick
              </button>
              <button
                onClick={async () => {
                  let prefs: WorkflowPreferences = {}
                  try {
                    const res = await fetch('/api/user/workflow-preferences')
                    if (res.ok) {
                      const data = await res.json()
                      if (data && typeof data === 'object') prefs = data
                    }
                  } catch (_) {}
                  if (Object.keys(prefs).length === 0 && typeof window !== 'undefined') {
                    try {
                      const raw = localStorage.getItem(WORKFLOW_PREFERENCES_KEY)
                      if (raw) prefs = JSON.parse(raw)
                    } catch (_) {}
                  }
                  setGenerateOptionsInitialValues(prefs)
                  setShowGenerateOptionsModal(true)
                }}
                disabled={generatingArticle || nonImageInputsCount === 0}
                className="btn-primary flex-1 py-3 gap-1.5 text-body-sm rounded-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
                title={nonImageInputsCount === 0 ? 'Add inputs first' : 'Generate output'}
              >
                {generatingArticle && generateSource === 'refine' ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                )}
                Generate
              </button>
            </div>
          )}

          {/* Inputs section */}
          <div className="border-b border-white/10">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-body-sm text-secondary-white font-medium">
                Inputs <span className="text-body-sm text-medium-gray">({nonImageInputsCount})</span>
              </p>
              {canEdit && (
                <div ref={addInputDropdownRef} className="relative flex items-center justify-center w-6">
                  <button
                    onClick={() => setShowAddInputDropdown(!showAddInputDropdown)}
                    disabled={uploadingFile}
                    className="text-caption text-medium-gray hover:text-secondary-white transition-colors disabled:opacity-50"
                    title="Add input"
                  >
                    {uploadingFile ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    )}
                  </button>
                  {showAddInputDropdown && (
                    <div className="absolute top-full right-0 mt-1.5 w-44 glass-container bg-dark-gray/95 backdrop-blur-glass py-1 z-50">
                      <button onClick={() => { setShowAddInputDropdown(false); setShowRecordingModal(true) }} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-white/10 transition-colors">
                        <svg className="w-4 h-4 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                        <span className="text-body-sm text-secondary-white">Recording</span>
                      </button>
                      <button onClick={() => { setShowAddInputDropdown(false); setShowTextInputModal(true) }} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-white/10 transition-colors">
                        <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <span className="text-body-sm text-secondary-white">Text</span>
                      </button>
                      <button onClick={() => { setShowAddInputDropdown(false); setShowWebScrapingModal(true) }} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-white/10 transition-colors">
                        <svg className="w-4 h-4 text-sky-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                        <span className="text-body-sm text-secondary-white">Web Scraping</span>
                      </button>
                      <button onClick={() => { setShowAddInputDropdown(false); audioInputRef.current?.click() }} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-white/10 transition-colors">
                        <svg className="w-4 h-4 text-fuchsia-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                        <span className="text-body-sm text-secondary-white">Audio File</span>
                      </button>
                      <button onClick={() => { setShowAddInputDropdown(false); documentInputRef.current?.click() }} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-white/10 transition-colors">
                        <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        <span className="text-body-sm text-secondary-white">Document</span>
                      </button>
                    </div>
                  )}
                  <input ref={audioInputRef} type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'audio')} />
                  <input ref={documentInputRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'document')} />
                  <input ref={imageInputRef} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'image')} />
                </div>
              )}
            </div>
            {uploadingFile && uploadProgress && (
              <p className="text-caption text-medium-gray px-4 pb-2">{uploadProgress}</p>
            )}
            {nonImageInputs.length === 0 ? (
              <p className="text-caption text-medium-gray px-4 pb-3">Add recordings, documents, or other references for this project</p>
            ) : (
              <div className="space-y-0.5 px-4 pb-3">
                {nonImageInputs.map((input) => {
                  const isFromRecording = input.metadata?.source === 'recording'
                  const isFromUpload = input.metadata?.source === 'upload'
                  const typeInfo = getInputTypeInfo(input)
                  const defaultTitle = isFromRecording ? 'Recording' : input.type === 'document' ? 'Document' : input.type === 'audio' ? 'Audio' : input.type === 'web_scrape' ? 'Web Page' : 'Text Input'
                  let metaText = ''
                  if (isFromRecording && input.metadata?.recording_duration) {
                    metaText = formatDuration(input.metadata.recording_duration)
                  } else if (isFromUpload && input.file_size) {
                    metaText = `${(input.file_size / 1024).toFixed(0)} KB`
                  }
                  return (
                    <div key={input.id} className="relative group">
                      <button
                        onClick={() => setSelectedInput(input)}
                        className="w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                      >
                        <span className={`flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5 ${typeInfo.color}`}>{typeInfo.icon}</span>
                        <span className="text-body-sm text-secondary-white truncate flex-1">
                          {input.file_name || defaultTitle}
                          {metaText && <span className="text-caption text-medium-gray ml-1">· {metaText}</span>}
                        </span>
                      </button>
                      {canEdit && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteInput(input.id, e)
                          }} 
                          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-medium-gray hover:text-red-400 transition-all p-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Images section */}
          <div className="border-b border-white/10">
            <button
              onClick={() => setImagesSectionOpen(!imagesSectionOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
            >
              <p className="text-body-sm text-secondary-white font-medium">
                Images <span className="text-body-sm text-medium-gray">({outputs.filter(o => o.cover_photo_path).length})</span>
              </p>
              <div className="flex items-center justify-center w-6">
                <svg className={`w-3.5 h-3.5 text-medium-gray transition-transform ${imagesSectionOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {imagesSectionOpen && (
              <>
                {outputs.filter(o => o.cover_photo_path).length === 0 ? (
                  <p className="text-caption text-medium-gray px-4 pb-3">Generated images will appear here</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 px-4 pb-3">
                    {outputs.filter(o => o.cover_photo_path).map((output) => (
                      <button
                        type="button"
                        key={output.id}
                        onClick={() => router.push(hrefToOutputDetail(output.id))}
                        className="aspect-square rounded-glass overflow-hidden hover:opacity-80 transition-opacity relative group"
                      >
                        <Image
                          src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/project-files/${output.cover_photo_path}`}
                          alt="Generated cover"
                          fill
                          sizes="(max-width: 1024px) 33vw, 200px"
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Visibility section */}
          {isProjectOwner && (
            <div className="border-b border-white/10">
              <button
                onClick={() => setVisibilitySectionOpen(!visibilitySectionOpen)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <p className="text-body-sm text-secondary-white font-medium">
                  Visibility <span className="text-body-sm text-medium-gray">({visibility === 'private' ? 'Private' : 'Public'})</span>
                </p>
                <div className="flex items-center justify-center w-6">
                  <svg className={`w-3.5 h-3.5 text-medium-gray transition-transform ${visibilitySectionOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {visibilitySectionOpen && (
                <div className="px-4 pb-3 space-y-0.5">
                  <button
                    onClick={async () => {
                      setVisibility('private')
                      setSelectedOrgs([])
                      await handleSaveVisibility()
                    }}
                    className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <span className="text-body-sm text-secondary-white">Private</span>
                    {visibility === 'private' && (
                      <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={async () => {
                      setVisibility('public')
                      setSelectedOrgs(workspaces.map(({ workspace }) => workspace.id))
                      await handleSaveVisibility()
                    }}
                    className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <span className="text-body-sm text-secondary-white">Public</span>
                    {visibility === 'public' && (
                      <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  {workspaces.length === 0 ? (
                    <p className="text-caption text-medium-gray pt-2">Join an organization to share this project.</p>
                  ) : (
                    <div className="space-y-0.5 pt-2">
                      <p className="text-caption text-medium-gray px-2 pb-1">ORGANIZATIONS</p>
                      {workspaces.map(({ workspace }) => {
                        const isSelected = selectedOrgs.includes(workspace.id) && visibility === 'public'
                        return (
                          <div
                            key={workspace.id}
                            onClick={async () => {
                              if (visibility === 'private') { 
                                setVisibility('public')
                                setSelectedOrgs([workspace.id])
                                await handleSaveVisibility()
                              }
                              else if (isSelected) { 
                                const n = selectedOrgs.filter(id => id !== workspace.id)
                                setSelectedOrgs(n)
                                if (n.length === 0) setVisibility('private')
                                await handleSaveVisibility()
                              }
                              else {
                                setSelectedOrgs([...selectedOrgs, workspace.id])
                                await handleSaveVisibility()
                              }
                            }}
                            className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <span className="text-body-sm text-secondary-white truncate">{workspace.name}</span>
                            {isSelected && (
                              <svg className="w-3.5 h-3.5 text-medium-gray flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Settings section */}
          <div>
            <button
              onClick={() => setSettingsSectionOpen(!settingsSectionOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
            >
              <p className="text-body-sm text-secondary-white font-medium">Settings</p>
              <div className="flex items-center justify-center w-6">
                <svg className={`w-3.5 h-3.5 text-medium-gray transition-transform ${settingsSectionOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {settingsSectionOpen && (
              <div className="px-4 pb-3 space-y-0.5">
                {/* Edit details */}
                {canEdit && (
                  <button
                    onClick={() => { setEditProjectName(project?.name || ''); setEditProjectDescription(project?.description || ''); setShowProjectSettings(true) }}
                    className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left"
                  >
                    <span className="text-body-sm text-secondary-white">Edit details</span>
                    <div className="flex items-center justify-center w-6">
                      <svg className="w-3.5 h-3.5 text-medium-gray" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </div>
                  </button>
                )}
                {/* Delete All Inputs */}
                <button
                  onClick={() => setShowDeleteInputsConfirm(true)}
                  disabled={nonImageInputsCount === 0}
                  className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-body-sm text-secondary-white">Delete all inputs</span>
                  <div className="flex items-center justify-center w-6">
                    <span className="text-caption text-medium-gray">{nonImageInputsCount}</span>
                  </div>
                </button>
                {/* Delete All Outputs */}
                <button
                  onClick={() => setShowDeleteOutputsConfirm(true)}
                  disabled={outputs.length === 0}
                  className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-white/10 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-body-sm text-secondary-white">Delete all outputs</span>
                  <div className="flex items-center justify-center w-6">
                    <span className="text-caption text-medium-gray">{outputs.length}</span>
                  </div>
                </button>
                {/* Delete Project */}
                {canDelete && (
                  <button
                    onClick={() => setShowDeleteProjectConfirm(true)}
                    className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-red-500/10 transition-colors text-left"
                  >
                    <span className="text-body-sm text-red-400">Delete project</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {selectedInput && (
        <InputDetailModal 
          input={selectedInput} 
          onClose={() => setSelectedInput(null)}
          onSave={handleSaveInput}
          onDelete={handleDeleteInputFromModal}
          onUpdate={fetchProjectData}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      )}
      {showRecordingModal && (
        <SelectRecordingModal
          projectId={projectId}
          onClose={() => setShowRecordingModal(false)}
          onSuccess={fetchProjectData}
        />
      )}
      <WebScrapingModal
        isOpen={showWebScrapingModal}
        onClose={() => setShowWebScrapingModal(false)}
        onSuccess={handleScrapedContent}
      />
      {showGenerateOptionsModal && (
        <GenerateOptionsModal
          onClose={() => setShowGenerateOptionsModal(false)}
          onGenerate={(payload) => handleGenerate(payload.outputType, payload, 'refine')}
          initialValues={generateOptionsInitialValues}
          defaultOutputType={project?.project_type === 'advertisement' ? 'ad' : 'article'}
          onSavePreferences={async (prefs) => {
            await fetch('/api/user/workflow-preferences', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(prefs),
            })
            try {
              if (typeof window !== 'undefined') localStorage.setItem(WORKFLOW_PREFERENCES_KEY, JSON.stringify(prefs))
            } catch (_) {}
          }}
        />
      )}
      {showQuickGenerateModal && (
        <QuickGenerateModal
          onClose={() => setShowQuickGenerateModal(false)}
          onGenerate={(outputType) => handleGenerate(outputType, undefined, 'quick')}
        />
      )}

      {/* Text Input Modal */}
      {showTextInputModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-container p-4 sm:p-8 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between flex-shrink-0">
              <h2 className="text-heading-lg text-secondary-white">Add Text Input</h2>
              <button
                onClick={() => {
                  setShowTextInputModal(false)
                  setTextInputContent('')
                  setTextInputTitle('')
                }}
                className="text-medium-gray hover:text-secondary-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <form onSubmit={handleSaveTextInput} className="flex-1 flex flex-col mt-6 min-h-0">
              {/* Title Input - Fixed */}
              <div className="flex-shrink-0 mb-4">
                <label className="block text-body-sm text-secondary-white mb-2">
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={textInputTitle}
                  onChange={(e) => setTextInputTitle(e.target.value)}
                  placeholder="Meeting Notes - Jan 2026"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors"
                />
              </div>
              
              {/* Content Textarea - Scrollable */}
              <div className="flex-1 flex flex-col min-h-0">
                <label className="block text-body-sm text-secondary-white mb-2 flex-shrink-0">
                  Content
                </label>
                <textarea
                  value={textInputContent}
                  onChange={(e) => setTextInputContent(e.target.value)}
                  placeholder="Paste or type your text here..."
                  required
                  className="flex-1 w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md focus:outline-none focus:border-cosmic-orange transition-colors resize-none overflow-y-auto"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-6 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowTextInputModal(false)
                    setTextInputContent('')
                    setTextInputTitle('')
                  }}
                  className="btn-secondary flex-1 py-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTextInput || !textInputContent.trim()}
                  className="btn-primary flex-1 py-3 disabled:opacity-50"
                >
                  {savingTextInput ? 'Saving...' : 'Add Input'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Settings Modal */}
      {showProjectSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-hidden">
          <div className="glass-container p-4 sm:p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-heading-md text-secondary-white">Project Settings</h2>
              <button
                onClick={() => {
                  setShowProjectSettings(false)
                }}
                className="text-medium-gray hover:text-secondary-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Title */}
            <div className="mb-4">
              <label className="block text-caption text-medium-gray uppercase tracking-wider mb-2">Title</label>
              <input
                type="text"
                value={editProjectName}
                onChange={(e) => setEditProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm focus:outline-none focus:border-cosmic-orange transition-colors"
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-caption text-medium-gray uppercase tracking-wider mb-2">Description</label>
              <textarea
                value={editProjectDescription}
                onChange={(e) => setEditProjectDescription(e.target.value)}
                placeholder="Project description (optional)"
                rows={3}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm focus:outline-none focus:border-cosmic-orange transition-colors resize-none"
              />
            </div>

            {/* Save Button */}
            <button
              onClick={async () => {
                if (!editProjectName.trim()) return
                try {
                  const { error } = await supabase
                    .from('diffuse_projects')
                    .update({ 
                      name: editProjectName.trim(),
                      description: editProjectDescription.trim() || null
                    })
                    .eq('id', projectId)
                  if (error) throw error
                  fetchProjectData()
                  setShowProjectSettings(false)
                } catch (error) {
                  console.error('Error updating project:', error)
                  alert('Failed to update project')
                }
              }}
              disabled={!editProjectName.trim()}
              className="btn-primary w-full py-2 text-body-sm disabled:opacity-50"
            >
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={showDeleteInputsConfirm}
        onClose={() => setShowDeleteInputsConfirm(false)}
        onConfirm={handleDeleteAllInputs}
        title="Delete All Inputs"
        message={`Are you sure you want to delete all ${nonImageInputsCount} input${nonImageInputsCount === 1 ? '' : 's'}? This action cannot be undone.`}
        confirmText="Delete All"
        variant="danger"
      />

      <ConfirmModal
        isOpen={showDeleteOutputsConfirm}
        onClose={() => setShowDeleteOutputsConfirm(false)}
        onConfirm={handleDeleteAllOutputs}
        title="Delete All Outputs"
        message={`Are you sure you want to delete all ${outputs.length} output${outputs.length === 1 ? '' : 's'}? This action cannot be undone.`}
        confirmText="Delete All"
        variant="danger"
      />

      <ConfirmModal
        isOpen={showDeleteProjectConfirm}
        onClose={() => setShowDeleteProjectConfirm(false)}
        onConfirm={handleDeleteProject}
        title="Delete Project"
        message="Are you sure you want to permanently delete this project and all its contents? This action cannot be undone."
        confirmText="Delete Project"
        variant="danger"
      />

    </div>
  )
}

