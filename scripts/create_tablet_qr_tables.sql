-- ===========================================
-- Bảng 1: RegisteredDevices (Device Whitelist)
-- Dùng để nhận biết Tablet sảnh
-- ===========================================
CREATE TABLE IF NOT EXISTS "RegisteredDevices" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  device_name TEXT NOT NULL DEFAULT 'Tablet',
  device_type TEXT DEFAULT 'tablet',
  is_active BOOLEAN DEFAULT true,
  registered_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE "RegisteredDevices" ENABLE ROW LEVEL SECURITY;

-- Allow read access for anon (check device on client-side)
CREATE POLICY "Allow read RegisteredDevices" ON "RegisteredDevices"
  FOR SELECT USING (true);

-- Allow insert for authenticated or service_role
CREATE POLICY "Allow insert RegisteredDevices" ON "RegisteredDevices"
  FOR INSERT WITH CHECK (true);


-- ===========================================
-- Bảng 2: ServiceExtendConfig (Giá mua thêm giờ)
-- ===========================================
CREATE TABLE IF NOT EXISTS "ServiceExtendConfig" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extra_minutes INT NOT NULL,
  price INT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0
);

-- Enable RLS
ALTER TABLE "ServiceExtendConfig" ENABLE ROW LEVEL SECURITY;

-- Allow read for everyone
CREATE POLICY "Allow read ServiceExtendConfig" ON "ServiceExtendConfig"
  FOR SELECT USING (true);

-- Insert default data
INSERT INTO "ServiceExtendConfig" (extra_minutes, price, sort_order) VALUES
  (30, 200000, 1),
  (45, 280000, 2),
  (60, 350000, 3);
