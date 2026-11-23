-- Add explicit cancellation state for pending email OTP registrations.
-- Apply: psql "$DATABASE_URL" -f docs/migrations/add_registration_cancelled_status.sql

BEGIN;

ALTER TABLE public.pending_registrations
  DROP CONSTRAINT IF EXISTS pending_registrations_status_check;

ALTER TABLE public.pending_registrations
  ADD CONSTRAINT pending_registrations_status_check
  CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED'));

COMMIT;

-- Rollback is only safe after ensuring no row has status CANCELLED.