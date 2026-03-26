-- Add Contractor Pro subscription tier (email-gated plan)
-- Run once in Supabase SQL editor / migration pipeline.

ALTER TYPE public.subscription_tier
ADD VALUE IF NOT EXISTS 'contractor_pro';

