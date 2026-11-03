-- FIX #7: Performance optimization - Add indexes for frequently queried columns
-- Migration: Add performance indexes
-- Date: 2026-11-03

-- Index for releaseExpiredSeats() - Scans seats table every 15 seconds
-- Optimizes query: WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW()
CREATE INDEX IF NOT EXISTS idx_seats_status_reserved_until 
ON seats (status, reserved_until) 
WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING');

-- Index for getSeatsByEvent() - Frequently called when viewing event details
CREATE INDEX IF NOT EXISTS idx_seats_event_id_status 
ON seats (event_id, status);

-- Index for user order lookups
CREATE INDEX IF NOT EXISTS idx_orders_user_id_status 
ON orders (user_id, status);

-- Index for order items joining
CREATE INDEX IF NOT EXISTS idx_order_items_order_code 
ON order_items (order_code);

-- Index for seat lookups by reserved_by
CREATE INDEX IF NOT EXISTS idx_seats_reserved_by 
ON seats (reserved_by) 
WHERE reserved_by IS NOT NULL;

-- Verify indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND (
    indexname LIKE 'idx_seats_%' 
    OR indexname LIKE 'idx_orders_%' 
    OR indexname LIKE 'idx_order_items_%'
)
ORDER BY tablename, indexname;

-- To apply this migration, run:
-- psql $DATABASE_URL -f migrations/add_performance_indexes.sql
