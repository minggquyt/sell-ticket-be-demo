-- Migration: Thông tin ngân hàng User + Hoàn tiền thủ công qua VietQR (bản 0đ)
-- Date: 2026-11-10
-- Tất cả cột đều NULLABLE -> không ảnh hưởng dữ liệu/luồng cũ.
-- Apply: psql $DATABASE_URL -f docs/migrations/add_manual_refund_vietqr.sql

-- 1. users: thông tin ngân hàng nhận hoàn tiền (optional, cập nhật ở Trang Hồ sơ)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bank_bin varchar(6),
  ADD COLUMN IF NOT EXISTS bank_short_name varchar(100),
  ADD COLUMN IF NOT EXISTS bank_name varchar(255),
  ADD COLUMN IF NOT EXISTS bank_logo text,
  ADD COLUMN IF NOT EXISTS bank_account_no varchar(25),
  ADD COLUMN IF NOT EXISTS bank_account_name varchar(100);

-- 2. orders: cờ "Sai TT ngân hàng" (NULL = không lỗi) + snapshot bằng chứng đối soát khi đã hoàn
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refund_bank_error varchar(255),
  ADD COLUMN IF NOT EXISTS refund_snapshot jsonb;

-- 3. Lưới an toàn ở tầng DB (app đã validate, DB chặn lần cuối)
DO $$ BEGIN
  ALTER TABLE public.users ADD CONSTRAINT chk_bank_bin_format
    CHECK (bank_bin ~ '^\d{6}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.users ADD CONSTRAINT chk_bank_account_no_format
    CHECK (bank_account_no ~ '^[A-Za-z0-9]{6,25}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rollback:
-- ALTER TABLE public.users DROP CONSTRAINT IF EXISTS chk_bank_bin_format, DROP CONSTRAINT IF EXISTS chk_bank_account_no_format,
--   DROP COLUMN IF EXISTS bank_bin, DROP COLUMN IF EXISTS bank_short_name, DROP COLUMN IF EXISTS bank_name,
--   DROP COLUMN IF EXISTS bank_logo, DROP COLUMN IF EXISTS bank_account_no, DROP COLUMN IF EXISTS bank_account_name;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS refund_bank_error, DROP COLUMN IF EXISTS refund_snapshot;
