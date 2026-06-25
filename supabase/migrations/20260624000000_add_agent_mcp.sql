-- Agent MCP (authenticated write server) support.
-- Adds: Personal Access Tokens, durable usage/rate-limit counters, a per-output
-- callback nonce, and an idempotent re-pin of the outputs INSERT policy.
-- Safe to run multiple times.

-- 1) Personal Access Tokens -----------------------------------------------------
-- Hashed-at-rest Bearer secrets that authenticate a user to the /api/agent MCP.
-- We store ONLY the sha256 hash + a display prefix, never the plaintext.
CREATE TABLE IF NOT EXISTS diffuse_agent_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'Agent token',
  token_hash   TEXT NOT NULL UNIQUE,          -- sha256(plaintext) hex
  prefix       TEXT NOT NULL,                 -- first chars (e.g. "dfp_AbC1") for display only
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['mcp:read','mcp:write'],
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,                   -- NULL = no expiry
  revoked_at   TIMESTAMPTZ,                   -- non-NULL = revoked
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_created_by ON diffuse_agent_tokens(created_by);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_hash ON diffuse_agent_tokens(token_hash);

ALTER TABLE diffuse_agent_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_tokens_select" ON diffuse_agent_tokens;
CREATE POLICY "agent_tokens_select" ON diffuse_agent_tokens
  FOR SELECT USING (created_by = auth.uid());

DROP POLICY IF EXISTS "agent_tokens_insert" ON diffuse_agent_tokens;
CREATE POLICY "agent_tokens_insert" ON diffuse_agent_tokens
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "agent_tokens_update" ON diffuse_agent_tokens;
CREATE POLICY "agent_tokens_update" ON diffuse_agent_tokens
  FOR UPDATE USING (created_by = auth.uid());

DROP POLICY IF EXISTS "agent_tokens_delete" ON diffuse_agent_tokens;
CREATE POLICY "agent_tokens_delete" ON diffuse_agent_tokens
  FOR DELETE USING (created_by = auth.uid());

-- 2) Durable usage / rate-limit counters ---------------------------------------
-- Replaces the in-memory limiter for the agent path (PAT requests carry no cookie,
-- so the cookie/IP limiter is non-functional for them). Used for per-user hourly
-- write caps AND the monthly article-units quota.
CREATE TABLE IF NOT EXISTS diffuse_agent_usage (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,                 -- e.g. 'generate_output', 'article_units', 'create_project'
  window_start TIMESTAMPTZ NOT NULL,          -- bucket boundary (hour, or month for quota)
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, action, window_start)
);
ALTER TABLE diffuse_agent_usage ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the SECURITY DEFINER function and the service role touch this.

-- Atomic check-and-increment. Returns TRUE if the increment was applied (still within
-- p_limit), FALSE if it would exceed p_limit (in which case nothing is incremented).
CREATE OR REPLACE FUNCTION agent_usage_check_and_increment(
  p_user_id      UUID,
  p_action       TEXT,
  p_window_start TIMESTAMPTZ,
  p_limit        INTEGER,
  p_increment    INTEGER DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur INTEGER;
BEGIN
  INSERT INTO diffuse_agent_usage (user_id, action, window_start, count)
    VALUES (p_user_id, p_action, p_window_start, 0)
    ON CONFLICT (user_id, action, window_start) DO NOTHING;

  SELECT count INTO cur FROM diffuse_agent_usage
    WHERE user_id = p_user_id AND action = p_action AND window_start = p_window_start
    FOR UPDATE;

  IF cur + p_increment > p_limit THEN
    RETURN FALSE;
  END IF;

  UPDATE diffuse_agent_usage
    SET count = count + p_increment, updated_at = NOW()
    WHERE user_id = p_user_id AND action = p_action AND window_start = p_window_start;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION agent_usage_check_and_increment(UUID, TEXT, TIMESTAMPTZ, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_usage_check_and_increment(UUID, TEXT, TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;

-- 3) Per-output callback nonce -------------------------------------------------
-- Bound to each pending output and echoed by n8n on callback so a guessed output_id
-- alone cannot drive /api/workflow/callback.
ALTER TABLE diffuse_project_outputs ADD COLUMN IF NOT EXISTS callback_nonce TEXT;

-- 4) Idempotent re-pin of the outputs INSERT policy (owner or shared-org only) --
-- The repo historically defined this policy three different ways; pin it to the
-- intended owner-or-shared-org rule so a normal (RLS-bound) client can never insert
-- an output into a project it cannot see. (The agent path additionally enforces
-- strict ownership in application code before any insert.)
DROP POLICY IF EXISTS "outputs_insert" ON diffuse_project_outputs;
CREATE POLICY "outputs_insert" ON diffuse_project_outputs
FOR INSERT WITH CHECK (
  project_id IN (SELECT id FROM diffuse_projects WHERE created_by = auth.uid())
  OR project_id IN (
    SELECT id FROM diffuse_projects
    WHERE visibility = 'public'
    AND visible_to_orgs && ARRAY(SELECT get_my_workspace_ids())::text[]
  )
);
