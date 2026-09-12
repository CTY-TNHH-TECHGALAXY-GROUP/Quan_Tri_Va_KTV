-- Thêm các phòng phụ trợ mới
INSERT INTO "public"."Rooms" (id, name, "type")
VALUES 
  ('WC1', 'Nhà vệ sinh Lầu 1', 'SUPPORT_AREA'),
  ('WC2', 'Nhà vệ sinh Lầu 2', 'SUPPORT_AREA'),
  ('BATH_L1', 'Nhà tắm Lầu 1', 'SUPPORT_AREA')
ON CONFLICT (id) DO NOTHING;

DO $$ 
DECLARE 
  cat_prep uuid := gen_random_uuid();
  cat_ongoing uuid := gen_random_uuid();
  cat_closing uuid := gen_random_uuid();
  cat_weekly uuid := gen_random_uuid();
  cat_daily uuid := gen_random_uuid();
  
  tpl_uuid uuid;
BEGIN
  -- Xoá toàn bộ dữ liệu cũ để tránh trùng lặp khi chạy lại nhiều lần
  DELETE FROM "public"."RoomTaskTemplates";
  DELETE FROM "public"."EmployeeRoutines";
  DELETE FROM "public"."TaskTemplates";
  DELETE FROM "public"."TaskCategories";

  -- 1. Insert Categories
  INSERT INTO "public"."TaskCategories" (id, name, type, is_active)
  VALUES 
    (cat_prep, '1. CHUẨN BỊ TRƯỚC GIỜ MỞ CỬA (Trước 09:00)', 'ROLE', true),
    (cat_ongoing, '2. CÔNG VIỆC TỪ 09:00 TRỞ ĐI', 'ROLE', true),
    (cat_closing, '3. BÀN GIAO KẾT CA (18:00)', 'ROLE', true),
    (cat_weekly, '4. CÔNG VIỆC ĐỊNH KỲ THEO TUẦN', 'ROLE', true),
    (cat_daily, 'CÔNG VIỆC HẰNG NGÀY', 'ROOM', true);

  -- 2. Insert ROLE Tasks
  -- CHUẨN BỊ TRƯỚC GIỜ MỞ CỬA
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active) VALUES
    (cat_prep, 'Sân Ngoài: Quét dọn rác; lau sạch và setup bàn ghế', true, 1, true),
    (cat_prep, 'Sân Ngoài: Lau và đặt menu đứng, menu lật ngay ngắn', true, 1, true),
    (cat_prep, 'Sân Ngoài: Sắp xếp xe quầy gọn gàng, đúng mẫu', true, 1, true),
    (cat_prep, 'Sân Ngoài: Setup kệ dép gọn gàng theo ngăn cỡ', true, 1, true),
    (cat_prep, 'Phòng Gội: Chuẩn bị nồi xông thảo dược đầu ca', true, 1, true),
    (cat_prep, 'Phòng Gội: Ghim tủ nóng, sắp xếp lại đá/túi cổ gọn gàng', true, 1, true),
    (cat_prep, 'Phòng Gội: Bật đèn tủ trưng bày', false, 1, true),
    (cat_prep, 'Phòng Gội: Mở CB nước nóng', false, 1, true),
    (cat_prep, 'Phòng Gội: Châm đầy bình thủy nước nóng', true, 1, true),
    (cat_prep, 'Sảnh: Mở máy lạnh sảnh', false, 1, true),
    (cat_prep, 'Sảnh: Bật đèn sảnh và bảng hiệu (3 công tắc to)', false, 1, true);

  -- CÔNG VIỆC TỪ 09:00 TRỞ ĐI
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active) VALUES
    (cat_ongoing, 'Điểm danh đầu ca (09:00) trên ứng dụng', true, 1, true),
    (cat_ongoing, 'Mở nhạc lầu 1', false, 1, true),
    (cat_ongoing, 'Ghim máy tinh dầu ở vệ sinh và mở đèn', false, 1, true),
    (cat_ongoing, 'Trệt: Lau dọn bàn thờ Ông Địa, thay nước cúng', true, 1, true),
    (cat_ongoing, 'Trệt: Lau sạch toàn bộ bàn và ghế ở sảnh', true, 1, true),
    (cat_ongoing, 'Trệt: Hút bụi toàn bộ sàn sảnh và lau sảnh', true, 1, true),
    (cat_ongoing, 'Trệt: Kiểm tra, phân loại đồ cũ/hết hạn trong tủ lạnh', true, 1, true),
    (cat_ongoing, 'Trệt: Lau sạch cửa kính lớn ở sảnh', true, 1, true),
    (cat_ongoing, 'Trệt: Lau sạch gương tại vị trí 2 ghế cắt tóc', true, 1, true),
    (cat_ongoing, 'Trệt: Sắp xếp gọn khu vực uống nước, vệ sinh ly dơ', true, 1, true),
    (cat_ongoing, 'Kho: Sắp xếp và báo cáo số lượng vật dụng', true, 1, true),
    (cat_ongoing, 'Duy Trì: Kiểm tra và thay khăn lau tay nếu ướt', false, 1, true),
    (cat_ongoing, 'Duy Trì: Kiểm tra và chăm nước nồi xông (không để cạn)', false, 1, true),
    (cat_ongoing, 'Duy Trì: Đảm bảo cửa kính sảnh luôn sáng bóng', false, 1, true),
    (cat_ongoing, 'Duy Trì: Nhắc người canh tua chăm bình thuỷ', false, 1, true),
    (cat_ongoing, 'Duy Trì: Giữ khu vực sân ngoài sạch sẽ', false, 1, true),
    (cat_ongoing, 'Duy Trì: Giữ kệ dép khách ngay ngắn', false, 1, true),
    (cat_ongoing, '[15:00] Quay mái hiên sân ngoài vào (trừ trời mưa)', true, 1, true);

  -- BÀN GIAO KẾT CA (18:00)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active) VALUES
    (cat_closing, 'Dọn dẹp Sân ngoài: Quét sạch toàn bộ rác', true, 1, true),
    (cat_closing, 'Làm gọn xe quầy: Sắp xếp đồ đạc gọn gàng, ngăn nắp', true, 1, true),
    (cat_closing, 'Dọn dẹp Sảnh: Sắp xếp lại quầy, sảnh gọn gàng sạch sẽ', true, 1, true),
    (cat_closing, 'Bàn giao dụng cụ quét sân (chổi cứng, mềm, ki hốt)', true, 1, true);

  -- CÔNG VIỆC ĐỊNH KỲ THEO TUẦN
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active) VALUES
    (cat_weekly, '[Thứ 2] Thay dép khách theo 3 kích cỡ (nhỏ, vừa, lớn)', true, 1, true),
    (cat_weekly, '[Thứ 2] Kiểm tra & vệ sinh máy xông mặt, rổ facial', true, 1, true),
    (cat_weekly, '[Thứ 2, Thứ 6] Thay khăn trải & áo gối ở các phòng DV', true, 1, true),
    (cat_weekly, '[Thứ 4, Chủ Nhật] Thay áo gối ở sảnh (cả ghế tóc)', true, 1, true);


  -- ==========================================
  -- 3. Insert ROOM Tasks (Ma Trận Phòng)
  -- Sử dụng RETURNING để map chính xác từng loại phòng
  -- ==========================================
  
  -- Task: Gom đồ dơ (Full phòng dịch vụ + Vệ sinh)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Gom đồ dơ dọn dẹp sạch sẽ', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Đảm bảo đèn tinh dầu luôn sạch (Full trừ sảnh)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo đèn tinh dầu luôn sạch sẽ', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Đảm bảo móc treo quần áo (Full trừ sảnh)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo móc treo quần áo', false, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Đảm bảo đủ số lượng giỏ đựng đồ khách (Full trừ sảnh)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo đủ số lượng giỏ đựng đồ khách', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo tủ đồ khách gọn gàng, đầy đủ', false, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Làm sạch tóc bồn gội (PG, V3, V4)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Làm sạch tóc khu vực bồn gội đầu', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4');

  -- Task: Bột rửa chân (PG)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo luôn có bột rửa chân', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id = 'PG';

  -- Task: Đảm bảo nước rửa tay (PG, WC1, WC2, V4)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo có đủ nước rửa tay', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V4', 'WC1', 'WC2');

  -- Task: Đầy đủ giấy khô, ướt, khẩu trang, cồn (Full)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Bổ sung giấy khô, giấy ướt, khẩu trang, cồn', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Đủ máy sấy (PG, V3, V4)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo đủ số lượng máy sấy tóc', false, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4');

  -- Task: Đủ khăn tắm 3 cái (BATH_L1, WC2)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Xếp đủ khăn tắm (ít nhất 3 cái gọn gàng)', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('BATH_L1', 'WC2');

  -- Task: Nhà vệ sinh khô ráo, gọn gàng (WC1, WC2)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đảm bảo sàn khô ráo, không gian gọn gàng', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('WC1', 'WC2');

  -- Task: Giấy toilet đầy đủ (WC1, WC2)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Bổ sung đầy đủ giấy vệ sinh', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('WC1', 'WC2');

  -- Task: Khăn lau tay sạch, khô ráo (Full)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Kiểm tra và thay khăn lau tay sạch sẽ', false, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Thùng rác không dơ, không mùi (Full)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Đổ rác, đảm bảo thùng rác sạch và không có mùi', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Kính sạch không ố dơ (Full)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Lau kính, đảm bảo sạch sẽ không vết ố', true, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

  -- Task: Thảm sạch không bị dơ (Full)
  INSERT INTO "public"."TaskTemplates" (category_id, name, requires_photo, min_photo_count, is_active)
  VALUES (cat_daily, 'Kiểm tra thảm trải sàn, hút bụi/lau dọn nếu dơ', false, 1, true) RETURNING id INTO tpl_uuid;
  INSERT INTO "public"."RoomTaskTemplates" (room_id, template_id) SELECT id, tpl_uuid FROM "public"."Rooms" WHERE id IN ('PG', 'V3', 'V4', 'WC1', 'WC2', 'BATH_L1');

END $$;
