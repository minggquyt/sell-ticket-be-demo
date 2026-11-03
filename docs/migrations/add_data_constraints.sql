-- FIX #8: Data integrity - Add NOT NULL constraints for required fields
-- Migration: Add constraints for phone and citizen_id
-- Date: 2026-11-03

-- IMPORTANT: Before running this migration, ensure all existing orders have phone and citizen_id
-- You can check with:
-- SELECT COUNT(*) FROM orders WHERE phone IS NULL OR citizen_id IS NULL;

-- If there are NULL values, update them first:
-- UPDATE orders SET phone = '0000000000' WHERE phone IS NULL;
-- UPDATE orders SET citizen_id = '000000000000' WHERE citizen_id IS NULL;

-- Add NOT NULL constraints
ALTER TABLE orders 
ALTER COLUMN phone SET NOT NULL;

ALTER TABLE orders 
ALTER COLUMN citizen_id SET NOT NULL;

-- Add check constraints for format validation
ALTER TABLE orders
ADD CONSTRAINT chk_phone_format 
CHECK (phone ~ '^(0|\+84)\d{9,10}$');

ALTER TABLE orders
ADD CONSTRAINT chk_citizen_id_format 
CHECK (citizen_id ~ '^\d{12}$');

-- Verify constraints
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
AND conname LIKE 'chk_%';

-- To apply this migration, run:
-- psql $DATABASE_URL -f migrations/add_data_constraints.sql
