-- ============================================================
-- 🔒 ENABLE ROW LEVEL SECURITY (RLS) FOR ALL PUBLIC TABLES
-- Project: DataNganHa (adzfohfdindovfcpaizb)
-- Date: 2026-03-25
-- Reason: Supabase security alert — tables publicly accessible
--
-- ⚠️ STRATEGY:
-- Vì app dùng SUPABASE_SERVICE_ROLE_KEY ở server-side (Next.js API routes),
-- service_role KEY sẽ BYPASS RLS hoàn toàn → server code hoạt động bình thường.
-- Chỉ cần block anon key truy cập trực tiếp từ browser.
--
-- Nếu cần client-side access (Realtime), thêm policy SELECT cho anon.
-- ============================================================

-- ============================================
-- BƯỚC 1: BẬT RLS TRÊN TẤT CẢ CÁC BẢNG
-- ============================================

ALTER TABLE public."Bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BookingItems" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TurnQueue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."KTVAttendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StaffNotifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SystemConfigs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Beds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StaffPushSubscriptions" ENABLE ROW LEVEL SECURITY;

-- Nếu đã tạo bảng RegisteredDevices
ALTER TABLE IF EXISTS public."RegisteredDevices" ENABLE ROW LEVEL SECURITY;

-- Nếu đã tạo bảng ServiceExtendConfig
ALTER TABLE IF EXISTS public."ServiceExtendConfig" ENABLE ROW LEVEL SECURITY;


-- ============================================
-- BƯỚC 2: POLICIES CHO REALTIME (SELECT anon)
-- App dùng Supabase Realtime ở client → cần cho phép SELECT
-- với anon key cho các bảng cần subscribe.
-- ============================================

-- Bookings: Realtime cho KTV Dashboard + Dispatch Board
CREATE POLICY "Allow anon read Bookings" ON public."Bookings"
  FOR SELECT USING (true);

-- BookingItems: Realtime cho KTV Dashboard
CREATE POLICY "Allow anon read BookingItems" ON public."BookingItems"
  FOR SELECT USING (true);

-- TurnQueue: Realtime cho Dispatch Board + KTV page
CREATE POLICY "Allow anon read TurnQueue" ON public."TurnQueue"
  FOR SELECT USING (true);

-- StaffNotifications: Realtime cho toast notifications
CREATE POLICY "Allow anon read StaffNotifications" ON public."StaffNotifications"
  FOR SELECT USING (true);

-- Services: Menu display (read-only, public data)
CREATE POLICY "Allow anon read Services" ON public."Services"
  FOR SELECT USING (true);

-- Staff: KTV info display
CREATE POLICY "Allow anon read Staff" ON public."Staff"
  FOR SELECT USING (true);

-- Rooms + Beds: Room assignment display
CREATE POLICY "Allow anon read Rooms" ON public."Rooms"
  FOR SELECT USING (true);

CREATE POLICY "Allow anon read Beds" ON public."Beds"
  FOR SELECT USING (true);

-- SystemConfigs: App configuration (read-only)
CREATE POLICY "Allow anon read SystemConfigs" ON public."SystemConfigs"
  FOR SELECT USING (true);


-- ============================================
-- BƯỚC 3: BLOCK WRITE (INSERT/UPDATE/DELETE) TỪ ANON
-- Mặc định: RLS bật → không có policy = BLOCK hết.
-- Chỉ service_role (server-side) mới write được.
-- Các bảng KHÔNG có SELECT policy = hoàn toàn private.
-- ============================================

-- Users: ❌ NO anon access (passwords, sensitive)
-- Customers: ❌ NO anon access (PII data)
-- KTVAttendance: ❌ NO anon access (internal HR)
-- StaffPushSubscriptions: ❌ NO anon access (tokens)
-- RegisteredDevices: ❌ NO anon access (device management)


-- ============================================
-- XONG! Kiểm tra lại bằng Supabase Dashboard:
-- Database → Tables → chọn bảng → "RLS enabled" badge
-- ============================================
