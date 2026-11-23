-- ============================================================================
-- SUPABASE SQL EDITOR VERSION
-- Add performance indexes and security for email registration tables
-- Copy and paste this entire file into Supabase SQL Editor and run
-- ============================================================================
-- Purpose: Add indexes, Row Level Security, and CASCADE delete
-- Safe to run: Yes (all operations are idempotent with IF NOT EXISTS)
-- Rollback: See comments at bottom
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Check for duplicate emails (case-insensitive)
-- ============================================================================

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT lower(email), COUNT(*) 
    FROM public.users 
    GROUP BY lower(email) 
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Found % duplicate emails (case-insensitive). Fix duplicates before running this migration.', duplicate_count;
  END IF;
  
  RAISE NOTICE 'No duplicate emails found. Proceeding...';
END $$;

-- ============================================================================
-- STEP 2: Create case-insensitive unique index on users.email
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON public.users (lower(email));

COMMENT ON INDEX uq_users_email_lower IS 
  'Ensures email uniqueness regardless of case (test@example.com = TEST@example.com)';

-- ============================================================================
-- STEP 3: Create unique index for pending registrations (one per email)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_email
  ON public.pending_registrations (lower(email))
  WHERE status = 'PENDING';

COMMENT ON INDEX uq_pending_registration_email IS 
  'Ensures only one PENDING registration per email (case-insensitive)';

-- ============================================================================
-- STEP 4: Create performance index for expiry cleanup queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pending_registrations_expiry
  ON public.pending_registrations (expires_at)
  WHERE status = 'PENDING';

COMMENT ON INDEX idx_pending_registrations_expiry IS 
  'Optimizes cleanup queries that find expired pending registrations';

-- ============================================================================
-- STEP 5: Create unique index for active OTP (one per registration)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_registration_otp
  ON public.registration_otps (registration_id)
  WHERE status = 'PENDING';

COMMENT ON INDEX uq_active_registration_otp IS 
  'Ensures only one active (PENDING) OTP per registration';

-- ============================================================================
-- STEP 6: Create performance index for OTP history queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_registration_otps_registration_created
  ON public.registration_otps (registration_id, created_at DESC);

COMMENT ON INDEX idx_registration_otps_registration_created IS 
  'Optimizes queries that fetch OTP history for a registration';

-- ============================================================================
-- STEP 7: Enable Row Level Security
-- ============================================================================
-- RLS prevents clients from directly querying password hashes and OTP data
-- Backend service role can still access via connection pooler

ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_otps ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pending_registrations IS 
  'RLS enabled: Contains password hashes. Backend-only access via service role.';

COMMENT ON TABLE public.registration_otps IS 
  'RLS enabled: Contains OTP hashes. Backend-only access via service role.';

-- ============================================================================
-- STEP 8: Add CASCADE delete for automatic cleanup
-- ============================================================================
-- Drop existing constraint if it exists (to make idempotent)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'registration_otps_registration_fkey'
      AND conrelid = 'public.registration_otps'::regclass
  ) THEN
    ALTER TABLE public.registration_otps
      DROP CONSTRAINT registration_otps_registration_fkey;
  END IF;
END $$;

-- Add constraint with CASCADE delete
ALTER TABLE public.registration_otps
  ADD CONSTRAINT registration_otps_registration_fkey
  FOREIGN KEY (registration_id)
  REFERENCES public.pending_registrations(id)
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT registration_otps_registration_fkey ON public.registration_otps IS 
  'ON DELETE CASCADE: Automatically deletes OTPs when registration is deleted';

-- ============================================================================
-- STEP 9: Verify all changes
-- ============================================================================

DO $$
DECLARE
  result_text TEXT := '';
  all_good BOOLEAN := true;
BEGIN
  result_text := E'\n=== MIGRATION VERIFICATION ===\n\n';
  
  -- Check indexes
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='uq_users_email_lower') THEN
    result_text := result_text || E'✅ uq_users_email_lower created\n';
  ELSE
    result_text := result_text || E'❌ uq_users_email_lower FAILED\n';
    all_good := false;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='uq_pending_registration_email') THEN
    result_text := result_text || E'✅ uq_pending_registration_email created\n';
  ELSE
    result_text := result_text || E'❌ uq_pending_registration_email FAILED\n';
    all_good := false;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_pending_registrations_expiry') THEN
    result_text := result_text || E'✅ idx_pending_registrations_expiry created\n';
  ELSE
    result_text := result_text || E'❌ idx_pending_registrations_expiry FAILED\n';
    all_good := false;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='uq_active_registration_otp') THEN
    result_text := result_text || E'✅ uq_active_registration_otp created\n';
  ELSE
    result_text := result_text || E'❌ uq_active_registration_otp FAILED\n';
    all_good := false;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_registration_otps_registration_created') THEN
    result_text := result_text || E'✅ idx_registration_otps_registration_created created\n';
  ELSE
    result_text := result_text || E'❌ idx_registration_otps_registration_created FAILED\n';
    all_good := false;
  END IF;
  
  -- Check RLS
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid='public.pending_registrations'::regclass AND relrowsecurity) THEN
    result_text := result_text || E'✅ pending_registrations RLS enabled\n';
  ELSE
    result_text := result_text || E'❌ pending_registrations RLS FAILED\n';
    all_good := false;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid='public.registration_otps'::regclass AND relrowsecurity) THEN
    result_text := result_text || E'✅ registration_otps RLS enabled\n';
  ELSE
    result_text := result_text || E'❌ registration_otps RLS FAILED\n';
    all_good := false;
  END IF;
  
  -- Check CASCADE
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid='public.registration_otps'::regclass 
      AND conname='registration_otps_registration_fkey'
      AND pg_get_constraintdef(oid) LIKE '%ON DELETE CASCADE%'
  ) THEN
    result_text := result_text || E'✅ CASCADE delete configured\n';
  ELSE
    result_text := result_text || E'❌ CASCADE delete FAILED\n';
    all_good := false;
  END IF;
  
  result_text := result_text || E'\n';
  
  IF all_good THEN
    result_text := result_text || E'🎉 ALL CHECKS PASSED! Migration completed successfully.\n';
  ELSE
    result_text := result_text || E'⚠️  Some checks failed. Review errors above.\n';
  END IF;
  
  RAISE NOTICE '%', result_text;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed)
-- ============================================================================
-- Run these commands if you need to undo this migration:
/*
BEGIN;

DROP INDEX IF EXISTS uq_users_email_lower;
DROP INDEX IF EXISTS uq_pending_registration_email;
DROP INDEX IF EXISTS idx_pending_registrations_expiry;
DROP INDEX IF EXISTS uq_active_registration_otp;
DROP INDEX IF EXISTS idx_registration_otps_registration_created;

ALTER TABLE public.pending_registrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_otps DISABLE ROW LEVEL SECURITY;

-- Note: Reverting CASCADE requires dropping and recreating FK without CASCADE
ALTER TABLE public.registration_otps
  DROP CONSTRAINT IF EXISTS registration_otps_registration_fkey;

ALTER TABLE public.registration_otps
  ADD CONSTRAINT registration_otps_registration_fkey
  FOREIGN KEY (registration_id)
  REFERENCES public.pending_registrations(id);

COMMIT;
*/
