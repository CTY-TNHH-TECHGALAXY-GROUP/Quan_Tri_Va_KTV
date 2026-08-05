-- =====================================================
-- Migration: Handover V5 & Internal Reviews
-- Plan: plan_handover_review_v5.md
-- Date: 2026-07-27
-- 
-- DEPENDS ON: 20260722000007_booking_handover_fields.sql
-- (Đã có sẵn: handover_images, handover_status, handover_comment)
-- =====================================================

-- =====================================================
-- 1. BỔ SUNG CỘT MỚI CHO BookingItems
-- =====================================================

-- Cờ đánh dấu KTV đã bỏ qua bàn giao (nợ ảnh)
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS handover_skipped BOOLEAN DEFAULT false;

-- Hành động từ chối của Quầy (REDO / DEDUCT / CONFISCATE)
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS handover_reject_action TEXT;

-- Đếm số lần bị reject Option 1 (dọn lại) - Tối đa 2 lần
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS handover_reject_count INTEGER DEFAULT 0;

-- Cờ giam tiền tua (Option 3 hoặc trốn bàn giao khi tan ca)
ALTER TABLE "BookingItems" ADD COLUMN IF NOT EXISTS commission_locked BOOLEAN DEFAULT false;

-- Cập nhật CHECK constraint cho handover_status (thêm SKIPPED)
ALTER TABLE "BookingItems" DROP CONSTRAINT IF EXISTS "BookingItems_handover_status_check";
ALTER TABLE "BookingItems" ADD CONSTRAINT "BookingItems_handover_status_check" 
  CHECK (handover_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'));

-- =====================================================
-- 2. TẠO BẢNG InternalReviews (Đánh giá nội bộ 2 chiều)
-- =====================================================

CREATE TABLE IF NOT EXISTS "InternalReviews" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES "Bookings"(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL,         -- ID/Code người đánh giá (VD: NH025, RECEPTION_01)
    reviewer_role TEXT NOT NULL,       -- 'RECEPTION' | 'KTV'
    target_id TEXT NOT NULL,           -- ID/Code người bị đánh giá
    target_role TEXT NOT NULL,         -- 'RECEPTION' | 'KTV'
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Mỗi người chỉ đánh giá người kia 1 lần / 1 đơn (Lỗ hổng #9)
    CONSTRAINT unique_review_per_booking UNIQUE(booking_id, reviewer_id, target_id)
);

-- Index để query nhanh lịch sử đánh giá theo KTV hoặc Lễ tân
CREATE INDEX IF NOT EXISTS idx_internal_reviews_target ON "InternalReviews"(target_id, target_role);
CREATE INDEX IF NOT EXISTS idx_internal_reviews_booking ON "InternalReviews"(booking_id);

-- =====================================================
-- 3. THÊM SYSTEM CONFIGS
-- =====================================================

INSERT INTO "SystemConfigs" (key, value, description) VALUES
    ('handover_service_mapping', '{
        "GOI_DAU": {
            "items": ["Máy nước nóng", "Bồn gội đầu"],
            "apply_categories": ["Hair Wash"],
            "apply_services": ["NHS0607", "NHS0705", "NHS0706"]
        },
        "FACIAL": {
            "items": ["Ống hút mụn", "Máy Facial"],
            "apply_categories": ["Facial"],
            "apply_services": ["NHS0607"]
        },
        "BAO_GOT": {
            "items": ["Đồ nghề chà gót", "Chà gót chân"],
            "apply_categories": ["Heel Skin Shave"],
            "apply_services": ["NHS0706"]
        }
    }', 'Mapping checklist bàn giao theo Category/Mã dịch vụ. Quản lý có thể chỉnh sửa.'),
    ('handover_deduction_amount', '50000', 'Số tiền phạt khi Quầy chọn Option 2 (Trừ tiền). Đơn vị: VNĐ.'),
    ('max_handover_skip', '2', 'Số đơn tối đa KTV được phép nợ bàn giao trước khi bắt buộc phải nộp.'),
    ('max_handover_reject', '2', 'Số lần tối đa Quầy được bắt dọn lại (Option 1) cho 1 đơn.'),
    ('storage_cleanup_days', '3', 'Số ngày giữ ảnh bàn giao/check-in trước khi tự động xóa. Đơn tranh chấp sẽ không bị xóa.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;
