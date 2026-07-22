-- Migration: Insert cấu hình Bonus theo Ca vào SystemConfigs
-- Ngày: 2026-05-15
-- Mục đích: Thêm 3 dòng config cho điểm thưởng KTV theo ca làm việc
--           + tỷ lệ quy đổi điểm → VNĐ
-- Lưu ý: Dùng ON CONFLICT DO NOTHING để tránh lỗi nếu đã tồn tại

-- 1. Điểm thưởng Ca 1 (mặc định 20 điểm)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('ktv_shift_1_bonus', '20', 'Điểm thưởng bonus cho KTV ca 1 (mỗi đơn rating ≥ 4★)')
ON CONFLICT (key) DO NOTHING;

-- 2. Điểm thưởng Ca 2 (mặc định 20 điểm)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('ktv_shift_2_bonus', '20', 'Điểm thưởng bonus cho KTV ca 2 (mỗi đơn rating ≥ 4★)')
ON CONFLICT (key) DO NOTHING;

-- 3. Điểm thưởng Ca 3 - Đặc quyền ca đêm (mặc định 40 điểm)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('ktv_shift_3_bonus', '40', 'Điểm thưởng bonus cho KTV ca 3 - ca đêm (mỗi đơn rating ≥ 4★)')
ON CONFLICT (key) DO NOTHING;

-- 3. Tỷ lệ quy đổi điểm → VNĐ (1 điểm = 1000 VNĐ)
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('ktv_bonus_rate', '1000', 'Tỷ lệ quy đổi 1 điểm bonus = bao nhiêu VNĐ')
ON CONFLICT (key) DO NOTHING;
