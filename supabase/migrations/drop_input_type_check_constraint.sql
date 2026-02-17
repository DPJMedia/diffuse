-- Remove CHECK constraint that blocks enum value 'web_scrape'
-- The column type is already input_type (enum); the enum was updated in add_web_scrape_input_type.sql
ALTER TABLE diffuse_project_inputs
DROP CONSTRAINT IF EXISTS diffuse_project_inputs_type_check;
