export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer'

export type ProjectStatus = 'active' | 'archived' | 'draft'

export type ProjectVisibility = 'private' | 'public'

export type ProjectType = 'project' | 'advertisement'

export type InputType = 'text' | 'audio' | 'image' | 'document' | 'cover_photo' | 'web_scrape'

export type OutputType = 'article' | 'ad'

export type WorkflowStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type RecordingStatus = 'recorded' | 'generating' | 'transcribed'

export type OrganizationPlan = 'enterprise_pro' | 'enterprise_pro_max'

export interface DiffuseWorkspace {
  id: string
  name: string
  description?: string
  invite_code?: string
  plan?: OrganizationPlan
  created_at: string
  updated_at: string
  owner_id: string
}

export interface DiffuseWorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: UserRole
  joined_at: string
  invited_by?: string
}

export interface DiffuseProject {
  id: string
  workspace_id: string | null
  name: string
  description?: string
  visibility: ProjectVisibility
  visible_to_orgs?: string[]
  status: ProjectStatus
  project_type: ProjectType
  created_at: string
  updated_at: string
  created_by: string
}

export interface DiffuseProjectInput {
  id: string
  project_id: string
  type: InputType
  content?: string
  file_path?: string
  file_name?: string
  file_size?: number
  metadata?: Record<string, any>
  created_at: string
  created_by: string
  deleted_at?: string | null
}

export interface DiffuseProjectOutput {
  id: string
  project_id: string
  input_id?: string
  content: string
  output_type: OutputType
  structured_data?: Record<string, any>
  workflow_status: WorkflowStatus
  workflow_metadata?: Record<string, any>
  cover_photo_path?: string | null
  reedit_count?: number
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export type RecordingUtterance = {
  speaker: string
  text: string
  start: number
  end: number
}

export interface DiffuseRecording {
  id: string
  user_id: string
  title: string
  duration: number
  file_path: string
  transcription: string | null
  original_transcription?: string | null
  speaker_map?: Record<string, { name: string; position?: string }> | null
  utterances?: RecordingUtterance[] | null
  original_utterances?: RecordingUtterance[] | null
  status: RecordingStatus
  created_at: string
  updated_at: string
}

export interface UserWithWorkspaces {
  id: string
  email: string
  workspaces: Array<{
    workspace: DiffuseWorkspace
    role: UserRole
  }>
}

