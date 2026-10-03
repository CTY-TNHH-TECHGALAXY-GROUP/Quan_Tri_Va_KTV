-- Thêm cột xác nhận vào StaffNotifications
ALTER TABLE "StaffNotifications"
ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "acknowledgedNote" TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'STAFF';
-- source: 'STAFF' (từ KTV), 'CUSTOMER' (từ khách - dùng ở Phase 2)

COMMENT ON COLUMN "StaffNotifications"."acknowledgedAt" IS 'Thời điểm Quầy xác nhận đã xử lý';
COMMENT ON COLUMN "StaffNotifications"."acknowledgedNote" IS 'Ghi chú từ Quầy khi xác nhận (VD: Đang mang nước lên)';
COMMENT ON COLUMN "StaffNotifications"."source" IS 'Nguồn: STAFF (KTV gửi) hoặc CUSTOMER (khách gửi)';
