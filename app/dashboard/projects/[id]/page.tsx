'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatDuration, sanitizeStorageFilename } from '@/lib/utils/format'
import { useAuth } from '@/contexts/AuthContext'
import LoadingSpinner from '@/components/dashboard/LoadingSpinner'
import EmptyState from '@/components/dashboard/EmptyState'
import InputDetailModal from '@/components/dashboard/InputDetailModal'
import OutputDetailModal from '@/components/dashboard/OutputDetailModal'
import SelectRecordingModal from '@/components/dashboard/SelectRecordingModal'
import WebScrapingModal from '@/components/dashboard/WebScrapingModal'
import GenerateOptionsModal, { WORKFLOW_PREFERENCES_KEY, type WorkflowPreferences } from '@/components/dashboard/GenerateOptionsModal'
import QuickGenerateModal from '@/components/dashboard/QuickGenerateModal'
import { addRecentProject } from '@/components/dashboard/DashboardNav'
import { useBodyScrollLock } from '@/components/dashboard/ModalShell'
import type { DiffuseProject, DiffuseProjectInput, DiffuseProjectOutput, ProjectVisibility, UserRole, InputType, OutputType } from '@/types/database'
// tus-js-client will be dynamically imported when needed

// Role hierarchy for permissions
const roleHierarchy = ['viewer', 'editor', 'admin', 'owner'] as const
const getRoleLevel = (role: string) => roleHierarchy.indexOf(role as typeof roleHierarchy[number])

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

  const [project, setProject] = useState<DiffuseProject | null>(null)
  const [inputs, setInputs] = useState<DiffuseProjectInput[]>([])
  const [trashedInputs, setTrashedInputs] = useState<DiffuseProjectInput[]>([])
  const [outputs, setOutputs] = useState<DiffuseProjectOutput[]>([])
  const [trashedOutputs, setTrashedOutputs] = useState<DiffuseProjectOutput[]>([])
  const [activeTab, setActiveTab] = useState<'inputs' | 'outputs' | 'visibility' | 'trash'>(initialTab)
  const [loading, setLoading] = useState(true)
  const [selectedInput, setSelectedInput] = useState<DiffuseProjectInput | null>(null)
  const [selectedOutput, setSelectedOutput] = useState<DiffuseProjectOutput | null>(null)
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
  const [deletingAllInputs, setDeletingAllInputs] = useState(false)
  const [deletingAllOutputs, setDeletingAllOutputs] = useState(false)
  const [deletingProject, setDeletingProject] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddInputDropdown, setShowAddInputDropdown] = useState(false)
  const [showQuickGenerateModal, setShowQuickGenerateModal] = useState(false)
  const [showGenerateOptionsModal, setShowGenerateOptionsModal] = useState(false)
  const [generateOptionsInitialValues, setGenerateOptionsInitialValues] = useState<WorkflowPreferences>({})
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const coverPhotoInputRef = useRef<HTMLInputElement>(null)
  const addInputDropdownRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  useBodyScrollLock(showTextInputModal || showProjectSettings)

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

  // Permission helpers
  const isProjectOwner = project?.created_by === user?.id
  const canEdit = isProjectOwner || getRoleLevel(userProjectRole) >= getRoleLevel('editor')
  const canDelete = isProjectOwner || getRoleLevel(userProjectRole) >= getRoleLevel('admin')

  // Helper to extract article info from output content
  const getOutputInfo = (output: DiffuseProjectOutput) => {
    // Helper to extract field from JSON-like string using regex
    const extractField = (content: string, field: string): string | null => {
      const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]*(?:\\\\"[^"]*)*)"`, 's')
      const match = content.match(regex)
      if (match) {
        return match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
      }
      return null
    }

    try {
      // First try standard JSON parsing
      let parsed: Record<string, unknown> | null = null
      if (typeof output.content === 'string') {
        const trimmed = output.content.trim()
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          // If parsing fails, check for double-encoded JSON
          if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            try {
              const unwrapped = JSON.parse(trimmed)
              parsed = JSON.parse(unwrapped)
            } catch {
              // Fall through to regex extraction
            }
          }
        }
      }

      // If we got a parsed object with expected fields
      if (parsed && typeof parsed === 'object' && (parsed.title || parsed.content)) {
        return {
          title: (parsed.title as string) || 'Untitled Article',
          subtitle: (parsed.subtitle as string) || null,
          author: (parsed.author as string) || 'Diffuse.AI',
          excerpt: (parsed.excerpt as string) || null,
          photo_caption: (parsed.photo_caption as string) || null,
          photo_credit: (parsed.photo_credit as string) || null,
        }
      }
    } catch {
      // Fall through to regex extraction
    }

    // Fallback: try regex extraction for JSON-like content
    const title = extractField(output.content, 'title')
    const subtitle = extractField(output.content, 'subtitle')
    const author = extractField(output.content, 'author')
    const excerpt = extractField(output.content, 'excerpt')
    const photo_caption = extractField(output.content, 'photo_caption')
    const photo_credit = extractField(output.content, 'photo_credit')

    if (title) {
      return {
        title,
        subtitle,
        author: author || 'Diffuse.AI',
        excerpt,
        photo_caption: photo_caption || null,
        photo_credit: photo_credit || null,
      }
    }

    // Ultimate fallback
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

  const fetchProjectData = useCallback(async () => {
    setLoading(true)
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

      // Fetch trashed inputs
      const { data: trashedData, error: trashedError } = await supabase
        .from('diffuse_project_inputs')
        .select('*')
        .eq('project_id', projectId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })

      if (!trashedError) {
        setTrashedInputs(trashedData || [])
      }

      // Fetch active outputs (not deleted)
      const { data: outputsData, error: outputsError } = await supabase
        .from('diffuse_project_outputs')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (outputsError) throw outputsError
      setOutputs(outputsData || [])
      setSelectedOutput(prev => {
        if (!prev) return null
        const found = (outputsData || []).find((o: DiffuseProjectOutput) => o.id === prev.id)
        return found ?? prev
      })

      // Fetch trashed outputs
      const { data: trashedOutputsData, error: trashedOutputsError } = await supabase
        .from('diffuse_project_outputs')
        .select('*')
        .eq('project_id', projectId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })

      if (!trashedOutputsError) {
        setTrashedOutputs(trashedOutputsData || [])
      }
    } catch (error) {
      console.error('Error fetching project data:', error)
    } finally {
      setLoading(false)
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
          fetchProjectData()
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
          fetchProjectData()
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
          fetchProjectData()
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
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', inputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error deleting input:', error)
      alert('Failed to delete input')
    }
  }

  const handleRestoreInput = async (inputId: string) => {
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .update({ deleted_at: null })
        .eq('id', inputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error restoring input:', error)
      alert('Failed to restore input')
    }
  }

  const handlePermanentDeleteInput = async (inputId: string) => {
    if (!confirm('Are you sure you want to permanently delete this input? This cannot be undone.')) return
    
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .delete()
        .eq('id', inputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error permanently deleting input:', error)
      alert('Failed to delete input')
    }
  }

  const handlePermanentDeleteOutput = async (outputId: string) => {
    if (!confirm('Are you sure you want to permanently delete this output? This cannot be undone.')) return
    
    try {
      const { error } = await supabase
        .from('diffuse_project_outputs')
        .delete()
        .eq('id', outputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error permanently deleting output:', error)
      alert('Failed to delete output')
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
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', inputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error deleting input:', error)
      alert('Failed to delete input')
      throw error
    }
  }

  const handleDeleteOutput = async (outputId: string) => {
    try {
      const { error } = await supabase
        .from('diffuse_project_outputs')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', outputId)

      if (error) throw error

      fetchProjectData()
    } catch (error) {
      console.error('Error deleting output:', error)
      alert('Failed to delete output')
      throw error
    }
  }

  const handleDeleteAllInputs = async () => {
    if (!confirm('Are you sure you want to delete ALL inputs? This action cannot be undone.')) return
    
    setDeletingAllInputs(true)
    try {
      const { error } = await supabase
        .from('diffuse_project_inputs')
        .delete()
        .eq('project_id', projectId)

      if (error) throw error

      fetchProjectData()
      setShowProjectSettings(false)
    } catch (error) {
      console.error('Error deleting all inputs:', error)
      alert('Failed to delete inputs')
    } finally {
      setDeletingAllInputs(false)
    }
  }

  const handleDeleteAllOutputs = async () => {
    if (!confirm('Are you sure you want to delete ALL outputs? This action cannot be undone.')) return
    
    setDeletingAllOutputs(true)
    try {
      const { error } = await supabase
        .from('diffuse_project_outputs')
        .delete()
        .eq('project_id', projectId)

      if (error) throw error

      fetchProjectData()
      setShowProjectSettings(false)
    } catch (error) {
      console.error('Error deleting all outputs:', error)
      alert('Failed to delete outputs')
    } finally {
      setDeletingAllOutputs(false)
    }
  }

  const handleDeleteProject = async () => {
    if (deleteConfirmText !== 'DELETE') return
    
    setDeletingProject(true)
    try {
      // Delete inputs first
      const { error: inputsError } = await supabase
        .from('diffuse_project_inputs')
        .delete()
        .eq('project_id', projectId)

      if (inputsError) {
        console.error('Error deleting inputs:', inputsError)
        throw new Error(`Failed to delete inputs: ${inputsError.message}`)
      }

      // Delete outputs
      const { error: outputsError } = await supabase
        .from('diffuse_project_outputs')
        .delete()
        .eq('project_id', projectId)

      if (outputsError) {
        console.error('Error deleting outputs:', outputsError)
        throw new Error(`Failed to delete outputs: ${outputsError.message}`)
      }

      // Delete the project
      const { error: projectError } = await supabase
        .from('diffuse_projects')
        .delete()
        .eq('id', projectId)

      if (projectError) {
        console.error('Error deleting project:', projectError)
        throw new Error(`Failed to delete project: ${projectError.message}`)
      }

      router.push('/dashboard')
    } catch (error: any) {
      console.error('Error deleting project:', error)
      alert(error.message || 'Failed to delete project. Check console for details.')
      setDeletingProject(false)
    }
  }


  const handleRestoreOutput = async (outputId: string) => {
    try {
      const { error } = await supabase
        .from('diffuse_project_outputs')
        .update({ deleted_at: null })
        .eq('id', outputId)

      if (error) throw error
      fetchProjectData()
    } catch (error) {
      console.error('Error restoring output:', error)
      alert('Failed to restore output')
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
    if (inputs.length === 0) {
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

      // Refresh data to show new output
      fetchProjectData()
      // Switch to outputs tab to show the result
      setActiveTab('outputs')
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
      if (coverPhotoInputRef.current) coverPhotoInputRef.current.value = ''
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
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

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => router.push(backHref)}
            className="text-medium-gray hover:text-secondary-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-display-sm text-secondary-white">{project.name}</h1>
            {project.description && (
              <p className="text-body-lg text-medium-gray mt-1 line-clamp-2">{project.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-8 border-b border-white/10">
        <button
          onClick={() => setActiveTab('inputs')}
          className={`pb-3 px-4 text-body-md font-medium transition-colors relative ${
            activeTab === 'inputs'
              ? 'text-cosmic-orange'
              : 'text-secondary-white hover:text-white'
          }`}
        >
          Inputs<span className="hidden md:inline"> ({inputs.length})</span>
          {activeTab === 'inputs' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('outputs')}
          className={`pb-3 px-4 text-body-md font-medium transition-colors relative ${
            activeTab === 'outputs'
              ? 'text-cosmic-orange'
              : 'text-secondary-white hover:text-white'
          }`}
        >
          Outputs<span className="hidden md:inline"> ({outputs.length})</span>
          {activeTab === 'outputs' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
          )}
        </button>
        {/* Visibility tab - only visible to project owner */}
        {isProjectOwner && (
        <button
          onClick={() => setActiveTab('visibility')}
          className={`pb-3 px-4 text-body-md font-medium transition-colors relative ${
            activeTab === 'visibility'
              ? 'text-cosmic-orange'
              : 'text-secondary-white hover:text-white'
          }`}
        >
          Visibility<span className="hidden md:inline"> ({visibility === 'public' ? selectedOrgs.length : 0})</span>
          {activeTab === 'visibility' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
          )}
        </button>
        )}
        {(trashedInputs.length > 0 || trashedOutputs.length > 0) && (
          <button
            onClick={() => setActiveTab('trash')}
            className={`pb-3 px-4 text-body-md font-medium transition-colors relative ${
              activeTab === 'trash'
                ? 'text-cosmic-orange'
                : 'text-secondary-white hover:text-white'
            }`}
          >
            Trash<span className="hidden md:inline"> ({trashedInputs.length + trashedOutputs.length})</span>
            {activeTab === 'trash' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cosmic-orange" />
            )}
          </button>
        )}
      </div>

      {/* Inputs Tab */}
      {activeTab === 'inputs' && (
        <div>
          {/* Add Input Controls - Only visible to editors and above */}
          {canEdit && (
          <div className="flex flex-col md:flex-row md:justify-end gap-3 mb-4">
            {/* Settings Button */}
            <button
              onClick={() => {
                setEditProjectName(project?.name || '')
                setEditProjectDescription(project?.description || '')
                setShowProjectSettings(true)
              }}
              className="btn-secondary px-4 py-2 flex items-center justify-center gap-2 text-body-sm w-full md:w-auto"
              title="Project Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>

            {/* Add Input Dropdown */}
            <div ref={addInputDropdownRef} className="relative">
              <button
                onClick={() => setShowAddInputDropdown(!showAddInputDropdown)}
                disabled={uploadingFile}
                className="btn-primary px-4 py-2 flex items-center justify-center gap-2 text-body-sm w-full md:w-auto disabled:opacity-50"
              >
                {uploadingFile ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {uploadProgress || 'Processing...'}
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Input
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </>
                )}
              </button>

              {/* Dropdown Menu */}
              {showAddInputDropdown && (
                <div className="absolute right-0 mt-2 w-56 glass-container py-2 z-50">
                  {/* Recording */}
                  <button
                    onClick={() => {
                      setShowAddInputDropdown(false)
                      setShowRecordingModal(true)
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    <div>
                      <p className="text-body-sm text-secondary-white">Recording</p>
                      <p className="text-caption text-medium-gray uppercase tracking-wider">FROM YOUR RECORDINGS</p>
                    </div>
                  </button>

                  {/* Text Input */}
                  <button
                    onClick={() => {
                      setShowAddInputDropdown(false)
                      setShowTextInputModal(true)
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>
                      <p className="text-body-sm text-secondary-white">Text</p>
                      <p className="text-caption text-medium-gray uppercase tracking-wider">TYPE OR PASTE TEXT</p>
                    </div>
                  </button>

                  {/* Web Scraping */}
                  <button
                    onClick={() => {
                      setShowAddInputDropdown(false)
                      setShowWebScrapingModal(true)
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    <div>
                      <p className="text-body-sm text-secondary-white">Web Scraping</p>
                      <p className="text-caption text-medium-gray uppercase tracking-wider">INSERT URL</p>
                    </div>
                  </button>

                  {/* Audio File */}
                  <button
                    onClick={() => {
                      setShowAddInputDropdown(false)
                      audioInputRef.current?.click()
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-fuchsia-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    <div>
                      <p className="text-body-sm text-secondary-white">Audio File</p>
                      <p className="text-caption text-medium-gray uppercase tracking-wider">MP3, WAV, M4A</p>
                    </div>
                  </button>

                  {/* Document */}
                  <button
                    onClick={() => {
                      setShowAddInputDropdown(false)
                      documentInputRef.current?.click()
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="text-body-sm text-secondary-white">Document</p>
                      <p className="text-caption text-medium-gray uppercase tracking-wider">PDF, DOCX, TXT</p>
                    </div>
                  </button>

                  {/* Cover Photo */}
                  <button
                    onClick={() => {
                      setShowAddInputDropdown(false)
                      coverPhotoInputRef.current?.click()
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-lime-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="text-body-sm text-secondary-white">Cover Photo</p>
                      <p className="text-caption text-medium-gray uppercase tracking-wider">MAIN ARTICLE PHOTO</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Hidden File Inputs */}
            <input
              ref={audioInputRef}
              type="file"
              accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files, 'audio')}
            />
            <input
              ref={documentInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files, 'document')}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files, 'image')}
            />
            <input
              ref={coverPhotoInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files, 'cover_photo')}
            />
          </div>
          )}

          {inputs.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              }
              title="No Inputs Yet"
              description="Add recordings, text, documents, or images as inputs to generate your article."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {inputs.map((input) => {
                const isFromRecording = input.metadata?.source === 'recording'
                const isFromUpload = input.metadata?.source === 'upload'
                const typeInfo = getInputTypeInfo(input)
                const defaultTitle = isFromRecording ? 'Recording' : input.type === 'cover_photo' ? 'Cover Photo' : input.type === 'image' ? 'Image' : input.type === 'document' ? 'Document' : input.type === 'audio' ? 'Audio' : input.type === 'web_scrape' ? 'Web Page' : 'Text Input'
                
                return (
                  <div
                    key={input.id}
                    onClick={() => setSelectedInput(input)}
                    className="glass-container p-6 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    {/* Top left: icon + type label (no box) */}
                    <div className={`flex items-center gap-2 text-caption uppercase tracking-wider ${typeInfo.color}`}>
                      <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">{typeInfo.icon}</span>
                      <span>
                        {typeInfo.label}
                        {isFromRecording && input.metadata?.recording_duration && (
                          <>
                            <span className="text-medium-gray"> • </span>
                            <span>{formatDuration(input.metadata.recording_duration)}</span>
                          </>
                        )}
                        {isFromUpload && input.file_size && (
                          <>
                            <span className="text-medium-gray"> • </span>
                            <span className="text-medium-gray">{(input.file_size / 1024).toFixed(0)} KB</span>
                          </>
                        )}
                      </span>
                    </div>
                    
                    {/* Title */}
                    <h3 className="text-heading-md text-secondary-white font-medium mt-2 mb-1 line-clamp-2">
                      {input.file_name || defaultTitle}
                    </h3>
                    
                    {/* Subtitle: transcription, caption, or placeholder (match outputs: caption, uppercase, tracking-wider) */}
                    {input.type === 'web_scrape' && input.metadata?.url ? (
                      <p className={`text-caption mb-2 line-clamp-2 uppercase tracking-wider break-all ${typeInfo.color}`} title={input.metadata.url as string}>
                        {((input.metadata.url as string).length > 100 ? `${(input.metadata.url as string).slice(0, 100)}…` : (input.metadata.url as string)).toUpperCase()}
                      </p>
                    ) : input.content ? (
                      <p className={`text-caption uppercase tracking-wider mb-2 line-clamp-2 ${typeInfo.color}`}>
                        {(input.type === 'web_scrape' && input.content.length > 80 ? input.content.slice(0, 80) + '…' : input.content).toUpperCase()}
                      </p>
                    ) : input.type === 'image' && input.metadata?.photo_caption ? (
                      <p className={`text-caption uppercase tracking-wider mb-2 line-clamp-2 ${typeInfo.color}`}>
                        {(input.metadata.photo_caption as string).toUpperCase()}
                      </p>
                    ) : input.type === 'image' && input.metadata?.source === 'workflow_generated' ? (
                      <p className="text-caption text-yellow-400 uppercase tracking-wider mb-2">
                        IMAGE GENERATED WITH DIFFUSE.AI
                      </p>
                    ) : input.type === 'image' ? (
                      <p className="text-caption text-medium-gray uppercase tracking-wider mb-2 italic">
                        IMAGE WILL BE PROCESSED BY THE WORKFLOW
                      </p>
                    ) : input.type === 'cover_photo' ? (
                      <p className="text-caption text-medium-gray uppercase tracking-wider mb-2 italic">
                        {project?.project_type === 'advertisement'
                          ? 'COVER PHOTO WILL APPEAR AT THE TOP OF YOUR PUBLISHED ADVERTISEMENT.'
                          : 'COVER PHOTO WILL APPEAR AS THE MAIN PHOTO IN YOUR PUBLISHED ARTICLE.'}
                      </p>
                    ) : null}
                    
                    {/* Date */}
                    <div className="text-caption text-medium-gray uppercase tracking-wider">
                      {new Date(input.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Outputs Tab */}
      {activeTab === 'outputs' && (
        <div>
          {/* Generate Dropdown - Same position as Inputs buttons */}
          {canEdit && inputs.length > 0 && (
            <div className="flex justify-end gap-3 mb-4 flex-wrap">
              {/* Secondary: Quick → type-only modal (Article/Ad) */}
              <button
                onClick={() => setShowQuickGenerateModal(true)}
                disabled={generatingArticle}
                className={`px-4 py-2 flex items-center gap-2 text-body-sm rounded-glass transition-colors ${
                  generatingArticle && generateSource === 'quick'
                    ? 'btn-secondary opacity-50 cursor-not-allowed'
                    : 'btn-secondary'
                }`}
              >
                {generatingArticle && generateSource === 'quick' ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Quick
                  </>
                )}
              </button>

              {/* Primary: Generate → refinements quiz (tone, length, audience, comments) */}
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
                disabled={generatingArticle}
                className={`px-4 py-2 flex items-center gap-2 text-body-sm rounded-glass transition-colors ${
                  generatingArticle && generateSource === 'refine'
                    ? 'btn-primary opacity-50 cursor-not-allowed'
                    : 'btn-primary'
                }`}
              >
                {generatingArticle && generateSource === 'refine' ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                    Generate
                  </>
                )}
              </button>
            </div>
          )}

          {outputs.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              }
              title="No Outputs Yet"
              description={inputs.length === 0 
                ? "Add inputs before generating your article." 
                : "Click Generate above to create an article from your inputs."
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {outputs.map((output) => {
                const info = getOutputInfo(output)
                const isAd = output.output_type === 'ad'
                const outputLabel = isAd ? 'ADVERTISEMENT' : 'ARTICLE'
                const outputColor = isAd ? 'text-amber-400' : 'text-teal-400'
                return (
                  <div
                    key={output.id}
                    onClick={() => setSelectedOutput(output)}
                    className="glass-container p-6 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    {/* Top left: icon + type label (teal = article, amber = advertisement) */}
                    <div className={`flex items-center gap-2 text-caption uppercase tracking-wider ${outputColor}`}>
                      <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </span>
                      <span>{outputLabel}</span>
                    </div>
                    
                    {/* Title */}
                    <h3 className="text-heading-md text-secondary-white font-medium mt-2 mb-1 line-clamp-2">
                      {info.title}
                    </h3>
                    
                    {/* Subtitle */}
                    {info.subtitle && (
                      <p className={`text-caption uppercase tracking-wider mb-2 line-clamp-2 ${outputColor}`}>
                        {info.subtitle.toUpperCase()}
                      </p>
                    )}
                    
                    {/* Date */}
                    <div className="text-caption uppercase tracking-wider">
                      <span className={outputColor}>{info.author.toUpperCase()}</span>
                      <span className="text-medium-gray"> • </span>
                      <span className="text-medium-gray">
                        {new Date(output.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Visibility Tab - Same layout as Inputs/Outputs: top buttons + grid of cards */}
      {activeTab === 'visibility' && (
        <div>
          {/* Private / Public - Same position and style as Outputs Quick / Generate */}
          <div className="flex justify-end gap-3 mb-4 flex-wrap">
            {/* Private - deselects all; orange when selected, gray when not */}
            <button
              onClick={() => {
                setVisibility('private')
                setSelectedOrgs([])
              }}
              className={`px-4 py-2 flex items-center gap-2 text-body-sm rounded-glass transition-colors ${
                visibility === 'private' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Private
            </button>

            {/* Orange: Public - selects all */}
            <button
              onClick={() => {
                setVisibility('public')
                setSelectedOrgs(workspaces.map(({ workspace }) => workspace.id))
              }}
              className={`px-4 py-2 flex items-center gap-2 text-body-sm rounded-glass transition-colors ${
                visibility === 'public' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Public
            </button>
          </div>

          {/* Organization list - Same grid as Inputs/Outputs */}
          {workspaces.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              }
              title="No Organizations"
              description="Join an organization to share this project with others."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 mb-6">
              {workspaces.map(({ workspace }) => {
                const isSelected = selectedOrgs.includes(workspace.id)
                return (
                  <div
                    key={workspace.id}
                    onClick={() => {
                      if (visibility === 'private') {
                        setVisibility('public')
                        setSelectedOrgs([workspace.id])
                      } else if (isSelected) {
                        const newOrgs = selectedOrgs.filter(id => id !== workspace.id)
                        setSelectedOrgs(newOrgs)
                        if (newOrgs.length === 0) {
                          setVisibility('private')
                        }
                      } else {
                        setSelectedOrgs([...selectedOrgs, workspace.id])
                      }
                    }}
                    className={`glass-container p-6 transition-colors cursor-pointer ${
                      isSelected && visibility === 'public'
                        ? 'bg-cosmic-orange/20 border-cosmic-orange/30 hover:bg-cosmic-orange/25'
                        : 'hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-white/5 text-cosmic-orange">
                        {isSelected && visibility === 'public' ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-heading-md text-secondary-white font-medium mb-1 break-words">
                          {workspace.name}
                        </h3>
                        <p className="text-caption text-medium-gray uppercase tracking-wider">
                          {isSelected && visibility === 'public' ? 'SHARED' : 'ORGANIZATION'}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Save Button */}
          <button
            onClick={handleSaveVisibility}
            disabled={savingVisibility}
            className="btn-primary px-6 py-3 text-xs font-medium disabled:opacity-50"
          >
            {savingVisibility ? 'Saving...' : 'Save Visibility Settings'}
          </button>
        </div>
      )}

      {/* Trash Tab */}
      {activeTab === 'trash' && (
        <div className="space-y-8">
          {/* Trashed Inputs */}
          {trashedInputs.length > 0 && (
            <div>
              <h3 className="text-body-md text-medium-gray uppercase tracking-wider mb-4">
                Trashed Inputs ({trashedInputs.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                {trashedInputs.map((input) => {
                  const isFromRecording = input.metadata?.source === 'recording'
                  const typeInfo = getInputTypeInfo(input)
                  
                  return (
                    <div
                      key={input.id}
                      className="glass-container p-6 opacity-60"
                    >
                      {/* Top left: icon + type label */}
                      <div className={`flex items-center gap-2 text-caption uppercase tracking-wider ${typeInfo.color}`}>
                        <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">{typeInfo.icon}</span>
                        <span>
                          {typeInfo.label}
                          {isFromRecording && input.metadata?.recording_duration && (
                            <>
                              <span className="text-medium-gray"> • </span>
                              <span>{formatDuration(input.metadata.recording_duration)}</span>
                            </>
                          )}
                        </span>
                      </div>
                      
                      {/* Title */}
                      <h3 className="text-heading-md text-secondary-white font-medium mt-2 mb-1 line-clamp-2">
                        {input.file_name || (isFromRecording ? 'Recording' : input.type === 'cover_photo' ? 'Cover Photo' : 'Text Input')}
                      </h3>
                      
                      {/* Subtitle / content preview (match outputs styling) */}
                      {input.content && (
                        <p className={`text-caption uppercase tracking-wider mb-2 line-clamp-2 ${typeInfo.color}`}>
                          {input.content.toUpperCase()}
                        </p>
                      )}
                      
                      {/* Date (match outputs: label in type color, date in gray) */}
                      <div className="text-caption uppercase tracking-wider">
                        <span className={typeInfo.color}>DELETED</span>
                        <span className="text-medium-gray"> • </span>
                        <span className="text-medium-gray">
                          {new Date(input.deleted_at || input.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                        </span>
                      </div>
                      
                      {/* Action Buttons - Only for editors and above */}
                      {canEdit && (
                        <div className="flex gap-2 mt-4">
                          <button
                            onClick={() => handleRestoreInput(input.id)}
                            className="btn-secondary flex-1 py-2 text-body-sm"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => handlePermanentDeleteInput(input.id)}
                            className="flex-1 py-2 text-body-sm bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 text-red-400 rounded-glass transition-colors"
                          >
                            Delete Forever
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Trashed Outputs */}
          {trashedOutputs.length > 0 && (
            <div>
              <h3 className="text-body-md text-medium-gray uppercase tracking-wider mb-4">
                Trashed Outputs ({trashedOutputs.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                {trashedOutputs.map((output) => {
                  const info = getOutputInfo(output)
                  const isAd = output.output_type === 'ad'
                  const outputLabel = isAd ? 'ADVERTISEMENT' : 'ARTICLE'
                  const outputColor = isAd ? 'text-amber-400' : 'text-teal-400'
                  return (
                    <div
                      key={output.id}
                      className="glass-container p-6 opacity-60"
                    >
                      {/* Top left: icon + type label (teal = article, amber = advertisement) */}
                      <div className={`flex items-center gap-2 text-caption uppercase tracking-wider ${outputColor}`}>
                        <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </span>
                        <span>{outputLabel}</span>
                      </div>
                      
                      {/* Title */}
                      <h3 className="text-heading-md text-secondary-white font-medium mt-2 mb-1 line-clamp-2">
                        {info.title}
                      </h3>
                      
                      {/* Subtitle */}
                      {info.subtitle && (
                        <p className={`text-caption uppercase tracking-wider mb-2 line-clamp-2 ${outputColor}`}>
                          {info.subtitle.toUpperCase()}
                        </p>
                      )}
                      
                      {/* Date */}
                      <div className="text-caption uppercase tracking-wider">
                        <span className={outputColor}>{info.author.toUpperCase()}</span>
                        <span className="text-medium-gray"> • </span>
                        <span className="text-medium-gray">
                          DELETED {new Date(output.deleted_at || output.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                        </span>
                      </div>
                      
                      {/* Action Buttons - Only for editors and above */}
                      {canEdit && (
                        <div className="flex flex-col sm:flex-row gap-2 mt-4">
                          <button
                            onClick={() => handleRestoreOutput(output.id)}
                            className="btn-secondary flex-1 py-2 text-body-sm w-full sm:w-auto"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => handlePermanentDeleteOutput(output.id)}
                            className="flex-1 py-2 text-body-sm w-full sm:w-auto bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 text-red-400 rounded-glass transition-colors"
                          >
                            Delete Forever
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty state if both are empty (shouldn't happen but just in case) */}
          {trashedInputs.length === 0 && trashedOutputs.length === 0 && (
            <EmptyState
              title="Trash is Empty"
              description="Deleted inputs and outputs will appear here."
            />
          )}
        </div>
      )}

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
      {selectedOutput && (
        <OutputDetailModal
          output={selectedOutput}
          onClose={() => setSelectedOutput(null)}
          onUpdate={fetchProjectData}
          onReeditComplete={(updated) => {
            setSelectedOutput(updated)
            fetchProjectData()
          }}
          onDelete={handleDeleteOutput}
          canEdit={canEdit}
          canDelete={canDelete}
          fallbackCoverPhotoPath={inputs.find(i => i.type === 'cover_photo')?.file_path ?? null}
          projectType={project?.project_type === 'advertisement' ? 'advertisement' : project?.project_type === 'project' ? 'article' : undefined}
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
                  setShowDeleteConfirm(false)
                  setDeleteConfirmText('')
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
              className="btn-primary w-full py-2 text-body-sm disabled:opacity-50 mb-5"
            >
              Save Changes
            </button>

            {/* Action Grid */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleDeleteAllInputs}
                disabled={deletingAllInputs || (inputs.length === 0 && trashedInputs.length === 0)}
                className="p-3 bg-white/5 hover:bg-yellow-500/10 border border-white/10 hover:border-yellow-500/30 rounded-glass transition-colors text-left disabled:opacity-50 disabled:hover:bg-white/5 disabled:hover:border-white/10"
              >
                <p className="text-body-sm text-secondary-white font-medium">Delete Inputs</p>
                <p className="text-caption text-medium-gray">{inputs.length + trashedInputs.length} items</p>
              </button>

              <button
                onClick={handleDeleteAllOutputs}
                disabled={deletingAllOutputs || (outputs.length === 0 && trashedOutputs.length === 0)}
                className="p-3 bg-white/5 hover:bg-yellow-500/10 border border-white/10 hover:border-yellow-500/30 rounded-glass transition-colors text-left disabled:opacity-50 disabled:hover:bg-white/5 disabled:hover:border-white/10"
              >
                <p className="text-body-sm text-secondary-white font-medium">Delete Outputs</p>
                <p className="text-caption text-medium-gray">{outputs.length + trashedOutputs.length} items</p>
              </button>

              {canDelete && !showDeleteConfirm && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deletingProject}
                  className="col-span-2 p-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 rounded-glass transition-colors text-left disabled:opacity-50"
                >
                  <p className="text-body-sm text-red-400 font-medium">Delete Project</p>
                  <p className="text-caption text-medium-gray">Permanently remove everything</p>
                </button>
              )}

              {canDelete && showDeleteConfirm && (
                <div className="col-span-2 p-3 bg-red-500/10 border border-red-500/30 rounded-glass">
                  <p className="text-body-sm text-red-400 font-medium mb-2">Type &quot;DELETE&quot; to confirm:</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value.toUpperCase())}
                      placeholder="DELETE"
                      className="flex-1 min-w-0 px-3 py-2 bg-white/5 border border-red-500/30 rounded-glass text-secondary-white text-body-sm focus:outline-none focus:border-red-400 transition-colors"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteProject}
                        disabled={deletingProject || deleteConfirmText !== 'DELETE'}
                        className="flex-1 sm:flex-none px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 rounded-glass text-body-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingProject ? 'Deleting...' : 'Delete'}
                      </button>
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false)
                          setDeleteConfirmText('')
                        }}
                        className="flex-1 sm:flex-none px-3 py-2 text-medium-gray hover:text-secondary-white transition-colors"
                      >
                        Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

