-- Add number_of_outputs column for saved default (2-10) when user selects multiple articles.
ALTER TABLE user_workflow_preferences
ADD COLUMN IF NOT EXISTS number_of_outputs integer;

COMMENT ON COLUMN user_workflow_preferences.number_of_outputs IS 'Saved default: 2-10 articles per run when "Save all responses as default" is used.';
