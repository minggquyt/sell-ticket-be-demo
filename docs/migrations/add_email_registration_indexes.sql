-- Add performance and uniqueness indexes for email registration tables.
-- Apply after add_email_registration_otp.sql and add_registration_cancelled_status.sql
-- Apply: psql "$DATABASE_URL" -f docs/migrations/add_email_registration_indexes.sql

BEGIN;

-- Case-insensitive unique email for users (prevent duplicate registrations)
-- Check for conflicts before creating
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users
    GROUP BY lower(email)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add case-insensitive email uniqueness: duplicate users exist after lower(email).';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON public.users (lower(email));

-- Case-insensitive unique email for pending registrations (one pending per email)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_registration_email
  ON public.pending_registrations (lower(email))
  WHERE status = 'PENDING';

-- Performance index for expiry cleanup queries
CREATE INDEX IF NOT EXISTS idx_pending_registrations_expiry
  ON public.pending_registrations (expires_at)
  WHERE status = 'PENDING';

-- Ensure only one active OTP per registration
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_registration_otp
  ON public.registration_otps (registration_id)
  WHERE status = 'PENDING';

-- Performance index for OTP history queries
CREATE INDEX IF NOT EXISTS idx_registration_otps_registration_created
  ON public.registration_otps (registration_id, created_at DESC);

-- Enable Row Level Security to prevent client direct access to password hashes and OTP data
ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_otps ENABLE ROW LEVEL SECURITY;

-- Add CASCADE delete for OTPs when registration is deleted (cleanup)
-- Note: This requires dropping and recreating the foreign key
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

ALTER TABLE public.registration_otps
  ADD CONSTRAINT registration_otps_registration_fkey
  FOREIGN KEY (registration_id)
  REFERENCES public.pending_registrations(id)
  ON DELETE CASCADE;

COMMIT;

-- Rollback notes:
-- DROP INDEX IF EXISTS uq_users_email_lower;
-- DROP INDEX IF EXISTS uq_pending_registration_email;
-- DROP INDEX IF EXISTS idx_pending_registrations_expiry;
-- DROP INDEX IF EXISTS uq_active_registration_otp;
-- DROP INDEX IF EXISTS idx_registration_otps_registration_created;
-- ALTER TABLE public.pending_registrations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.registration_otps DISABLE ROW LEVEL SECURITY;
