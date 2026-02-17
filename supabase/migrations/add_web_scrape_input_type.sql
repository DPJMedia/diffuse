-- Add 'web_scrape' to input_type enum (for web page content inputs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'web_scrape' AND enumtypid = 'input_type'::regtype
  ) THEN
    ALTER TYPE input_type ADD VALUE 'web_scrape';
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'input_type enum not found; ensure type column allows web_scrape';
END $$;
