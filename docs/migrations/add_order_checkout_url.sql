-- Migration: Lưu link thanh toán PayOS (checkout_url) bền vững trên bảng orders
-- Date: 2026-11-18
-- Cột NULLABLE -> an toàn, tương thích ngược hoàn toàn với dữ liệu/đơn hàng cũ.
-- Apply: psql $DATABASE_URL -f docs/migrations/add_order_checkout_url.sql

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_url text;

-- Rollback:
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS checkout_url;
