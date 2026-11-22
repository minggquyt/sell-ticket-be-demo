-- Migration: Lưu dữ liệu thanh toán VietQR/PayOS (qrCode, bin, accountNumber, ...) trên bảng orders
-- Cột NULLABLE -> tương thích ngược hoàn toàn với dữ liệu cũ, không lock bảng khi thêm.
-- Apply: psql "$DATABASE_URL" -f docs/migrations/add_order_payment_info.sql

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_info jsonb;

-- Rollback:
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_info;
