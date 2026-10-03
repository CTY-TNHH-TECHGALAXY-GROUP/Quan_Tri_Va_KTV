-- Thêm cột handover_checklist vào bảng Rooms
ALTER TABLE "Rooms" ADD COLUMN IF NOT EXISTS handover_checklist JSONB DEFAULT '[]'::jsonb;

-- Cập nhật checklist cho từng phòng cụ thể
UPDATE "Rooms" 
SET handover_checklist = '["Ghế làm", "Lavabo kèm khăn lau tay sạch"]'::jsonb
WHERE id = 'T';

UPDATE "Rooms" 
SET handover_checklist = '["Máy lạnh", "Giường", "Đèn tinh dầu", "Đổ xô nước", "Thùng rác", "Khăn lau tay", "Tắt đèn"]'::jsonb
WHERE id = 'PG';

UPDATE "Rooms" 
SET handover_checklist = '["Máy lạnh", "Giường", "Thùng rác", "Đèn tinh dầu", "Tủ nóng", "Tắt đèn", "Đèn hành lang", "Toilet"]'::jsonb
WHERE id IN ('V1', 'V2', 'YUMI');

UPDATE "Rooms" 
SET handover_checklist = '["CB nước nóng", "Máy lạnh", "Giường", "Thùng rác", "Tủ nóng", "Đèn tinh dầu", "Đổ xô nước", "Tắt đèn", "Toilet"]'::jsonb
WHERE id = 'V3';

UPDATE "Rooms" 
SET handover_checklist = '["CB nước nóng", "Máy lạnh", "Giường", "Thùng rác", "Tủ nóng", "Đèn tinh dầu", "Tắt đèn", "Toilet"]'::jsonb
WHERE id = 'V4';

-- Cập nhật SystemConfigs cho luồng Bàn giao 2 lớp
INSERT INTO "SystemConfigs" (key, value, description)
VALUES 
    ('ktv_instant_reward_enabled', 'true', 'BẬT = Hiện tiền tua ngay khi xong. TẮT = Tiền tính ngầm, thông báo qua Push sau khi duyệt.'),
    ('ktv_handover_checklist_enabled', 'true', 'BẬT = KTV chụp theo checklist phòng. TẮT = Chụp tự do.'),
    ('ktv_handover_review_enabled', 'false', 'BẬT = Quầy phải duyệt ảnh bàn giao. TẮT = Bỏ qua lớp duyệt của Quầy.'),
    ('reception_auto_approve_minutes', '15', 'Thời gian (phút) Quầy không phản hồi sẽ tự động duyệt ảnh bàn giao.'),
    ('customer_rating_timeout_minutes', '30', 'Thời gian (phút) Khách không đánh giá sẽ tự động coi là PASS.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;
