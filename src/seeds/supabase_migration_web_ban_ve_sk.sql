-- ============================================================================
-- Migration: Web Bán vé SK - BCN - Version Singapore
-- Nguồn: project Supabase rzzuttlgxpnkzhtjcmsb
--   https://rzzuttlgxpnkzhtjcmsb.supabase.co
--   Khu vực: Southeast Asia (Singapore), trạng thái lúc kiểm tra: Healthy
-- Kiểm chứng: Table Editor + SELECT chỉ đọc từ information_schema/pg_catalog
--   trong SQL Editor, ở chế độ chỉ đọc, không sửa/xóa bảng hay dữ liệu nào.
--
-- PHẠM VI FILE NÀY
--   - Chỉ tái tạo schema public của ứng dụng: 7 bảng, 50 cột, 4 enum,
--     1 sequence (orders_order_code_seq), 6 foreign key, 6 index thường.
--   - KHÔNG tái tạo dữ liệu trong bảng, KHÔNG tái tạo các schema hệ thống
--     do Supabase tự tạo (auth 27 bảng, realtime 8 bảng, storage 8 bảng,
--     vault 1 bảng) — project Supabase mới nào cũng đã có sẵn các schema đó.
--   - KHÔNG có policy, trigger, function hay CHECK constraint riêng ở public
--     trong bản gốc, nên file này cũng không tạo thêm.
-- ============================================================================

-- 0. Extension cho gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. ENUMS — phải tạo TRƯỚC các bảng dùng chúng
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE event_type_enum AS ENUM ('SEAT_BASED', 'ZONE_BASED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('PAYMENT_PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE seat_status AS ENUM ('AVAILABLE', 'RESERVED', 'PAYMENT_PROCESSING', 'SOLD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('CUSTOMER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. SEQUENCE & BẢNG — thứ tự an toàn theo FK:
--    categories, cities, users, events, orders, seats, order_items
--    (seats phụ thuộc orders qua current_order_code,
--     order_items phụ thuộc orders qua order_code và seats qua seat_id)
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.orders_order_code_seq START WITH 100000001;

-- 2.1 categories (3 cột)
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 2.2 cities (3 cột)
CREATE TABLE IF NOT EXISTS public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 2.3 users — bảng ứng dụng riêng, KHÔNG phải auth.users (7 cột)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar NOT NULL UNIQUE,
  full_name varchar NOT NULL,
  password varchar NOT NULL,
  created_at timestamptz DEFAULT now(),
  role user_role DEFAULT 'CUSTOMER',
  avatar text
);

-- 2.4 events (17 cột)
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar NOT NULL,
  description text,
  location varchar,
  start_time timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  event_type event_type_enum DEFAULT 'SEAT_BASED',
  thumbnails text[] DEFAULT '{}'::text[],
  category varchar(255),
  "time" varchar(100),
  min_price numeric(12,2) DEFAULT 0,
  max_price numeric(12,2) DEFAULT 0,
  image text,
  banner text,
  organizer varchar(255),
  highlights jsonb,
  rules jsonb
);

-- 2.5 orders (6 cột - dùng order_code 9 chữ số từ sequence làm PRIMARY KEY)
CREATE TABLE IF NOT EXISTS public.orders (
  order_code bigint PRIMARY KEY DEFAULT nextval('public.orders_order_code_seq'),
  user_id uuid NOT NULL REFERENCES public.users(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  total_amount numeric NOT NULL,
  status order_status DEFAULT 'PAYMENT_PROCESSING',
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER SEQUENCE public.orders_order_code_seq OWNED BY public.orders.order_code;

-- 2.6 seats (10 cột)
CREATE TABLE IF NOT EXISTS public.seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  seat_number varchar NOT NULL,
  price numeric NOT NULL,
  status seat_status DEFAULT 'AVAILABLE',
  reserved_by uuid,
  reserved_until timestamptz,
  created_at timestamptz DEFAULT now(),
  current_order_code bigint REFERENCES public.orders(order_code) ON UPDATE NO ACTION ON DELETE SET NULL,
  zone_name varchar DEFAULT 'STANDARD',
  CONSTRAINT seats_locked_by_fkey
    FOREIGN KEY (reserved_by) REFERENCES public.users(id)
    ON UPDATE NO ACTION ON DELETE SET NULL
);

-- 2.7 order_items (4 cột)
CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code bigint NOT NULL REFERENCES public.orders(order_code) ON UPDATE NO ACTION ON DELETE CASCADE,
  seat_id uuid NOT NULL REFERENCES public.seats(id) ON UPDATE NO ACTION ON DELETE CASCADE,
  price numeric NOT NULL
);

-- ============================================================================
-- 3. INDEX THƯỜNG
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_seats_current_order_code ON public.seats (current_order_code);
CREATE INDEX IF NOT EXISTS idx_seats_event_status ON public.seats (event_id, status);
CREATE INDEX IF NOT EXISTS idx_seats_reserved_by ON public.seats (reserved_by);
CREATE INDEX IF NOT EXISTS idx_seats_reserved_until ON public.seats (reserved_until);
CREATE INDEX IF NOT EXISTS idx_seats_zone_status ON public.seats (event_id, zone_name, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_code ON public.order_items (order_code);

-- ============================================================================
-- 4. RLS — giữ đúng bản gốc: TẮT ở cả 7 bảng, 0 policy.
-- ============================================================================

ALTER TABLE public.categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.seats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items DISABLE ROW LEVEL SECURITY;
