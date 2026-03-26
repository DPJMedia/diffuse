-- ============================================
-- DIFFUSE.AI DATABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. CUSTOM TYPES (ENUMS)
-- ============================================

-- User roles within workspaces
CREATE TYPE user_role AS ENUM ('admin', 'member');

-- User subscription tiers
CREATE TYPE subscription_tier AS ENUM ('free', 'pro', 'pro_max', 'contractor_pro');

-- User levels (account types)
CREATE TYPE user_level AS ENUM ('individual', 'contractor', 'admin', 'enterprise_admin');

-- Project status
CREATE TYPE project_status AS ENUM ('active', 'archived', 'draft');

-- Project visibility
CREATE TYPE project_visibility AS ENUM ('private', 'public');

-- Input types for projects
CREATE TYPE input_type AS ENUM ('text', 'audio');

-- Workflow processing status
CREATE TYPE workflow_status AS ENUM ('pending', 'processing', 'completed', 'failed');


-- ============================================
-- 2. USER PROFILES TABLE
-- ============================================

CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    subscription_tier subscription_tier DEFAULT 'free' NOT NULL,
    user_level user_level DEFAULT 'individual' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, full_name)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================
-- 3. WORKSPACES (ORGANIZATIONS) TABLE
-- ============================================

CREATE TABLE diffuse_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    invite_code TEXT UNIQUE DEFAULT UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8)),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for invite code lookups
CREATE INDEX idx_workspaces_invite_code ON diffuse_workspaces(invite_code);


-- ============================================
-- 4. WORKSPACE MEMBERS TABLE
-- ============================================

CREATE TABLE diffuse_workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES diffuse_workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role DEFAULT 'member' NOT NULL,
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Ensure unique membership per workspace
    UNIQUE(workspace_id, user_id)
);

-- Indexes for common queries
CREATE INDEX idx_workspace_members_workspace ON diffuse_workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user ON diffuse_workspace_members(user_id);


-- ============================================
-- 5. PROJECTS TABLE
-- ============================================

CREATE TABLE diffuse_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES diffuse_workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    visibility project_visibility DEFAULT 'private' NOT NULL,
    status project_status DEFAULT 'active' NOT NULL,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX idx_projects_workspace ON diffuse_projects(workspace_id);
CREATE INDEX idx_projects_created_by ON diffuse_projects(created_by);
CREATE INDEX idx_projects_status ON diffuse_projects(status);


-- ============================================
-- 6. PROJECT INPUTS TABLE
-- ============================================

CREATE TABLE diffuse_project_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES diffuse_projects(id) ON DELETE CASCADE,
    type input_type NOT NULL,
    content TEXT,
    file_path TEXT,
    file_name TEXT,
    file_size INTEGER,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for project lookups
CREATE INDEX idx_project_inputs_project ON diffuse_project_inputs(project_id);


-- ============================================
-- 7. PROJECT OUTPUTS TABLE
-- ============================================

