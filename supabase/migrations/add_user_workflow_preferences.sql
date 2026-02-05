-- User workflow preferences: tone, length, audience, comments for "Refine and generate" modal.
-- One row per user; frontend can load/save to auto-fill the survey.
CREATE TABLE IF NOT EXISTS user_workflow_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tone text,
  length text,
  audience text,
  comments text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: users can only read and update their own row
ALTER TABLE user_workflow_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_workflow_preferences_select_own" ON user_workflow_preferences;
CREATE POLICY "user_workflow_preferences_select_own" ON user_workflow_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_workflow_preferences_insert_own" ON user_workflow_preferences;
CREATE POLICY "user_workflow_preferences_insert_own" ON user_workflow_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_workflow_preferences_update_own" ON user_workflow_preferences;
CREATE POLICY "user_workflow_preferences_update_own" ON user_workflow_preferences
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE user_workflow_preferences IS 'Saved refine-and-generate options (tone, length, audience, comments) per user for auto-fill.';