CREATE TABLE diffuse_project_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES diffuse_projects(id) ON DELETE CASCADE,
    input_id UUID REFERENCES diffuse_project_inputs(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    structured_data JSONB DEFAULT '{}'::JSONB,
    workflow_status workflow_status DEFAULT 'pending' NOT NULL,
    workflow_metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for project lookups
CREATE INDEX idx_project_outputs_project ON diffuse_project_outputs(project_id);
CREATE INDEX idx_project_outputs_input ON diffuse_project_outputs(input_id);


-- ============================================
-- 8. RECORDINGS TABLE
-- ============================================

CREATE TABLE diffuse_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration INTEGER DEFAULT 0 NOT NULL, -- Duration in seconds
    file_path TEXT NOT NULL,
    transcription TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for user lookups
CREATE INDEX idx_recordings_user ON diffuse_recordings(user_id);


-- ============================================
-- 9. UPDATED_AT TRIGGER FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at
    BEFORE UPDATE ON diffuse_workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON diffuse_projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_outputs_updated_at
    BEFORE UPDATE ON diffuse_project_outputs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recordings_updated_at
    BEFORE UPDATE ON diffuse_recordings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffuse_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffuse_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffuse_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffuse_project_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffuse_project_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffuse_recordings ENABLE ROW LEVEL SECURITY;

-- ========== USER PROFILES ==========

-- Users can view and update their own profile
CREATE POLICY "Users can view own profile"
    ON user_profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON user_profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON user_profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ========== WORKSPACES ==========

-- Users can view workspaces they are members of
CREATE POLICY "Users can view member workspaces"
    ON diffuse_workspaces FOR SELECT
    USING (
        owner_id = auth.uid() OR
        id IN (
            SELECT workspace_id FROM diffuse_workspace_members
            WHERE user_id = auth.uid()
        )
    );

-- Users can create workspaces
CREATE POLICY "Users can create workspaces"
    ON diffuse_workspaces FOR INSERT
    WITH CHECK (auth.uid() = owner_id);

-- Only owners can update workspaces
CREATE POLICY "Owners can update workspaces"
    ON diffuse_workspaces FOR UPDATE
    USING (owner_id = auth.uid());

-- Only owners can delete workspaces
CREATE POLICY "Owners can delete workspaces"
    ON diffuse_workspaces FOR DELETE
    USING (owner_id = auth.uid());

-- Allow anyone to lookup workspace by invite code (for joining)
CREATE POLICY "Anyone can lookup workspace by invite code"
    ON diffuse_workspaces FOR SELECT
    USING (invite_code IS NOT NULL);

-- ========== WORKSPACE MEMBERS ==========

-- Users can view members of their workspaces
CREATE POLICY "Users can view workspace members"
    ON diffuse_workspace_members FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id FROM diffuse_workspace_members
            WHERE user_id = auth.uid()
        )
    );

-- Admins can add members
CREATE POLICY "Admins can add members"
    ON diffuse_workspace_members FOR INSERT
    WITH CHECK (
        -- User is joining themselves
        auth.uid() = user_id OR
        -- Or user is an admin of the workspace
        workspace_id IN (
            SELECT workspace_id FROM diffuse_workspace_members
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Admins can update member roles
CREATE POLICY "Admins can update members"
    ON diffuse_workspace_members FOR UPDATE
    USING (
        workspace_id IN (
            SELECT workspace_id FROM diffuse_workspace_members
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Admins can remove members, users can remove themselves
CREATE POLICY "Admins can remove members"
    ON diffuse_workspace_members FOR DELETE
    USING (
        user_id = auth.uid() OR
        workspace_id IN (
            SELECT workspace_id FROM diffuse_workspace_members
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ========== PROJECTS ==========

-- Users can view:
-- 1. Their own projects
-- 2. Public projects in workspaces they belong to
CREATE POLICY "Users can view accessible projects"
    ON diffuse_projects FOR SELECT
    USING (
        created_by = auth.uid() OR
        (
            visibility = 'public' AND
            workspace_id IN (
                SELECT workspace_id FROM diffuse_workspace_members
                WHERE user_id = auth.uid()
            )
        )
    );

-- Users can create projects
CREATE POLICY "Users can create projects"
    ON diffuse_projects FOR INSERT
    WITH CHECK (auth.uid() = created_by);

-- Users can update their own projects
CREATE POLICY "Users can update own projects"
    ON diffuse_projects FOR UPDATE
    USING (created_by = auth.uid());

-- Users can delete their own projects
CREATE POLICY "Users can delete own projects"
    ON diffuse_projects FOR DELETE
    USING (created_by = auth.uid());

-- ========== PROJECT INPUTS ==========

-- Users can view inputs for projects they can access
CREATE POLICY "Users can view project inputs"
    ON diffuse_project_inputs FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM diffuse_projects
            WHERE created_by = auth.uid() OR
            (
                visibility = 'public' AND
                workspace_id IN (
                    SELECT workspace_id FROM diffuse_workspace_members
                    WHERE user_id = auth.uid()
                )
            )
        )
    );

-- Users can add inputs to their projects
CREATE POLICY "Users can add inputs to own projects"
    ON diffuse_project_inputs FOR INSERT
    WITH CHECK (
        project_id IN (
            SELECT id FROM diffuse_projects WHERE created_by = auth.uid()
        )
    );

-- Users can delete inputs from their projects
CREATE POLICY "Users can delete inputs from own projects"
    ON diffuse_project_inputs FOR DELETE
    USING (
        project_id IN (
            SELECT id FROM diffuse_projects WHERE created_by = auth.uid()
        )
    );

-- ========== PROJECT OUTPUTS ==========

-- Users can view outputs for projects they can access
CREATE POLICY "Users can view project outputs"
    ON diffuse_project_outputs FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM diffuse_projects
            WHERE created_by = auth.uid() OR
            (
                visibility = 'public' AND
                workspace_id IN (
                    SELECT workspace_id FROM diffuse_workspace_members
                    WHERE user_id = auth.uid()
                )
            )
        )
    );

-- Users can add outputs to their projects (or via webhook service role)
CREATE POLICY "Users can add outputs to own projects"
    ON diffuse_project_outputs FOR INSERT
    WITH CHECK (
        project_id IN (
            SELECT id FROM diffuse_projects WHERE created_by = auth.uid()
        )
    );

-- Users can update outputs in their projects
CREATE POLICY "Users can update outputs in own projects"
    ON diffuse_project_outputs FOR UPDATE
    USING (
        project_id IN (
            SELECT id FROM diffuse_projects WHERE created_by = auth.uid()
        )
    );

-- Users can delete outputs from their projects
CREATE POLICY "Users can delete outputs from own projects"
    ON diffuse_project_outputs FOR DELETE
    USING (
        project_id IN (
            SELECT id FROM diffuse_projects WHERE created_by = auth.uid()
        )
    );

-- ========== RECORDINGS ==========

-- Users can only access their own recordings
CREATE POLICY "Users can view own recordings"
    ON diffuse_recordings FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create own recordings"
    ON diffuse_recordings FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own recordings"
    ON diffuse_recordings FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete own recordings"
    ON diffuse_recordings FOR DELETE
    USING (user_id = auth.uid());


-- ============================================
-- 11. STORAGE BUCKET FOR RECORDINGS
-- ============================================

-- Create storage bucket (run in SQL editor)
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for recordings bucket
CREATE POLICY "Users can upload own recordings"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'recordings' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view own recordings"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'recordings' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete own recordings"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'recordings' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );


-- ============================================
-- 12. USEFUL VIEWS (OPTIONAL)
-- ============================================

-- View: User's workspaces with their role
CREATE OR REPLACE VIEW user_workspaces AS
SELECT 
    w.*,
    m.role,
    m.joined_at
FROM diffuse_workspaces w
JOIN diffuse_workspace_members m ON w.id = m.workspace_id
WHERE m.user_id = auth.uid();

-- View: Project counts per user (for subscription limits)
CREATE OR REPLACE VIEW user_project_counts AS
SELECT 
    created_by as user_id,
    COUNT(*) as project_count
FROM diffuse_projects
WHERE status != 'archived'
GROUP BY created_by;


-- ============================================
-- SETUP COMPLETE!
-- ============================================
-- 
-- After running this SQL:
-- 
-- 1. Update your .env.local with the new Supabase URL and anon key
-- 2. Update Vercel environment variables if deployed
-- 3. Test authentication flow
-- 4. Test creating projects and recordings
--
-- Subscription Limits (enforced in app):
-- - Free: 3 projects
-- - Pro: 15 projects  
-- - Pro Max: Unlimited
-- ============================================

