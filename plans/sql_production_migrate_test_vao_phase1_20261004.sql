-- =====================================================================================
-- PRODUCTION — Migrate DB cho bản merge test/sequential-two-slot-handoff-20260928 + phase1
-- Ngày soạn: 04/10/2026. Gồm 35 migration mà production (origin/main) CHƯA có:
--   PHẦN 1: 29 migration đơn nối tiếp / điều phối (20260925120000 … 20261002100000)
--   PHẦN 2:  4 migration thang sao 4/5          (20261002110000 … 20261003091000)
--   PHẦN 3:  1 migration thông báo FEEDBACK cho quầy + admin (20261004100000)
--   PHẦN 4:  1 migration giới hạn ràng buộc phân công từ ngày 04/10/2026 (20261004110000)
--
-- KHÔNG ĐỤNG DỮ LIỆU QUÁ KHỨ (quyết định 04/10/2026): bản production thêm điều kiện
--   business_date >= 2026-10-04 (Bookings.bookingDate cho technicianCodes) vào: bước kiểm tra [0],
--   ràng buộc chống trùng giờ, trigger kiểm giờ phân công, 2 lệnh sửa dữ liệu (segment_id, technicianCodes).
--   Các chỗ đó có ghi chú '-- PROD 04/10'. Phân công cũ còn ACTIVE/QUEUED/READY được để nguyên.
-- Đối chiếu: 35/35 migration có mặt; nguyên văn trừ các dòng ghi '-- PROD 04/10'.
--
-- KHÔNG đụng pg_cron / Vercel cron: không có cron.schedule / cron.unschedule nào.
-- Mọi DELETE trong file đều nằm TRONG thân hàm (chạy khi RPC được gọi), không xoá dữ liệu lúc chạy file.
-- Bản code phase1 + chặng 2 (plan_chang2_phai_bam_bat_dau_20261004) KHÔNG cần migration riêng.
--
-- CÁCH CHẠY: Supabase Dashboard (project PRODUCTION) → SQL Editor → dán cả file → Run.
-- Mỗi phần là 1 transaction (phần 1, 2 có bước kiểm tra trước [0]); phần trước lỗi thì dừng, KHÔNG chạy phần sau.
-- Chạy ngay trước khi promote bản deploy main mới, ngoài giờ cao điểm (trigger mới có hiệu lực ngay).
-- =====================================================================================

-- #####################################################################################
-- PHẦN 1/4 — ĐƠN NỐI TIẾP + ĐIỀU PHỐI (29 migration)
-- #####################################################################################
-- =====================================================================================
-- PRODUCTION — Đơn nối tiếp (sequential 2 slot) + điều phối: 29 migration
-- Ngày soạn: 04/10/2026 · Nguồn: nhánh test/sequential-two-slot-handoff-20260928
-- Đây là các migration CÓ trên nhánh test nhưng CHƯA có trên feat/bit-lo-hong-phase1 / main,
-- từ 20260925120000 tới 20261002100000 (đã chạy đủ, đúng tên trên TEST eknggruuiuadwldacpmb).
-- Phần thang sao (4 migration 20261002110000…20261003091000) nằm ở file riêng:
--   plans/sql_production_thang_sao_20261004.sql  → chạy SAU file này.
--
-- CHẠY KHI NÀO: cùng lúc merge code nhánh test vào phase1 → main. Code cũ (main hiện tại) không
-- gọi các RPC mới, nhưng trigger mới (guard_sequential_item_update, keep_dispatch_edit_history,
-- sync_unstarted_dispatch_plan, chống trùng giờ KtvAssignments) có hiệu lực ngay khi chạy SQL.
-- → Khuyến nghị: chạy SQL ngay trước khi promote bản deploy main mới, ngoài giờ cao điểm.
--
-- CÁCH CHẠY: Supabase Dashboard (project PRODUCTION) → SQL Editor → dán cả file → Run.
-- Cả file là 1 transaction: lỗi ở đâu thì không có gì được ghi.
-- =====================================================================================

-- [0] Kiểm tra trước — dừng nếu không đúng DB hoặc dữ liệu sẽ làm hỏng ràng buộc chống trùng giờ.
DO $$
DECLARE v_overlaps integer; v_bad integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Thiếu bảng supabase_migrations.schema_migrations — các dòng ghi lịch sử migration sẽ lỗi, dừng.';
  END IF;
  IF to_regclass('public."KtvAssignments"') IS NULL OR to_regclass('public."BookingItems"') IS NULL THEN
    RAISE EXCEPTION 'Thiếu bảng KtvAssignments / BookingItems — sai DB, dừng.';
  END IF;
  IF to_regprocedure('public.jsonb_unwrap_string(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Thiếu hàm jsonb_unwrap_string — DB chưa có các migration nền của phase1, dừng.';
  END IF;
  -- Ràng buộc ktv_assignments_no_live_overlap lúc THÊM (20260928020000) áp cho ACTIVE/QUEUED/READY
  -- (20260929160000 mới thu hẹp về ACTIVE) → kiểm cả 3 trạng thái, không chỉ ACTIVE (sửa 04/10/2026).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ktv_assignments_no_live_overlap') THEN
    SELECT count(*) INTO v_overlaps
    FROM "KtvAssignments" a JOIN "KtvAssignments" b
      ON a.employee_id = b.employee_id AND a.id < b.id
     AND a.status IN ('ACTIVE','QUEUED','READY') AND b.status IN ('ACTIVE','QUEUED','READY')
     -- PROD 04/10/2026: chỉ xét từ ngày làm việc 04/10 — không đụng dữ liệu quá khứ.
     AND a.business_date >= DATE '2026-10-04' AND b.business_date >= DATE '2026-10-04'
     AND a.planned_start_time IS NOT NULL AND a.planned_end_time IS NOT NULL
     AND b.planned_start_time IS NOT NULL AND b.planned_end_time IS NOT NULL
     AND tstzrange(a.planned_start_time, GREATEST(a.planned_start_time, a.planned_end_time), '[)')
      && tstzrange(b.planned_start_time, GREATEST(b.planned_start_time, b.planned_end_time), '[)');
    IF v_overlaps > 0 THEN
      RAISE EXCEPTION 'Có % cặp phân công ACTIVE/QUEUED/READY chồng giờ trong KtvAssignments — xử lý trước (xem truy vấn [A] cuối file), dừng.', v_overlaps;
    END IF;
  END IF;
  -- Trigger validate_final_ktv_assignment_plan (20260928020000) chặn mọi dòng phân công còn sống
  -- thiếu giờ / giờ kết thúc <= bắt đầu khi bị ghi. Backfill segment_id (20261001101000) ghi vào
  -- đúng các dòng đó → COMMIT lỗi. Dòng đổi KTV cũ (SWAP_KTV) thiếu planned_end_time.
  SELECT count(*) INTO v_bad FROM "KtvAssignments"
   WHERE status IN ('ACTIVE','QUEUED','READY') AND business_date >= DATE '2026-10-04'
     AND (planned_start_time IS NULL OR planned_end_time IS NULL OR planned_end_time <= planned_start_time);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Có % phân công còn sống thiếu giờ / giờ sai trong KtvAssignments — xử lý trước (xem truy vấn [B] cuối file), dừng.', v_bad;
  END IF;
END $$;

BEGIN;


-- ───────────────────────────── 20260925120000_live_sequential_handoff ─────────────────────────────
-- Two explicit positions on one BookingItem. Check migration history before deploying.
-- jsonb_unwrap_string is defined by 20260914120000_auto_complete_feedback_after_5m.sql.

CREATE OR REPLACE FUNCTION dispatch_enable_sequential_item(p_booking_id text, p_item_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
BEGIN
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF jsonb_typeof(v_options) <> 'object' OR jsonb_typeof(v_segments) <> 'array'
       OR jsonb_array_length(v_segments) <> 1 THEN
        RAISE EXCEPTION 'Chỉ chọn nối tiếp cho dịch vụ có một chặng A';
    END IF;
    v_a := v_segments->0;
    IF COALESCE(v_a->>'ktvId', '') = '' OR COALESCE(v_a->>'id', '') = ''
       OR COALESCE(v_a->>'voided', 'false') = 'true' THEN
        RAISE EXCEPTION 'Chặng A không hợp lệ';
    END IF;
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND NOT EXISTS (
        SELECT 1 FROM "KtvAssignments" WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
          AND employee_id = v_a->>'ktvId' AND planned_end_time IS NOT NULL
          AND status IN ('ACTIVE', 'COMPLETED')) THEN
        RAISE EXCEPTION 'Hãy sửa giờ kết thúc dự kiến của A trước khi chọn nối tiếp';
    END IF;
    IF v_options->>'sequentialSlots' = '2' THEN
        RETURN jsonb_build_object('success', true);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET
        options = v_options || '{"sequentialSlots":2}'::jsonb,
        segments = jsonb_build_array(v_a || '{"sequenceSlot":1}'::jsonb)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(
    p_booking_id text, p_item_id text, p_to_ktv text,
    p_planned_start_at timestamptz, p_duration_minutes integer, p_confirm_overlap boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_a_assignment "KtvAssignments"%ROWTYPE;
    v_turn "TurnQueue"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_new_b jsonb;
    v_reference timestamptz;
    v_old_ktv text;
    v_b_id text;
    v_end_at timestamptz;
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR COALESCE(v_options->>'finishedAfterA', 'false') = 'true'
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND status IN ('ACTIVE', 'COMPLETED')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công của A'; END IF;
    v_reference := COALESCE(NULLIF(v_a->>'actualEndTime', '')::timestamptz,
                            v_a_assignment.planned_end_time);
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND v_reference IS NOT NULL THEN
        IF v_a_assignment.planned_start_time IS NOT NULL
           AND v_reference <= v_a_assignment.planned_start_time THEN
            v_reference := v_reference + interval '1 day';
        END IF;
    END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'Giờ kết thúc của A chưa hợp lệ; hãy sửa mốc A'; END IF;
    IF p_planned_start_at < v_reference AND COALESCE(p_confirm_overlap, false) = false THEN
        RETURN jsonb_build_object('success', false, 'code', 'OVERLAP_CONFIRM_REQUIRED',
            'referenceAt', v_reference, 'referenceKind',
            CASE WHEN COALESCE(v_a->>'actualEndTime', '') <> '' THEN 'actual' ELSE 'planned' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Staff" WHERE id = p_to_ktv AND status = 'ĐANG LÀM') THEN
        RAISE EXCEPTION 'KTV B không khả dụng';
    END IF;
    v_old_ktv := v_b->>'ktvId';
    SELECT * INTO v_turn FROM "TurnQueue"
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date FOR UPDATE;
    IF NOT FOUND OR (p_to_ktv IS DISTINCT FROM v_old_ktv
       AND (v_turn.status <> 'waiting' OR v_turn.current_order_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'KTV B không còn rảnh; tải lại sổ tua';
    END IF;
    IF EXISTS (SELECT 1 FROM "KtvAssignments"
               WHERE employee_id = p_to_ktv AND business_date = v_a_assignment.business_date
                 AND status = 'ACTIVE' AND (booking_item_id <> p_item_id OR segment_id IS DISTINCT FROM v_b->>'id')) THEN
        RAISE EXCEPTION 'KTV B đang có phân công khác';
    END IF;
    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    v_b_id := CASE WHEN p_to_ktv = v_old_ktv THEN v_b->>'id' ELSE gen_random_uuid()::text END;
    v_new_b := jsonb_build_object(
        'id', v_b_id, 'ktvId', p_to_ktv, 'sequenceSlot', 2,
        'roomId', v_a->'roomId', 'bedId', v_a->'bedId',
        'plannedStartAt', p_planned_start_at, 'plannedEndAt', v_end_at,
        'startTime', to_char(p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'endTime', to_char(v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'duration', p_duration_minutes);
    IF v_b IS NOT NULL THEN
        IF p_to_ktv = v_old_ktv THEN
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b_id THEN v_new_b ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        ELSE
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                                  THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
            v_segments := v_segments || jsonb_build_array(v_new_b);
            UPDATE "KtvAssignments" SET status = 'CANCELLED'
            WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
            DELETE FROM "TurnLedger" tl USING "Bookings" booking
            WHERE booking.id = p_booking_id AND tl.date = v_a_assignment.business_date
              AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
              AND tl.employee_id = v_old_ktv
              AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                              JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                              WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                                AND ka.business_date = tl.date AND ka.employee_id = v_old_ktv
                                AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
            PERFORM promote_next_assignment(v_old_ktv, v_a_assignment.business_date);
        END IF;
    ELSE
        v_segments := v_segments || jsonb_build_array(v_new_b);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET segments = v_segments,
        "technicianCodes" = array_append(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id,
        segment_id, planned_start_time, planned_end_time, room_id, bed_id, status, dispatch_source)
    VALUES (p_to_ktv, v_a_assignment.business_date, p_booking_id, p_item_id, v_b_id,
        p_planned_start_at, v_end_at, v_a->>'roomId', v_a->>'bedId', 'ACTIVE', 'SEQUENTIAL_SLOT_B')
    ON CONFLICT (employee_id, booking_item_id) DO UPDATE SET
        segment_id = EXCLUDED.segment_id, planned_start_time = EXCLUDED.planned_start_time,
        planned_end_time = EXCLUDED.planned_end_time, status = 'ACTIVE',
        dispatch_source = EXCLUDED.dispatch_source;
    UPDATE "TurnQueue" SET status = 'assigned', current_order_id = p_booking_id,
        booking_item_id = p_item_id, booking_item_ids = ARRAY[p_item_id]::text[],
        room_id = v_a->>'roomId', bed_id = v_a->>'bedId',
        start_time = (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time = (v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date;
    INSERT INTO "TurnLedger" (date, booking_id, employee_id, source)
    SELECT v_a_assignment.business_date, COALESCE(parent_booking_id, id), p_to_ktv, 'DISPATCH_CONFIRM'
    FROM "Bookings" WHERE id = p_booking_id
    ON CONFLICT (date, booking_id, employee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'segmentId', v_b_id);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_finish_sequential_after_a(p_booking_id text, p_item_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_date date;
BEGIN
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Dịch vụ đã thay đổi'; END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Không phải dịch vụ nối tiếp'; END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF COALESCE(v_a->>'actualStartTime', '') = '' OR COALESCE(v_a->>'actualEndTime', '') = ''
       OR COALESCE(v_b->>'actualStartTime', '') <> '' THEN
        RAISE EXCEPTION 'Chỉ kết thúc sau A khi A đã xong và B chưa bắt đầu';
    END IF;
    IF v_b IS NOT NULL THEN
        v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                              THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                       FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        SELECT business_date INTO v_date FROM "KtvAssignments"
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE'
        LIMIT 1 FOR UPDATE;
        UPDATE "KtvAssignments" SET status = 'CANCELLED'
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
        DELETE FROM "TurnLedger" tl USING "Bookings" booking
        WHERE booking.id = p_booking_id AND tl.date = v_date
          AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
          AND tl.employee_id = v_b->>'ktvId'
          AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                          JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                          WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                            AND ka.business_date = tl.date AND ka.employee_id = v_b->>'ktvId'
                            AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
        IF v_date IS NOT NULL THEN PERFORM promote_next_assignment(v_b->>'ktvId', v_date); END IF;
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET options = v_options || '{"finishedAfterA":true}'::jsonb,
        segments = v_segments, status = 'CLEANING', "timeEnd" = clock_timestamp(),
        "technicianCodes" = array_remove("technicianCodes", v_b->>'ktvId')
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Merge concurrent KTV writes by segment ID and reject terminal status while a slot is open.
CREATE OR REPLACE FUNCTION guard_sequential_item_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_old_options jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}'::jsonb);
    v_new_options jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}'::jsonb);
    v_old_segments jsonb := COALESCE(jsonb_unwrap_string(OLD.segments), '[]'::jsonb);
    v_new_segments jsonb := COALESCE(jsonb_unwrap_string(NEW.segments), '[]'::jsonb);
    v_old jsonb;
    v_in jsonb;
    v_out jsonb := '[]'::jsonb;
    v_a_done boolean;
    v_b_done boolean;
    v_is_draft boolean;
BEGIN
    IF v_old_options->>'sequentialSlots' IS DISTINCT FROM '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RETURN NEW; END IF;
    v_is_draft := OLD.status IN ('NEW', 'WAITING') AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_old_segments) s
        WHERE COALESCE(s->>'actualStartTime', '') <> '' OR COALESCE(s->>'actualEndTime', '') <> '');
    IF NOT v_is_draft AND v_old_options->>'sequentialSlots' = '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Không được bỏ chế độ nối tiếp qua lưu đơn cũ';
    END IF;
    IF v_old_options->>'finishedAfterA' = 'true' AND v_new_options->>'finishedAfterA' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Dịch vụ đã kết thúc sau A; tải lại đơn';
    END IF;
    IF v_old_options->>'finishedAfterA' IS DISTINCT FROM 'true'
       AND v_new_options->>'finishedAfterA' = 'true'
       AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'Chỉ được kết thúc sau A qua thao tác quầy';
    END IF;
    IF jsonb_typeof(v_new_segments) <> 'array' THEN RAISE EXCEPTION 'Segments nối tiếp không hợp lệ'; END IF;
    IF NOT v_is_draft AND v_old_options->>'sequentialSlots' = '2' AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        FOR v_old IN SELECT value FROM jsonb_array_elements(v_old_segments) LOOP
            SELECT value INTO v_in FROM jsonb_array_elements(v_new_segments)
            WHERE value->>'id' = v_old->>'id' LIMIT 1;
            IF v_in IS NULL THEN v_in := v_old; END IF;
            IF COALESCE(v_old->>'voided', 'false') = 'true' THEN
                IF COALESCE(v_in->>'actualStartTime', '') <> COALESCE(v_old->>'actualStartTime', '') THEN
                    RAISE EXCEPTION 'Lượt KTV đã được thay; tải lại đơn';
                END IF;
                v_out := v_out || jsonb_build_array(v_old);
                CONTINUE;
            END IF;
            -- Assignment/slot changes belong to the locked RPC. A stale KTV write
            -- must not revive a replaced B or move either slot's planned time.
            v_in := v_in || jsonb_build_object(
                'ktvId', v_old->'ktvId', 'sequenceSlot', v_old->'sequenceSlot',
                'voided', v_old->'voided', 'roomId', v_old->'roomId',
                'bedId', v_old->'bedId', 'startTime', v_old->'startTime',
                'endTime', v_old->'endTime', 'duration', v_old->'duration',
                'plannedStartAt', v_old->'plannedStartAt',
                'plannedEndAt', v_old->'plannedEndAt');
            IF COALESCE(v_old->>'actualStartTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualStartTime}', v_old->'actualStartTime', true);
            END IF;
            IF COALESCE(v_old->>'actualEndTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualEndTime}', v_old->'actualEndTime', true);
            END IF;
            v_out := v_out || jsonb_build_array(v_in);
        END LOOP;
        NEW.segments := v_out;
        v_new_segments := v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
               WHERE COALESCE(s->>'voided', 'false') <> 'true'
                 AND COALESCE(s->>'actualEndTime', '') <> ''
                 AND COALESCE(s->>'actualStartTime', '') = '') THEN
        RAISE EXCEPTION 'Không thể kết thúc lượt KTV chưa bắt đầu';
    END IF;
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_a_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '1' AND COALESCE(s->>'voided', 'false') <> 'true';
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_b_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'voided', 'false') <> 'true';
    IF NEW.status NOT IN ('CANCELLED', 'PAUSED', 'IN_PROGRESS', 'PREPARING', 'READY', 'WAITING', 'NEW')
       AND NOT (v_a_done AND (v_b_done OR (COALESCE(v_new_options->>'finishedAfterA', 'false') = 'true'
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
                           WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'actualStartTime', '') <> '')))) THEN
        RAISE EXCEPTION 'Dịch vụ nối tiếp còn lượt chưa hoàn tất';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_live_handoff_segments_trigger ON "BookingItems";
DROP TRIGGER IF EXISTS guard_sequential_item_update_trigger ON "BookingItems";
CREATE TRIGGER guard_sequential_item_update_trigger
BEFORE UPDATE OF segments, options, status ON "BookingItems"
FOR EACH ROW EXECUTE FUNCTION guard_sequential_item_update();
DROP TRIGGER IF EXISTS guard_live_handoff_assignment_trigger ON "KtvAssignments";
DROP FUNCTION IF EXISTS dispatch_live_sequential_handoff(text,text,text,text,text,integer);

REVOKE ALL ON FUNCTION dispatch_enable_sequential_item(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dispatch_assign_sequential_slot_b(text,text,text,timestamptz,integer,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dispatch_finish_sequential_after_a(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_enable_sequential_item(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_assign_sequential_slot_b(text,text,text,timestamptz,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_finish_sequential_after_a(text,text) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260925120000', 'live_sequential_handoff') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260926120000_dispatch_edit_history ─────────────────────────────
-- Latest saved plan is the edit baseline; audit and optimistic locking are atomic.
-- Requires jsonb_unwrap_string and the sequential RPCs. No shared DB application here.
CREATE OR REPLACE FUNCTION dispatch_edit_snapshot(p_segments jsonb, p_options jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'segments', COALESCE((SELECT jsonb_object_agg(s->>'id', jsonb_strip_nulls(jsonb_build_object(
      'ktvId', s->'ktvId', 'sequenceSlot', s->'sequenceSlot', 'startTime', s->'startTime',
      'endTime', s->'endTime', 'duration', s->'duration', 'plannedStartAt', s->'plannedStartAt',
      'plannedEndAt', s->'plannedEndAt', 'actualStartTime', s->'actualStartTime',
      'actualEndTime', s->'actualEndTime', 'voided', s->'voided')))
      FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(p_segments), '[]')) s WHERE s->>'id' IS NOT NULL), '{}'),
    'names', COALESCE(NULLIF(jsonb_unwrap_string(p_options)->'serviceNamesForKtvs', 'null'), '{}'),
    'displayName', jsonb_unwrap_string(p_options)->'displayName');
$$;

CREATE OR REPLACE FUNCTION keep_dispatch_edit_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_opts jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}');
  new_opts jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}');
  before_state jsonb;
  after_state jsonb;
  changes jsonb := '[]';
  old_seg jsonb;
  new_seg jsonb;
  segment_id text;
  field_name text;
  employee_id text;
  revision bigint := COALESCE((old_opts->>'dispatchRevision')::bigint, 0);
  action_name text := NULLIF(current_setting('app.dispatch_action', true), '');
  actor jsonb := COALESCE(NULLIF(current_setting('app.dispatch_actor', true), '')::jsonb, 'null');
BEGIN
  -- A background writer holding old options must not undo a saved service name.
  IF action_name IS NULL AND COALESCE((new_opts->>'dispatchRevision')::bigint, 0) < revision THEN
    new_opts := (new_opts - 'serviceNamesForKtvs' - 'displayName') ||
      jsonb_build_object('serviceNamesForKtvs', COALESCE(old_opts->'serviceNamesForKtvs', '{}'),
                         'displayName', old_opts->'displayName');
  END IF;
  before_state := dispatch_edit_snapshot(OLD.segments, old_opts);
  after_state := dispatch_edit_snapshot(NEW.segments, new_opts);
  FOR segment_id IN SELECT jsonb_object_keys(before_state->'segments') UNION SELECT jsonb_object_keys(after_state->'segments') LOOP
    old_seg := before_state->'segments'->segment_id;
    new_seg := after_state->'segments'->segment_id;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided']) LOOP
      IF old_seg->field_name IS DISTINCT FROM new_seg->field_name THEN
        changes := changes || jsonb_build_array(jsonb_build_object('segmentId', segment_id,
          'employeeId', COALESCE(new_seg->>'ktvId', old_seg->>'ktvId'), 'field', field_name,
          'before', old_seg->field_name, 'after', new_seg->field_name));
      END IF;
    END LOOP;
  END LOOP;
  FOR employee_id IN SELECT jsonb_object_keys(before_state->'names') UNION SELECT jsonb_object_keys(after_state->'names') LOOP
    IF before_state->'names'->employee_id IS DISTINCT FROM after_state->'names'->employee_id THEN
      changes := changes || jsonb_build_array(jsonb_build_object('employeeId', employee_id,
        'field', 'serviceNameForKtv', 'before', before_state->'names'->employee_id, 'after', after_state->'names'->employee_id));
    END IF;
  END LOOP;
  IF before_state->'displayName' IS DISTINCT FROM after_state->'displayName' THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'displayName',
      'before', before_state->'displayName', 'after', after_state->'displayName'));
  END IF;
  new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
    'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]'));
  -- Preserve counter entries that arrived while the form was open, plus new entries.
  IF old_opts ? 'counterLog' OR new_opts ? 'counterLog' THEN
    new_opts := jsonb_set(new_opts, '{counterLog}', COALESCE((SELECT jsonb_agg(value ORDER BY first_pos)
      FROM (SELECT value, min(ord) first_pos FROM jsonb_array_elements(
        COALESCE(old_opts->'counterLog', '[]') || COALESCE(new_opts->'counterLog', '[]')) WITH ORDINALITY a(value, ord)
        GROUP BY value) unique_entries), '[]'));
  END IF;
  IF changes <> '[]' OR action_name IS NOT NULL THEN
    revision := revision + 1;
    new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
      'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]') || jsonb_build_array(jsonb_build_object(
        'revision', revision, 'at', clock_timestamp(), 'action', COALESCE(action_name, 'UPDATE'),
        'actor', actor, 'changes', changes)));
  END IF;
  NEW.options := new_opts;
  RETURN NEW;
END;
$$;

-- Runs after the existing sequential guard so the audit describes what was saved.
DROP TRIGGER IF EXISTS zz_dispatch_edit_history ON "BookingItems";
CREATE TRIGGER zz_dispatch_edit_history BEFORE UPDATE OF segments, options ON "BookingItems"
FOR EACH ROW EXECUTE FUNCTION keep_dispatch_edit_history();

-- Edit an existing sequential service without resending/recreating A's assignment.
CREATE OR REPLACE FUNCTION dispatch_save_sequential_update(p_booking_id text, p_edit jsonb, p_confirm_overlap boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item_row "BookingItems"%ROWTYPE;
  opts jsonb;
  old_segments jsonb;
  incoming_segments jsonb := jsonb_unwrap_string(p_edit->'segments');
  old_segment jsonb;
  incoming jsonb;
  b jsonb;
  next_b jsonb;
  field_name text;
  plan_start timestamptz;
  plan_day date;
  result jsonb;
BEGIN
  SELECT * INTO item_row FROM "BookingItems" WHERE id = p_edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
  opts := COALESCE(jsonb_unwrap_string(item_row.options), '{}');
  old_segments := COALESCE(jsonb_unwrap_string(item_row.segments), '[]');
  IF NOT FOUND OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
     OR item_row.status NOT IN ('PREPARING','READY','IN_PROGRESS')
     OR jsonb_unwrap_string(p_edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
     OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> COALESCE((jsonb_unwrap_string(p_edit->'options')->>'dispatchRevision')::bigint,0)
     OR jsonb_typeof(incoming_segments) <> 'array' OR jsonb_array_length(old_segments) <> jsonb_array_length(incoming_segments) THEN
    RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn trước khi cập nhật B';
  END IF;
  FOR old_segment IN SELECT value FROM jsonb_array_elements(old_segments) LOOP
    SELECT value INTO incoming FROM jsonb_array_elements(incoming_segments) WHERE value->>'id' = old_segment->>'id';
    IF incoming IS NULL THEN RAISE EXCEPTION 'Không được xóa chặng đã điều phối'; END IF;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) LOOP
      IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; dùng thao tác đổi B riêng';
      END IF;
    END LOOP;
    IF old_segment->>'sequenceSlot' = '2' AND COALESCE(old_segment->>'voided','false') <> 'true' THEN
      b := old_segment; next_b := incoming;
    ELSE
      FOR field_name IN SELECT unnest(ARRAY['startTime','endTime','duration','plannedStartAt','plannedEndAt']) LOOP
        IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
          RAISE EXCEPTION 'Không đổi kế hoạch A hoặc chặng cũ khi cập nhật B';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF b IS NOT NULL AND (b->'startTime' IS DISTINCT FROM next_b->'startTime'
      OR b->'endTime' IS DISTINCT FROM next_b->'endTime' OR b->'duration' IS DISTINCT FROM next_b->'duration') THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa giờ dự kiến'; END IF;
    IF COALESCE(next_b->>'startTime','') = '' OR COALESCE((next_b->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'Giờ/phút B không hợp lệ';
    END IF;
    IF abs(extract(epoch FROM ((next_b->>'startTime')::time - (b->>'startTime')::time))) >= 43200 THEN
      RAISE EXCEPTION 'Giờ B có thể chuyển ngày; dùng Sửa B để chọn ngày/giờ đầy đủ';
    END IF;
    SELECT COALESCE((NULLIF(b->>'plannedStartAt','')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
      (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = item_row.id AND segment_id = b->>'id' LIMIT 1)) INTO plan_day;
    IF plan_day IS NULL THEN RAISE EXCEPTION 'Thiếu ngày phân công B; tải lại đơn'; END IF;
    plan_start := (plan_day + (next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF next_b->>'endTime' IS DISTINCT FROM to_char((plan_start + make_interval(mins => (next_b->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN
      RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id,item_row.id,b->>'ktvId',plan_start,
      (next_b->>'duration')::integer,p_confirm_overlap);
    IF result->>'code' = 'OVERLAP_CONFIRM_REQUIRED' THEN
      RAISE EXCEPTION USING MESSAGE = 'OVERLAP_CONFIRM_REQUIRED', DETAIL = (result || jsonb_build_object('itemId', item_row.id))::text;
    END IF;
    IF COALESCE((result->>'success')::boolean,false) = false THEN RAISE EXCEPTION 'Chưa cập nhật được kế hoạch B'; END IF;
  END IF;
  -- Read options again: the planned-time RPC may already have appended an audit entry.
  UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}') || COALESCE(jsonb_unwrap_string(p_edit->'options'),'{}')
  WHERE id = item_row.id;
  RETURN '{"success":true}';
END;
$$;
REVOKE ALL ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) TO service_role;

CREATE OR REPLACE FUNCTION dispatch_apply_edit(p_booking_id text, p_action text, p_payload jsonb, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  edit jsonb;
  item_row "BookingItems"%ROWTYPE;
  result jsonb;
  item_updates jsonb := COALESCE(p_payload->'itemUpdates', '[]');
  opts jsonb;
  segment jsonb;
  old_segment jsonb;
  segment_list jsonb;
  plan_day date;
  plan_start timestamptz;
  normal_updates jsonb := '[]';
  live_ids text[] := ARRAY[]::text[];
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH','ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A','EDIT_ACTUAL_TIME') THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn; tải lại bảng'; END IF;
  IF p_action IN ('ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A') THEN
    item_updates := jsonb_build_array(jsonb_build_object('id', p_payload->>'itemId',
      'options', jsonb_build_object('dispatchRevision', p_payload->'expectedRevision')));
  END IF;
  FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) ORDER BY value->>'id' LOOP
    SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dịch vụ không thuộc đơn; tải lại bảng'; END IF;
    IF COALESCE((jsonb_unwrap_string(item_row.options)->>'dispatchRevision')::bigint, 0)
       <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint, 0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Tải lại đơn trước khi chỉnh tiếp; bản cũ chưa được lưu.';
    END IF;
  END LOOP;
  PERFORM set_config('app.dispatch_action', p_action, true);
  PERFORM set_config('app.dispatch_actor', COALESCE(p_actor, 'null')::text, true);
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'confirmedOverlapItemIds' AND jsonb_typeof(p_payload->'confirmedOverlapItemIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Danh sách xác nhận chồng giờ không hợp lệ';
    END IF;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' = '2'
         AND item_row.status IN ('PREPARING','READY','IN_PROGRESS') THEN
        PERFORM dispatch_save_sequential_update(p_booking_id,edit,
          COALESCE(p_payload->'confirmedOverlapItemIds', '[]'::jsonb) ? item_row.id
          OR (jsonb_array_length(item_updates) = 1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false)));
        live_ids := array_append(live_ids,item_row.id);
      ELSE
        normal_updates := normal_updates || jsonb_build_array(edit);
      END IF;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND cardinality(live_ids) > 0 AND jsonb_array_length(normal_updates) = 0 THEN
    result := '{"success":true}';
  ELSIF p_action = 'DISPATCH' THEN
    result := dispatch_confirm_booking(p_booking_id, (p_payload->>'date')::date,
      COALESCE(p_payload->>'status', 'PREPARING'), p_payload->>'technicianCode', p_payload->>'bedId',
      p_payload->>'roomName', p_payload->>'notes', COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(p_payload->'staffAssignments','[]'))
        WHERE NOT (value->>'bookingItemId' = ANY(live_ids))), '[]'), normal_updates);
    IF COALESCE((result->>'success')::boolean, false) = false THEN RAISE EXCEPTION '%', COALESCE(result->>'error', 'Điều phối chưa được lưu'); END IF;
  ELSIF p_action = 'EDIT_ACTUAL_TIME' THEN
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_array_length(edit->'segments') <> jsonb_array_length(jsonb_unwrap_string(item_row.segments))
         OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(edit->'segments')) <> jsonb_array_length(edit->'segments') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; tải lại đơn';
      END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(edit->'segments') LOOP
        SELECT value INTO old_segment FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments))
        WHERE value->>'id' = segment->>'id';
        IF old_segment IS NULL OR (old_segment - 'actualStartTime' - 'actualEndTime')
           IS DISTINCT FROM (segment - 'actualStartTime' - 'actualEndTime')
           OR (old_segment->>'voided' = 'true' AND old_segment IS DISTINCT FROM segment)
           OR (COALESCE(old_segment->>'actualStartTime', '') <> '' AND COALESCE(segment->>'actualStartTime', '') = '')
           OR (COALESCE(old_segment->>'actualEndTime', '') <> '' AND COALESCE(segment->>'actualEndTime', '') = '') THEN
          RAISE EXCEPTION 'Chỉ chỉnh giờ thực tế, không xóa mốc hoặc đổi chặng đã lưu';
        END IF;
        IF COALESCE(segment->>'actualEndTime', '') <> '' AND
           (COALESCE(segment->>'actualStartTime', '') = '' OR
            (segment->>'actualEndTime')::timestamptz < (segment->>'actualStartTime')::timestamptz) THEN
          RAISE EXCEPTION 'Giờ kết thúc phải sau giờ bắt đầu';
        END IF;
      END LOOP;
      -- The payload now matches the locked row apart from validated actual stamps.
      PERFORM set_config('app.sequential_rpc', '1', true);
      UPDATE "BookingItems" SET segments = edit->'segments' WHERE id = edit->>'id';
      PERFORM set_config('app.sequential_rpc', '', true);
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'DRAFT' THEN
    UPDATE "Bookings" SET "technicianCode" = CASE WHEN p_payload ? 'technicianCode' THEN p_payload->>'technicianCode' ELSE "technicianCode" END,
      "bedId" = p_payload->>'bedId', "roomName" = p_payload->>'roomName',
      notes = p_payload->>'notes', "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT COALESCE(jsonb_unwrap_string(options), '{}') INTO opts FROM "BookingItems" WHERE id = edit->>'id';
      segment_list := COALESCE(edit->'segments', (SELECT segments FROM "BookingItems" WHERE id = edit->>'id'));
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          SELECT value INTO old_segment FROM "BookingItems" bi, jsonb_array_elements(COALESCE(bi.segments, '[]'))
          WHERE bi.id = edit->>'id' AND value->>'id' = segment->>'id' LIMIT 1;
          IF COALESCE(segment->>'startTime', '') <> '' AND COALESCE(segment->>'duration', '') <> ''
             AND COALESCE(segment->>'actualStartTime', '') = ''
             AND (old_segment->'startTime' IS DISTINCT FROM segment->'startTime'
                  OR old_segment->'duration' IS DISTINCT FROM segment->'duration'
                  OR old_segment->'endTime' IS DISTINCT FROM segment->'endTime') THEN
            SELECT COALESCE(NULLIF(p_payload->>'date', '')::date,
              (NULLIF(old_segment->>'plannedStartAt', '')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
              (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = edit->>'id'
               AND segment_id = segment->>'id' LIMIT 1)) INTO plan_day;
            IF plan_day IS NOT NULL THEN
              plan_start := (plan_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
              segment_list := (SELECT jsonb_agg(CASE WHEN value->>'id' = segment->>'id' THEN value ||
                jsonb_build_object('plannedStartAt', plan_start, 'plannedEndAt',
                  plan_start + make_interval(mins => (segment->>'duration')::integer)) ELSE value END ORDER BY ord)
                FROM jsonb_array_elements(segment_list) WITH ORDINALITY a(value, ord));
            END IF;
          END IF;
        END LOOP;
      END IF;
      UPDATE "BookingItems" SET "roomName" = edit->>'roomName', "bedId" = edit->>'bedId',
        "technicianCodes" = ARRAY(SELECT jsonb_array_elements_text(COALESCE(edit->'technicianCodes', '[]'))),
        segments = segment_list, options = opts || COALESCE(jsonb_unwrap_string(edit->'options'), '{}'),
        guest_id = CASE WHEN edit ? 'guest_id' THEN edit->>'guest_id' ELSE guest_id END
      WHERE id = edit->>'id';
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' AND jsonb_unwrap_string(edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
         AND COALESCE(jsonb_unwrap_string(edit->'options')->>'mergedIntoId', '') = '' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          IF COALESCE(segment->>'ktvId', '') <> '' AND COALESCE(segment->>'startTime', '') <> '' THEN
            UPDATE "KtvAssignments" SET
              planned_start_time = (business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh',
              planned_end_time = ((business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                + make_interval(mins => (segment->>'duration')::integer)
            WHERE booking_id = p_booking_id AND booking_item_id = edit->>'id'
              AND segment_id = segment->>'id' AND status IN ('ACTIVE','QUEUED','READY')
              AND COALESCE(segment->>'actualStartTime', '') = '';
            UPDATE "TurnQueue" SET start_time = (segment->>'startTime')::time,
              estimated_end_time = COALESCE(NULLIF(segment->>'endTime', '')::time, estimated_end_time)
            WHERE employee_id = segment->>'ktvId' AND current_order_id = p_booking_id AND status = 'assigned';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'ENABLE_SEQUENTIAL' THEN
    result := dispatch_enable_sequential_item(p_booking_id, p_payload->>'itemId');
  ELSIF p_action = 'ASSIGN_B' THEN
    IF p_payload ? 'metadata' AND (jsonb_typeof(p_payload->'metadata') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'serviceNamesForKtvs') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'notesForKtvs') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM (
                    SELECT value FROM jsonb_each(p_payload->'metadata'->'serviceNamesForKtvs')
                    UNION ALL SELECT value FROM jsonb_each(p_payload->'metadata'->'notesForKtvs')) entries
                  WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')) THEN
      RAISE EXCEPTION 'Tên/ghi chú B không hợp lệ';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id, p_payload->>'itemId', p_payload->>'toKtvId',
      (p_payload->>'plannedStartAt')::timestamptz, (p_payload->>'durationMinutes')::integer,
      COALESCE((p_payload->>'confirmOverlap')::boolean, false));
    IF COALESCE((result->>'success')::boolean, false) AND p_payload ? 'metadata' THEN
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options), '{}') ||
        jsonb_build_object('serviceNamesForKtvs', p_payload->'metadata'->'serviceNamesForKtvs',
                          'notesForKtvs', p_payload->'metadata'->'notesForKtvs')
      WHERE id = p_payload->>'itemId' AND "bookingId" = p_booking_id;
    END IF;
  ELSE
    result := dispatch_finish_sequential_after_a(p_booking_id, p_payload->>'itemId');
  END IF;
  PERFORM set_config('app.dispatch_action', '', true);
  PERFORM set_config('app.dispatch_actor', '', true);
  RETURN result || jsonb_build_object('revisions', (SELECT jsonb_object_agg(id,
    COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint, 0)) FROM "BookingItems"
    WHERE "bookingId" = p_booking_id AND id IN (SELECT value->>'id' FROM jsonb_array_elements(item_updates))));
END;
$$;
REVOKE ALL ON FUNCTION dispatch_apply_edit(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_apply_edit(text,text,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260926120000', 'dispatch_edit_history') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260926140000_ktv_finish_service_atomic ─────────────────────────────
-- Service-role FINISH commit: all item/child writes and booking status share one transaction.
CREATE OR REPLACE FUNCTION ktv_finish_service_atomic(
    p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb,
    p_guest_ratings jsonb, p_updates jsonb, p_booking_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    booking_row "Bookings"%ROWTYPE;
    item_row "BookingItems"%ROWTYPE;
    snapshot jsonb;
    patch jsonb;
    field text;
    guests jsonb;
BEGIN
    IF jsonb_typeof(p_item_snapshots) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_guest_ratings) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_updates) = 0
       OR p_booking_status IS NULL
       OR p_booking_status NOT IN ('NEW','PREPARING','IN_PROGRESS','CLEANING','FEEDBACK','DONE') THEN
        RAISE EXCEPTION 'Invalid FINISH batch';
    END IF;
    SELECT * INTO booking_row FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    -- Match dispatch's lock order: booking, items by id, guests by id.
    PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
    PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
    IF p_booking_snapshot->>'id' IS DISTINCT FROM p_booking_id
       OR to_jsonb(booking_row)->'status' IS DISTINCT FROM p_booking_snapshot->'status'
       OR to_jsonb(booking_row)->'rating' IS DISTINCT FROM p_booking_snapshot->'rating' THEN
        RAISE EXCEPTION 'FINISH snapshot changed; reload booking';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rating',rating) ORDER BY id),'[]') INTO guests
      FROM "BookingGuests" WHERE booking_id = p_booking_id;
    IF guests IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(value ORDER BY value->>'id'),'[]') FROM jsonb_array_elements(p_guest_ratings)) THEN
        RAISE EXCEPTION 'FINISH ratings changed; reload booking';
    END IF;
    IF jsonb_array_length(p_item_snapshots) <> (SELECT count(*) FROM "BookingItems" WHERE "bookingId" = p_booking_id)
       OR jsonb_array_length(p_item_snapshots) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_item_snapshots))
       OR jsonb_array_length(p_updates) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_updates)) THEN
        RAISE EXCEPTION 'FINISH item set changed; reload booking';
    END IF;
    FOR snapshot IN SELECT value FROM jsonb_array_elements(p_item_snapshots) LOOP
        SELECT * INTO item_row FROM "BookingItems" WHERE id = snapshot->>'id' AND "bookingId" = p_booking_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'FINISH item not found'; END IF;
        -- Every field used by the handler must be present, not omitted by a malformed payload.
        IF NOT snapshot ?& ARRAY['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'] THEN
            RAISE EXCEPTION 'Incomplete FINISH snapshot';
        END IF;
        FOR field IN SELECT jsonb_object_keys(snapshot) LOOP
            IF (CASE WHEN field = 'handover_submitted_at'
                THEN item_row.handover_submitted_at IS DISTINCT FROM (snapshot->>field)::timestamptz
                ELSE to_jsonb(item_row)->field IS DISTINCT FROM snapshot->field END) THEN
                RAISE EXCEPTION 'FINISH item snapshot changed: %; reload booking', item_row.id;
            END IF;
        END LOOP;
    END LOOP;
    FOR patch IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_item_snapshots) s WHERE s->>'id' = patch->>'id')
           OR patch->>'status' IS NULL
           OR patch->>'status' NOT IN ('CANCELLED','DONE','IN_PROGRESS','CLEANING','FEEDBACK')
           OR NOT patch ? 'status'
           OR (patch - ARRAY['id','segments','status','handover_images','handover_status','handover_skipped','handover_submitted_at']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Invalid FINISH item update';
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') = 'string' THEN
            patch := jsonb_set(patch,'{segments}',(patch->>'segments')::jsonb);
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Invalid FINISH segments';
        END IF;
        SELECT * INTO item_row FROM "BookingItems" WHERE id = patch->>'id' AND "bookingId" = p_booking_id;
        SELECT * INTO item_row FROM jsonb_populate_record(item_row,patch - 'id');
        UPDATE "BookingItems" SET segments = item_row.segments, status = item_row.status,
            handover_images = item_row.handover_images, handover_status = item_row.handover_status,
            handover_skipped = item_row.handover_skipped, handover_submitted_at = item_row.handover_submitted_at
          WHERE id = item_row.id;
    END LOOP;
    SELECT * INTO booking_row FROM jsonb_populate_record(booking_row, jsonb_build_object('status', p_booking_status));
    UPDATE "Bookings" SET status = booking_row.status, "updatedAt" = now() WHERE id = p_booking_id RETURNING * INTO booking_row;
    RETURN jsonb_build_object('success',true,'booking',to_jsonb(booking_row));
END $$;
REVOKE ALL ON FUNCTION ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260926140000', 'ktv_finish_service_atomic') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927120000_sequential_operational_consistency ─────────────────────────────
-- Forward fixes proposed against bc06814f. Apply to an isolated DB before rollout.
CREATE OR REPLACE FUNCTION jsonb_unwrap_string(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE i integer;
BEGIN
  FOR i IN 1..2 LOOP
    EXIT WHEN jsonb_typeof(p) IS DISTINCT FROM 'string';
    p := (p #>> '{}')::jsonb;
  END LOOP;
  RETURN p;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;

-- The same ordering as lib/dispatch-status.ts; utility filtering matches isUtilityService.
CREATE OR REPLACE FUNCTION dispatch_recompute_booking_status(p_booking_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE statuses text[]; computed text; b "Bookings"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.status::text IN ('CANCELLED','SPLIT') THEN RETURN; END IF;
  SELECT array_agg(bi.status::text) INTO statuses FROM "BookingItems" bi
    LEFT JOIN "Services" svc ON svc.id = bi."serviceId"
    WHERE bi."bookingId" = p_booking_id
      AND NOT (COALESCE(svc.is_utility,false) OR COALESCE(bi."serviceId" = 'NHS0900',false)
        OR (lower(COALESCE(svc."nameVN",'')) ~ '(phòng riêng|phong rieng)' AND COALESCE(svc."nameVN",'') NOT LIKE '%+%'));
  IF statuses IS NULL THEN
    SELECT array_agg(status::text) INTO statuses FROM "BookingItems" WHERE "bookingId" = p_booking_id;
  END IF;
  computed := CASE
    WHEN statuses IS NULL THEN 'NEW'
    WHEN statuses && ARRAY['IN_PROGRESS','PAUSED'] THEN 'IN_PROGRESS'
    WHEN statuses && ARRAY['PREPARING','WAITING','NEW'] AND statuses && ARRAY['IN_PROGRESS','PAUSED','COMPLETED','DONE','CANCELLED','FEEDBACK','CLEANING'] THEN 'IN_PROGRESS'
    WHEN statuses && ARRAY['CLEANING','COMPLETED'] THEN 'CLEANING'
    WHEN 'FEEDBACK' = ANY(statuses) THEN 'FEEDBACK'
    WHEN statuses <@ ARRAY['DONE','CANCELLED'] THEN 'DONE'
    WHEN 'PREPARING' = ANY(statuses) THEN 'PREPARING'
    ELSE 'NEW' END;
  SELECT * INTO b FROM jsonb_populate_record(b,jsonb_build_object('status',computed));
  UPDATE "Bookings" SET status = b.status, "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
END $$;

CREATE OR REPLACE FUNCTION ktv_start_service_atomic(
  p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb, p_guest_ratings jsonb,
  p_updates jsonb, p_employee_id text, p_target_segment_id text, p_started_at timestamptz, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b "Bookings"%ROWTYPE; t "TurnQueue"%ROWTYPE; result jsonb; service_day date;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b."timeStart" IS DISTINCT FROM NULLIF(p_booking_snapshot->>'timeStart','')::timestamptz
     OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'START snapshot changed; reload'; END IF;
  service_day := b."bookingDate"::date;
  IF service_day IS NULL OR p_started_at IS NULL OR COALESCE(p_employee_id,'') = '' THEN RAISE EXCEPTION 'Invalid START'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) patch,
    jsonb_array_elements(jsonb_unwrap_string(patch->'segments')) seg
    WHERE seg->>'id' = p_target_segment_id AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\s+-\s+'))
      AND COALESCE(seg->>'voided','false') <> 'true' AND NULLIF(seg->>'actualStartTime','')::timestamptz = p_started_at) THEN
    RAISE EXCEPTION 'Invalid START target';
  END IF;
  -- Reuse the proven snapshot lock and item commit. Nested calls remain in this transaction.
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id)
     OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}' THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

CREATE OR REPLACE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item "BookingItems"%ROWTYPE; a "KtvAssignments"%ROWTYPE; v_segments jsonb; live_done jsonb;
  seg jsonb; images jsonb; changed_dates date[] := '{}'; day date; count_done integer := 0;
  now_at timestamptz := clock_timestamp(); b "Bookings"%ROWTYPE; promotion jsonb;
  opts jsonb; all_done boolean; all_handed boolean; rated boolean; next_status text;
BEGIN
  IF COALESCE(p_employee_id,'') = '' OR jsonb_typeof(p_photo_urls) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_photo_urls) > 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_photo_urls) v WHERE jsonb_typeof(v) <> 'string')
    OR (p_item_ids IS NOT NULL AND jsonb_typeof(p_item_ids) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid RELEASE payload';
  END IF;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
  PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
  FOR item IN SELECT * FROM "BookingItems" WHERE "bookingId" = p_booking_id
    AND (p_item_ids IS NULL OR p_item_ids ? id) ORDER BY id LOOP
    v_segments := jsonb_unwrap_string(item.segments);
    IF jsonb_typeof(v_segments) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid RELEASE v_segments'; END IF;
    SELECT COALESCE(jsonb_agg(s),'[]') INTO live_done FROM jsonb_array_elements(v_segments) s
      WHERE COALESCE(s->>'voided','false') <> 'true'
        AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> '';
    IF jsonb_array_length(live_done) = 0 THEN CONTINUE; END IF;
    IF jsonb_array_length(p_photo_urls) = 0 AND item.handover_status IS DISTINCT FROM 'SKIPPED'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) s WHERE COALESCE(s->>'handoverTime','') <> '') THEN
      RAISE EXCEPTION 'Submit photos or use existing skip quota before release';
    END IF;
    count_done := count_done + 1;
    SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
      THEN s || jsonb_build_object('feedbackTime',COALESCE(NULLIF(s->>'feedbackTime',''),now_at::text)) ELSE s END ORDER BY ord)
      INTO v_segments FROM jsonb_array_elements(v_segments) WITH ORDINALITY v(s,ord);
    IF jsonb_array_length(p_photo_urls) > 0 THEN
      SELECT COALESCE(jsonb_object_agg(p_employee_id || ' · Ảnh ' || ord::text,value),'{}') INTO images
        FROM jsonb_array_elements(p_photo_urls) WITH ORDINALITY v(value,ord);
      SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
        THEN s || jsonb_build_object('handoverTime',now_at,'handoverPhotoUrls',p_photo_urls) ELSE s END ORDER BY ord)
        INTO v_segments FROM jsonb_array_elements(v_segments) WITH ORDINALITY v(s,ord);
      UPDATE "BookingItems" SET segments = v_segments, handover_images = (CASE WHEN jsonb_typeof(item.handover_images) = 'object' THEN item.handover_images
        WHEN jsonb_typeof(item.handover_images) = 'array' THEN (SELECT COALESCE(jsonb_object_agg('Ảnh cũ ' || ord::text,value),'{}')
          FROM jsonb_array_elements(item.handover_images) WITH ORDINALITY v(value,ord)) ELSE '{}' END) || images,
        handover_status = 'PENDING', handover_skipped = false, handover_submitted_at = now_at WHERE id = item.id;
    END IF;
    opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
    SELECT bool_and(COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''),
      bool_and(COALESCE(s->>'handoverTime','') <> '') INTO all_done,all_handed FROM jsonb_array_elements(v_segments) s
      WHERE COALESCE(s->>'ktvId','') <> '' AND COALESCE(s->>'voided','false') <> 'true';
    IF opts->>'sequentialSlots' = '2' AND opts->>'finishedAfterA' IS DISTINCT FROM 'true'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) s
        WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'voided','false') <> 'true'
          AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> '') THEN all_done := false; END IF;
    rated := item."itemRating" IS NOT NULL OR b.rating IS NOT NULL OR EXISTS (
      SELECT 1 FROM "BookingGuests" WHERE id = item.guest_id AND rating IS NOT NULL);
    next_status := CASE WHEN item.status IN ('DONE','CANCELLED') THEN item.status::text
      WHEN NOT COALESCE(all_done,false) THEN 'IN_PROGRESS'
      WHEN rated AND all_handed THEN 'DONE' ELSE 'FEEDBACK' END;
    SELECT * INTO item FROM jsonb_populate_record(item,jsonb_build_object('status',next_status));
    UPDATE "BookingItems" SET segments = v_segments, status = item.status WHERE id = item.id;
    -- Skip preserves SKIPPED/debt and does not fabricate physical handoverTime.
    FOR a IN SELECT * FROM "KtvAssignments" WHERE booking_id = p_booking_id
      AND booking_item_id = item.id AND employee_id = p_employee_id AND status IN ('ACTIVE','QUEUED','READY')
      ORDER BY business_date, segment_id FOR UPDATE LOOP
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = a.segment_id)
        OR (a.segment_id IS NULL AND jsonb_array_length(live_done) = 1 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE COALESCE(s->>'voided','false') <> 'true'
          AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
          AND COALESCE(s->>'actualEndTime','') = '')) THEN
        UPDATE "KtvAssignments" SET status = 'COMPLETED', updated_at = now_at
          WHERE employee_id = a.employee_id AND booking_item_id = a.booking_item_id AND segment_id IS NOT DISTINCT FROM a.segment_id;
        changed_dates := array_append(changed_dates,a.business_date);
      END IF;
    END LOOP;
  END LOOP;
  IF count_done = 0 THEN RAISE EXCEPTION 'No completed live work to release'; END IF;
  FOR day IN SELECT DISTINCT unnest(changed_dates) LOOP
    -- Repaying an old debt must never promote/clear another booking currently being served.
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id = p_employee_id AND business_date = day AND status = 'ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = day
        AND current_order_id IS NOT NULL AND current_order_id <> p_booking_id) THEN
      promotion := promote_next_assignment(p_employee_id,day);
      IF promotion ? 'success' AND NOT COALESCE((promotion->>'success')::boolean,false) THEN RAISE EXCEPTION 'Promotion failed'; END IF;
    END IF;
  END LOOP;
  PERFORM dispatch_recompute_booking_status(p_booking_id);
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

CREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(
    p_booking_id text, p_item_id text, p_to_ktv text,
    p_planned_start_at timestamptz, p_duration_minutes integer, p_confirm_overlap boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_a_assignment "KtvAssignments"%ROWTYPE;
    v_turn "TurnQueue"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_new_b jsonb;
    v_reference timestamptz;
    v_old_ktv text;
    v_b_id text;
    v_end_at timestamptz;
    v_service_day date;
    v_expected_at timestamptz;
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT "bookingDate"::date INTO v_service_day FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF v_service_day IS NULL THEN RAISE EXCEPTION 'Missing service day'; END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR COALESCE(v_options->>'finishedAfterA', 'false') = 'true'
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND status IN ('ACTIVE', 'COMPLETED')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công của A'; END IF;
    v_reference := COALESCE(NULLIF(v_a->>'actualEndTime', '')::timestamptz,
                            v_a_assignment.planned_end_time);
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND v_reference IS NOT NULL THEN
        IF v_a_assignment.planned_start_time IS NOT NULL
           AND v_reference <= v_a_assignment.planned_start_time THEN
            v_reference := v_reference + interval '1 day';
        END IF;
    END IF;
    v_expected_at := (v_service_day + (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < (v_a->>'startTime')::time THEN
        v_expected_at := v_expected_at + interval '1 day';
    END IF;
    IF p_planned_start_at IS DISTINCT FROM v_expected_at OR v_a_assignment.business_date <> v_service_day THEN
        RAISE EXCEPTION 'B must follow the booking service day; reload plan';
    END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'Giờ kết thúc của A chưa hợp lệ; hãy sửa mốc A'; END IF;
    IF p_planned_start_at < v_reference AND COALESCE(p_confirm_overlap, false) = false THEN
        RETURN jsonb_build_object('success', false, 'code', 'OVERLAP_CONFIRM_REQUIRED',
            'referenceAt', v_reference, 'referenceKind',
            CASE WHEN COALESCE(v_a->>'actualEndTime', '') <> '' THEN 'actual' ELSE 'planned' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Staff" WHERE id = p_to_ktv AND status = 'ĐANG LÀM') THEN
        RAISE EXCEPTION 'KTV B không khả dụng';
    END IF;
    v_old_ktv := v_b->>'ktvId';
    SELECT * INTO v_turn FROM "TurnQueue"
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date FOR UPDATE;
    IF NOT FOUND OR (p_to_ktv IS DISTINCT FROM v_old_ktv
       AND (v_turn.status <> 'waiting' OR v_turn.current_order_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'KTV B không còn rảnh; tải lại sổ tua';
    END IF;
    IF EXISTS (SELECT 1 FROM "KtvAssignments"
               WHERE employee_id = p_to_ktv AND business_date = v_a_assignment.business_date
                 AND status = 'ACTIVE' AND (booking_item_id <> p_item_id OR segment_id IS DISTINCT FROM v_b->>'id')) THEN
        RAISE EXCEPTION 'KTV B đang có phân công khác';
    END IF;
    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id = p_to_ktv
      AND ka.status = 'ACTIVE' AND (ka.booking_item_id <> p_item_id OR ka.segment_id IS DISTINCT FROM v_b->>'id')
      AND ka.planned_start_time < v_end_at AND ka.planned_end_time > p_planned_start_at) THEN
        RAISE EXCEPTION 'KTV B has another overlapping assignment';
    END IF;
    v_b_id := CASE WHEN p_to_ktv = v_old_ktv THEN v_b->>'id' ELSE gen_random_uuid()::text END;
    v_new_b := jsonb_build_object(
        'id', v_b_id, 'ktvId', p_to_ktv, 'sequenceSlot', 2,
        'roomId', v_a->'roomId', 'bedId', v_a->'bedId',
        'plannedStartAt', p_planned_start_at, 'plannedEndAt', v_end_at,
        'startTime', to_char(p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'endTime', to_char(v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'duration', p_duration_minutes);
    IF v_b IS NOT NULL THEN
        IF p_to_ktv = v_old_ktv THEN
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b_id THEN v_new_b ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        ELSE
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                                  THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
            v_segments := v_segments || jsonb_build_array(v_new_b);
            UPDATE "KtvAssignments" SET status = 'CANCELLED'
            WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
            DELETE FROM "TurnLedger" tl USING "Bookings" booking
            WHERE booking.id = p_booking_id AND tl.date = v_a_assignment.business_date
              AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
              AND tl.employee_id = v_old_ktv
              AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                              JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                              WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                                AND ka.business_date = tl.date AND ka.employee_id = v_old_ktv
                                AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
            PERFORM promote_next_assignment(v_old_ktv, v_a_assignment.business_date);
        END IF;
    ELSE
        v_segments := v_segments || jsonb_build_array(v_new_b);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET segments = v_segments,
        "technicianCodes" = array_append(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id,
        segment_id, planned_start_time, planned_end_time, room_id, bed_id, status, dispatch_source)
    VALUES (p_to_ktv, v_a_assignment.business_date, p_booking_id, p_item_id, v_b_id,
        p_planned_start_at, v_end_at, v_a->>'roomId', v_a->>'bedId', 'ACTIVE', 'SEQUENTIAL_SLOT_B')
    ON CONFLICT (employee_id, booking_item_id) DO UPDATE SET
        segment_id = EXCLUDED.segment_id, planned_start_time = EXCLUDED.planned_start_time,
        planned_end_time = EXCLUDED.planned_end_time, status = 'ACTIVE',
        dispatch_source = EXCLUDED.dispatch_source;
    UPDATE "TurnQueue" SET status = 'assigned', current_order_id = p_booking_id,
        booking_item_id = p_item_id, booking_item_ids = ARRAY[p_item_id]::text[],
        room_id = v_a->>'roomId', bed_id = v_a->>'bedId',
        start_time = (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time = (v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date;
    INSERT INTO "TurnLedger" (date, booking_id, employee_id, source)
    SELECT v_a_assignment.business_date, COALESCE(parent_booking_id, id), p_to_ktv, 'DISPATCH_CONFIRM'
    FROM "Bookings" WHERE id = p_booking_id
    ON CONFLICT (date, booking_id, employee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'segmentId', v_b_id);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_finish_sequential_after_a(p_booking_id text, p_item_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_date date;
BEGIN
    PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Dịch vụ đã thay đổi'; END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Không phải dịch vụ nối tiếp'; END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF COALESCE(v_a->>'actualStartTime', '') = '' OR COALESCE(v_a->>'actualEndTime', '') = ''
       OR COALESCE(v_b->>'actualStartTime', '') <> '' THEN
        RAISE EXCEPTION 'Chỉ kết thúc sau A khi A đã xong và B chưa bắt đầu';
    END IF;
    IF v_b IS NOT NULL THEN
        v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                              THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                       FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        SELECT business_date INTO v_date FROM "KtvAssignments"
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE'
        LIMIT 1 FOR UPDATE;
        UPDATE "KtvAssignments" SET status = 'CANCELLED'
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
        DELETE FROM "TurnLedger" tl USING "Bookings" booking
        WHERE booking.id = p_booking_id AND tl.date = v_date
          AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
          AND tl.employee_id = v_b->>'ktvId'
          AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                          JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                          WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                            AND ka.business_date = tl.date AND ka.employee_id = v_b->>'ktvId'
                            AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
        IF v_date IS NOT NULL THEN PERFORM promote_next_assignment(v_b->>'ktvId', v_date); END IF;
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET options = v_options || '{"finishedAfterA":true}'::jsonb,
        segments = v_segments, status = 'CLEANING', "timeEnd" = clock_timestamp(),
        "technicianCodes" = array_remove("technicianCodes", v_b->>'ktvId')
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    PERFORM dispatch_recompute_booking_status(p_booking_id);
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_apply_edit(p_booking_id text, p_action text, p_payload jsonb, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  edit jsonb;
  item_row "BookingItems"%ROWTYPE;
  result jsonb;
  item_updates jsonb := COALESCE(p_payload->'itemUpdates', '[]');
  opts jsonb;
  segment jsonb;
  old_segment jsonb;
  segment_list jsonb;
  plan_day date;
  plan_start timestamptz;
  normal_updates jsonb := '[]';
  live_ids text[] := ARRAY[]::text[];
  service_day date;
  guest_patch jsonb;
  guest_row "BookingGuests"%ROWTYPE;
  staff_id text;
  next_position integer;
  next_checkin integer;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH','ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A','EDIT_ACTUAL_TIME') THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn; tải lại bảng'; END IF;
  IF p_action IN ('ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A') THEN
    item_updates := jsonb_build_array(jsonb_build_object('id', p_payload->>'itemId',
      'options', jsonb_build_object('dispatchRevision', p_payload->'expectedRevision')));
  END IF;
  FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) ORDER BY value->>'id' LOOP
    SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dịch vụ không thuộc đơn; tải lại bảng'; END IF;
    IF COALESCE((jsonb_unwrap_string(item_row.options)->>'dispatchRevision')::bigint, 0)
       <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint, 0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Tải lại đơn trước khi chỉnh tiếp; bản cũ chưa được lưu.';
    END IF;
  END LOOP;
  -- All revision checks above must pass before guest/count/queue business writes.
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id = p_booking_id;
  IF service_day IS NULL THEN RAISE EXCEPTION 'Missing booking service day'; END IF;
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'date' AND NULLIF(p_payload->>'date','')::date IS DISTINCT FROM service_day THEN
      RAISE EXCEPTION 'Dispatch date differs from booking service day';
    END IF;
    p_payload := p_payload || jsonb_build_object('date',service_day);
    IF p_payload ? 'guestCount' THEN
      IF (p_payload->>'guestCount')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid guest count'; END IF;
      UPDATE "Bookings" SET "guestCount" = (p_payload->>'guestCount')::integer WHERE id = p_booking_id;
    END IF;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'newGuests','[]')) LOOP
      IF guest_patch->>'booking_id' IS DISTINCT FROM p_booking_id OR COALESCE(guest_patch->>'id','') = '' THEN
        RAISE EXCEPTION 'Invalid new guest';
      END IF;
      INSERT INTO "BookingGuests" (id,booking_id,guest_index,guest_label,status)
        VALUES (guest_patch->>'id',p_booking_id,(guest_patch->>'guest_index')::integer,guest_patch->>'guest_label','PENDING');
    END LOOP;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      IF edit ? 'guest_id' THEN
        IF NOT EXISTS (SELECT 1 FROM "BookingGuests" WHERE id = edit->>'guest_id' AND booking_id = p_booking_id) THEN
          RAISE EXCEPTION 'Guest does not belong to booking';
        END IF;
        UPDATE "BookingItems" SET guest_id = edit->>'guest_id' WHERE id = edit->>'id' AND "bookingId" = p_booking_id;
      END IF;
    END LOOP;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'guestUpdates','[]')) LOOP
      SELECT * INTO guest_row FROM "BookingGuests" WHERE id = guest_patch->>'id' AND booking_id = p_booking_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Guest update target changed'; END IF;
      guest_patch := (guest_patch - 'id') ||
        CASE WHEN guest_patch ? 'bedId' THEN jsonb_build_object('bed_id',guest_patch->'bedId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'roomId' THEN jsonb_build_object('room_id',guest_patch->'roomId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'focusArea' THEN jsonb_build_object('focus_area',guest_patch->'focusArea') ELSE '{}' END;
      SELECT * INTO guest_row FROM jsonb_populate_record(guest_row,guest_patch - ARRAY['bedId','roomId','focusArea']);
      UPDATE "BookingGuests" SET bed_id = guest_row.bed_id, room_id = guest_row.room_id,
        status = guest_row.status, notes = guest_row.notes, focus_area = guest_row.focus_area WHERE id = guest_row.id;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND jsonb_array_length(COALESCE(p_payload->'turnStaffIds','[]')) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('TurnQueue-tail:' || service_day::text));
    SELECT COALESCE(max(queue_position),0),COALESCE(max(check_in_order),0) INTO next_position,next_checkin FROM "TurnQueue" WHERE date = service_day;
    FOR staff_id IN SELECT DISTINCT value FROM jsonb_array_elements_text(p_payload->'turnStaffIds') ORDER BY value LOOP
      next_position := next_position + 1; next_checkin := next_checkin + 1;
      INSERT INTO "TurnQueue" (employee_id,date,status,queue_position,check_in_order,turns_completed)
        VALUES (staff_id,service_day,'waiting',next_position,next_checkin,0) ON CONFLICT (employee_id,date) DO NOTHING;
    END LOOP;
  END IF;
  PERFORM set_config('app.dispatch_action', p_action, true);
  PERFORM set_config('app.dispatch_actor', COALESCE(p_actor, 'null')::text, true);
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'confirmedOverlapItemIds' AND jsonb_typeof(p_payload->'confirmedOverlapItemIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Danh sách xác nhận chồng giờ không hợp lệ';
    END IF;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' = '2'
         AND item_row.status IN ('PREPARING','READY','IN_PROGRESS') THEN
        PERFORM dispatch_save_sequential_update(p_booking_id,edit,
          COALESCE(p_payload->'confirmedOverlapItemIds', '[]'::jsonb) ? item_row.id
          OR (jsonb_array_length(item_updates) = 1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false)));
        live_ids := array_append(live_ids,item_row.id);
      ELSE
        normal_updates := normal_updates || jsonb_build_array(edit);
      END IF;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND cardinality(live_ids) > 0 AND jsonb_array_length(normal_updates) = 0 THEN
    result := '{"success":true}';
  ELSIF p_action = 'DISPATCH' THEN
    result := dispatch_confirm_booking(p_booking_id, (p_payload->>'date')::date,
      COALESCE(p_payload->>'status', 'PREPARING'), p_payload->>'technicianCode', p_payload->>'bedId',
      p_payload->>'roomName', p_payload->>'notes', COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(p_payload->'staffAssignments','[]'))
        WHERE NOT (value->>'bookingItemId' = ANY(live_ids))), '[]'), normal_updates);
    IF COALESCE((result->>'success')::boolean, false) = false THEN RAISE EXCEPTION '%', COALESCE(result->>'error', 'Điều phối chưa được lưu'); END IF;
  ELSIF p_action = 'EDIT_ACTUAL_TIME' THEN
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_array_length(edit->'segments') <> jsonb_array_length(jsonb_unwrap_string(item_row.segments))
         OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(edit->'segments')) <> jsonb_array_length(edit->'segments') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; tải lại đơn';
      END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(edit->'segments') LOOP
        SELECT value INTO old_segment FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments))
        WHERE value->>'id' = segment->>'id';
        IF old_segment IS NULL OR (old_segment - 'actualStartTime' - 'actualEndTime')
           IS DISTINCT FROM (segment - 'actualStartTime' - 'actualEndTime')
           OR (old_segment->>'voided' = 'true' AND old_segment IS DISTINCT FROM segment)
           OR (COALESCE(old_segment->>'actualStartTime', '') <> '' AND COALESCE(segment->>'actualStartTime', '') = '')
           OR (COALESCE(old_segment->>'actualEndTime', '') <> '' AND COALESCE(segment->>'actualEndTime', '') = '') THEN
          RAISE EXCEPTION 'Chỉ chỉnh giờ thực tế, không xóa mốc hoặc đổi chặng đã lưu';
        END IF;
        IF COALESCE(segment->>'actualEndTime', '') <> '' AND
           (COALESCE(segment->>'actualStartTime', '') = '' OR
            (segment->>'actualEndTime')::timestamptz < (segment->>'actualStartTime')::timestamptz) THEN
          RAISE EXCEPTION 'Giờ kết thúc phải sau giờ bắt đầu';
        END IF;
      END LOOP;
      -- The payload now matches the locked row apart from validated actual stamps.
      PERFORM set_config('app.sequential_rpc', '1', true);
      UPDATE "BookingItems" SET segments = edit->'segments' WHERE id = edit->>'id';
      PERFORM set_config('app.sequential_rpc', '', true);
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'DRAFT' THEN
    UPDATE "Bookings" SET "technicianCode" = CASE WHEN p_payload ? 'technicianCode' THEN p_payload->>'technicianCode' ELSE "technicianCode" END,
      "bedId" = p_payload->>'bedId', "roomName" = p_payload->>'roomName',
      notes = p_payload->>'notes', "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT COALESCE(jsonb_unwrap_string(options), '{}') INTO opts FROM "BookingItems" WHERE id = edit->>'id';
      segment_list := COALESCE(edit->'segments', (SELECT segments FROM "BookingItems" WHERE id = edit->>'id'));
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          SELECT value INTO old_segment FROM "BookingItems" bi, jsonb_array_elements(COALESCE(bi.segments, '[]'))
          WHERE bi.id = edit->>'id' AND value->>'id' = segment->>'id' LIMIT 1;
          IF COALESCE(segment->>'startTime', '') <> '' AND COALESCE(segment->>'duration', '') <> ''
             AND COALESCE(segment->>'actualStartTime', '') = ''
             AND (old_segment->'startTime' IS DISTINCT FROM segment->'startTime'
                  OR old_segment->'duration' IS DISTINCT FROM segment->'duration'
                  OR old_segment->'endTime' IS DISTINCT FROM segment->'endTime') THEN
            SELECT COALESCE(NULLIF(p_payload->>'date', '')::date,
              (NULLIF(old_segment->>'plannedStartAt', '')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
              (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = edit->>'id'
               AND segment_id = segment->>'id' LIMIT 1)) INTO plan_day;
            IF plan_day IS NOT NULL THEN
              plan_start := (plan_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
              segment_list := (SELECT jsonb_agg(CASE WHEN value->>'id' = segment->>'id' THEN value ||
                jsonb_build_object('plannedStartAt', plan_start, 'plannedEndAt',
                  plan_start + make_interval(mins => (segment->>'duration')::integer)) ELSE value END ORDER BY ord)
                FROM jsonb_array_elements(segment_list) WITH ORDINALITY a(value, ord));
            END IF;
          END IF;
        END LOOP;
      END IF;
      UPDATE "BookingItems" SET "roomName" = edit->>'roomName', "bedId" = edit->>'bedId',
        "technicianCodes" = ARRAY(SELECT jsonb_array_elements_text(COALESCE(edit->'technicianCodes', '[]'))),
        segments = segment_list, options = opts || COALESCE(jsonb_unwrap_string(edit->'options'), '{}'),
        guest_id = CASE WHEN edit ? 'guest_id' THEN edit->>'guest_id' ELSE guest_id END
      WHERE id = edit->>'id';
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' AND jsonb_unwrap_string(edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
         AND COALESCE(jsonb_unwrap_string(edit->'options')->>'mergedIntoId', '') = '' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          IF COALESCE(segment->>'ktvId', '') <> '' AND COALESCE(segment->>'startTime', '') <> '' THEN
            UPDATE "KtvAssignments" SET
              planned_start_time = (business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh',
              planned_end_time = ((business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                + make_interval(mins => (segment->>'duration')::integer)
            WHERE booking_id = p_booking_id AND booking_item_id = edit->>'id'
              AND segment_id = segment->>'id' AND status IN ('ACTIVE','QUEUED','READY')
              AND COALESCE(segment->>'actualStartTime', '') = '';
            UPDATE "TurnQueue" SET start_time = (segment->>'startTime')::time,
              estimated_end_time = COALESCE(NULLIF(segment->>'endTime', '')::time, estimated_end_time)
            WHERE employee_id = segment->>'ktvId' AND current_order_id = p_booking_id AND status = 'assigned';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'ENABLE_SEQUENTIAL' THEN
    result := dispatch_enable_sequential_item(p_booking_id, p_payload->>'itemId');
  ELSIF p_action = 'ASSIGN_B' THEN
    IF p_payload ? 'metadata' AND (jsonb_typeof(p_payload->'metadata') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'serviceNamesForKtvs') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'notesForKtvs') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM (
                    SELECT value FROM jsonb_each(p_payload->'metadata'->'serviceNamesForKtvs')
                    UNION ALL SELECT value FROM jsonb_each(p_payload->'metadata'->'notesForKtvs')) entries
                  WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')) THEN
      RAISE EXCEPTION 'Tên/ghi chú B không hợp lệ';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id, p_payload->>'itemId', p_payload->>'toKtvId',
      (p_payload->>'plannedStartAt')::timestamptz, (p_payload->>'durationMinutes')::integer,
      COALESCE((p_payload->>'confirmOverlap')::boolean, false));
    IF COALESCE((result->>'success')::boolean, false) AND p_payload ? 'metadata' THEN
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options), '{}') ||
        jsonb_build_object('serviceNamesForKtvs', p_payload->'metadata'->'serviceNamesForKtvs',
                          'notesForKtvs', p_payload->'metadata'->'notesForKtvs')
      WHERE id = p_payload->>'itemId' AND "bookingId" = p_booking_id;
    END IF;
  ELSE
    result := dispatch_finish_sequential_after_a(p_booking_id, p_payload->>'itemId');
  END IF;
  PERFORM set_config('app.dispatch_action', '', true);
  PERFORM set_config('app.dispatch_actor', '', true);
  RETURN result || jsonb_build_object('revisions', (SELECT jsonb_object_agg(id,
    COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint, 0)) FROM "BookingItems"
    WHERE "bookingId" = p_booking_id AND id IN (SELECT value->>'id' FROM jsonb_array_elements(item_updates))));
END;
$$;
REVOKE ALL ON FUNCTION dispatch_recompute_booking_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_recompute_booking_status(text) TO service_role;
REVOKE ALL ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb) TO service_role;
REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927120000', 'sequential_operational_consistency') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927150000_sequential_scoped_lifecycle ─────────────────────────────
-- Scope lifecycle changes to selected A/B slots; audit/queue/status commit together.
CREATE OR REPLACE FUNCTION dispatch_sequential_lifecycle_atomic(
  p_booking_id text, p_item_id text, p_expected jsonb, p_patch jsonb,
  p_action text, p_actor jsonb, p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b "Bookings"%ROWTYPE; item "BookingItems"%ROWTYPE; patched "BookingItems"%ROWTYPE;
  old_segments jsonb; new_segments jsonb; old_seg jsonb; seg jsonb; field text;
  service_day date; family_id text; employee text; assigned timestamptz;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('PAUSE','RESUME','FINISH','CANCEL','SWAP') OR p_expected_revision IS NULL
     OR NOT p_patch ?& ARRAY['segments','options','status','pauseStart','timeEnd','technicianCodes']
     OR jsonb_typeof(p_patch->'segments') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_patch->'options') IS DISTINCT FROM 'object'
     OR (p_patch - ARRAY['segments','options','status','pauseStart','timeEnd','technicianCodes']) <> '{}' THEN
    RAISE EXCEPTION 'Invalid scoped lifecycle request';
  END IF;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'Booking changed; reload'; END IF;
  PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
  SELECT * INTO item FROM "BookingItems" WHERE id = p_item_id AND "bookingId" = p_booking_id;
  IF NOT FOUND OR jsonb_unwrap_string(item.options)->>'sequentialSlots' IS DISTINCT FROM '2'
     OR (item.status::text NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED') AND NOT (p_action='CANCEL' AND item.status::text IN ('CLEANING','FEEDBACK')))
     OR COALESCE((jsonb_unwrap_string(item.options)->>'dispatchRevision')::bigint,0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã có bản lưu mới hoặc đã đóng; tải lại đơn';
  END IF;
  IF NOT p_expected ?& ARRAY['id','bookingId','status','segments','options','pauseStart','timeEnd','technicianCodes'] THEN
    RAISE EXCEPTION 'Incomplete lifecycle snapshot';
  END IF;
  FOR field IN SELECT jsonb_object_keys(p_expected) LOOP
    IF (CASE WHEN field IN ('pauseStart','timeEnd')
      THEN (to_jsonb(item)->>field)::timestamptz IS DISTINCT FROM (p_expected->>field)::timestamptz
      ELSE to_jsonb(item)->field IS DISTINCT FROM p_expected->field END) THEN
      RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi thao tác';
    END IF;
  END LOOP;
  service_day := b."bookingDate"::date;
  family_id := COALESCE(b.parent_booking_id,b.id);
  IF service_day IS NULL THEN RAISE EXCEPTION 'Missing booking service day'; END IF;
  old_segments := jsonb_unwrap_string(item.segments);
  new_segments := p_patch->'segments';
  -- No stale operation may rewrite another employee's recorded start/end.
  FOR old_seg IN SELECT value FROM jsonb_array_elements(old_segments) LOOP
    SELECT value INTO seg FROM jsonb_array_elements(new_segments) WHERE value->>'id' = old_seg->>'id';
    IF seg IS NULL OR (COALESCE(old_seg->>'actualStartTime','') <> '' AND seg->'actualStartTime' IS DISTINCT FROM old_seg->'actualStartTime')
       OR (COALESCE(old_seg->>'actualEndTime','') <> '' AND seg->'actualEndTime' IS DISTINCT FROM old_seg->'actualEndTime') THEN
      RAISE EXCEPTION 'Recorded times cannot be rewritten by lifecycle actions';
    END IF;
  END LOOP;
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action',p_action,true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  SELECT * INTO patched FROM jsonb_populate_record(item,p_patch);
  UPDATE "BookingItems" SET segments=patched.segments, options=patched.options, status=patched.status,
    "pauseStart"=patched."pauseStart", "timeEnd"=patched."timeEnd", "technicianCodes"=patched."technicianCodes" WHERE id=p_item_id;

  FOR seg IN SELECT value FROM jsonb_array_elements(new_segments) LOOP
    SELECT value INTO old_seg FROM jsonb_array_elements(old_segments) WHERE value->>'id'=seg->>'id';
    employee := seg->>'ktvId';
    IF old_seg IS NOT NULL AND old_seg IS DISTINCT FROM seg
       AND seg->>'note' IN ('CHANGED','CANCELLED_NO_CREDIT','CANCELLED_WITH_CREDIT','EARLY_LEAVE_NOT_STARTED') THEN
      -- Started cancellation still owes physical cleaning/handover; credit is handled separately below.
      IF NOT (seg->>'note' IN ('CANCELLED_NO_CREDIT','CANCELLED_WITH_CREDIT')
        AND COALESCE(seg->>'actualStartTime','') <> '' AND COALESCE(seg->>'handoverTime','') = '') THEN
        UPDATE "KtvAssignments" SET status='CANCELLED',updated_at=clock_timestamp()
          WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=employee AND segment_id=seg->>'id'
            AND status IN ('ACTIVE','QUEUED','READY','COMPLETED');
        IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id=employee AND booking_item_id=p_item_id AND status IN ('ACTIVE','QUEUED','READY')) THEN
          UPDATE "TurnQueue" SET booking_item_ids=array_remove(COALESCE(booking_item_ids,ARRAY[]::text[]),p_item_id),
            booking_item_id=CASE WHEN booking_item_id=p_item_id THEN NULL ELSE booking_item_id END
            WHERE employee_id=employee AND date=service_day AND current_order_id=p_booking_id;
          UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL
            WHERE employee_id=employee AND date=service_day AND current_order_id=p_booking_id
              AND cardinality(COALESCE(booking_item_ids,ARRAY[]::text[]))=0 AND booking_item_id IS NULL;
          IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id=employee AND business_date=service_day AND status='ACTIVE') THEN
            PERFORM promote_next_assignment(employee,service_day);
          END IF;
        END IF;
      END IF;
      IF COALESCE(seg->>'voided','false')='true' AND NOT EXISTS (
        SELECT 1 FROM "BookingItems" bi JOIN "Bookings" family ON family.id=bi."bookingId",
          jsonb_array_elements(jsonb_unwrap_string(bi.segments)) work
        WHERE COALESCE(family.parent_booking_id,family.id)=family_id AND bi.status::text <> 'CANCELLED'
          AND work->>'ktvId'=employee AND COALESCE(work->>'voided','false') <> 'true') THEN
        UPDATE "TurnLedger" SET is_punished=true WHERE date=service_day AND booking_id=family_id AND employee_id=employee;
      END IF;
    ELSIF old_seg IS NULL THEN
      IF p_action <> 'SWAP' OR NOT EXISTS (SELECT 1 FROM "Staff" WHERE id=employee) THEN RAISE EXCEPTION 'Invalid replacement employee'; END IF;
      IF EXISTS (SELECT 1 FROM "TurnQueue" WHERE employee_id=employee AND date=service_day
        AND current_order_id IS NOT NULL AND current_order_id <> p_booking_id AND status='working') THEN
        RAISE EXCEPTION 'Nhân viên thay thế đang làm đơn khác';
      END IF;
      assigned := (seg->>'plannedStartAt')::timestamptz;
      INSERT INTO "KtvAssignments" (employee_id,business_date,booking_id,booking_item_id,segment_id,status,dispatch_source,
        planned_start_time,planned_end_time,room_id,bed_id)
        VALUES(employee,service_day,p_booking_id,p_item_id,seg->>'id','ACTIVE','SWAP_KTV',assigned,
          (seg->>'plannedEndAt')::timestamptz,seg->>'roomId',seg->>'bedId')
        ON CONFLICT(employee_id,booking_item_id) DO UPDATE SET segment_id=EXCLUDED.segment_id,status='ACTIVE',
          planned_start_time=EXCLUDED.planned_start_time,planned_end_time=EXCLUDED.planned_end_time,
          room_id=EXCLUDED.room_id,bed_id=EXCLUDED.bed_id,updated_at=clock_timestamp();
      UPDATE "TurnQueue" SET status='assigned',current_order_id=p_booking_id,booking_item_id=p_item_id,
        booking_item_ids=ARRAY(SELECT DISTINCT unnest(COALESCE(booking_item_ids,ARRAY[]::text[]) || ARRAY[p_item_id])),
        start_time=(seg->>'startTime')::time,estimated_end_time=(seg->>'endTime')::time,
        room_id=seg->>'roomId',bed_id=seg->>'bedId' WHERE employee_id=employee AND date=service_day;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM "Staff" WHERE id=employee AND work_type='TYPE_C') THEN
        INSERT INTO "TurnQueue"(employee_id,date,status,current_order_id,booking_item_id,booking_item_ids,queue_position,turns_completed)
          VALUES(employee,service_day,'assigned',p_booking_id,p_item_id,ARRAY[p_item_id],
            (SELECT COALESCE(max(queue_position),0)+1 FROM "TurnQueue" WHERE date=service_day),0);
      ELSIF NOT FOUND THEN RAISE EXCEPTION 'Nhân viên thay thế chưa có trong sổ tua ngày dịch vụ'; END IF;
      IF EXISTS(SELECT 1 FROM "Staff" WHERE id=employee AND COALESCE(work_type,'TYPE_A') <> 'TYPE_D') THEN
        INSERT INTO "TurnLedger"(date,booking_id,employee_id,source,is_punished) VALUES(service_day,family_id,employee,'SWAP_KTV',false)
          ON CONFLICT(date,booking_id,employee_id) DO UPDATE SET is_punished=false;
      END IF;
    END IF;
  END LOOP;
  IF p_action='CANCEL' AND patched.status::text='CANCELLED' THEN
    UPDATE "Bookings" SET "totalAmount"=GREATEST(0,COALESCE("totalAmount",0)-COALESCE(item.price,0)*COALESCE(item.quantity,1)) WHERE id=p_booking_id;
  END IF;
  PERFORM dispatch_recompute_booking_status(p_booking_id);
  IF NOT EXISTS(SELECT 1 FROM "BookingItems" WHERE "bookingId"=p_booking_id AND status::text <> 'CANCELLED') THEN
    UPDATE "Bookings" SET status='CANCELLED' WHERE id=p_booking_id;
  END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id;
  RETURN jsonb_build_object('success',true,'item',to_jsonb(item));
END $$;
REVOKE ALL ON FUNCTION dispatch_sequential_lifecycle_atomic(text,text,jsonb,jsonb,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_sequential_lifecycle_atomic(text,text,jsonb,jsonb,text,jsonb,bigint) TO service_role;

CREATE OR REPLACE FUNCTION guard_sequential_item_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_old_options jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}'::jsonb);
    v_new_options jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}'::jsonb);
    v_old_segments jsonb := COALESCE(jsonb_unwrap_string(OLD.segments), '[]'::jsonb);
    v_new_segments jsonb := COALESCE(jsonb_unwrap_string(NEW.segments), '[]'::jsonb);
    v_old jsonb;
    v_in jsonb;
    v_out jsonb := '[]'::jsonb;
    v_a_done boolean;
    v_b_done boolean;
    v_is_draft boolean;
BEGIN
    IF v_old_options->>'sequentialSlots' IS DISTINCT FROM '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RETURN NEW; END IF;
    v_is_draft := OLD.status IN ('NEW', 'WAITING') AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_old_segments) s
        WHERE COALESCE(s->>'actualStartTime', '') <> '' OR COALESCE(s->>'actualEndTime', '') <> '');
    IF NOT v_is_draft AND v_old_options->>'sequentialSlots' = '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Không được bỏ chế độ nối tiếp qua lưu đơn cũ';
    END IF;
    IF v_old_options->>'finishedAfterA' = 'true' AND v_new_options->>'finishedAfterA' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Dịch vụ đã kết thúc sau A; tải lại đơn';
    END IF;
    IF v_old_options->>'finishedAfterA' IS DISTINCT FROM 'true'
       AND v_new_options->>'finishedAfterA' = 'true'
       AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'Chỉ được kết thúc sau A qua thao tác quầy';
    END IF;
    IF jsonb_typeof(v_new_segments) <> 'array' THEN RAISE EXCEPTION 'Segments nối tiếp không hợp lệ'; END IF;
    IF NOT v_is_draft AND v_old_options->>'sequentialSlots' = '2' AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        FOR v_old IN SELECT value FROM jsonb_array_elements(v_old_segments) LOOP
            SELECT value INTO v_in FROM jsonb_array_elements(v_new_segments)
            WHERE value->>'id' = v_old->>'id' LIMIT 1;
            IF v_in IS NULL THEN v_in := v_old; END IF;
            IF COALESCE(v_old->>'voided', 'false') = 'true' THEN
                IF COALESCE(v_in->>'actualStartTime', '') <> COALESCE(v_old->>'actualStartTime', '') THEN
                    RAISE EXCEPTION 'Lượt KTV đã được thay; tải lại đơn';
                END IF;
                -- Only post-service evidence may be added to cancelled work; never revive it.
                IF v_old->>'note' = 'CANCELLED_NO_CREDIT'
                   AND COALESCE(v_old->>'actualStartTime','') <> '' AND COALESCE(v_old->>'actualEndTime','') <> '' THEN
                    v_old := v_old || COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(v_in)
                      WHERE key IN ('handoverTime','handoverPhotoUrls','feedbackTime','reviewTime')), '{}');
                END IF;
                v_out := v_out || jsonb_build_array(v_old);
                CONTINUE;
            END IF;
            -- Assignment/slot changes belong to the locked RPC. A stale KTV write
            -- must not revive a replaced B or move either slot's planned time.
            v_in := v_in || jsonb_build_object(
                'ktvId', v_old->'ktvId', 'sequenceSlot', v_old->'sequenceSlot',
                'voided', v_old->'voided', 'roomId', v_old->'roomId',
                'bedId', v_old->'bedId', 'startTime', v_old->'startTime',
                'endTime', v_old->'endTime', 'duration', v_old->'duration',
                'plannedStartAt', v_old->'plannedStartAt',
                'plannedEndAt', v_old->'plannedEndAt');
            IF COALESCE(v_old->>'actualStartTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualStartTime}', v_old->'actualStartTime', true);
            END IF;
            IF COALESCE(v_old->>'actualEndTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualEndTime}', v_old->'actualEndTime', true);
            END IF;
            v_out := v_out || jsonb_build_array(v_in);
        END LOOP;
        NEW.segments := v_out;
        v_new_segments := v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
               WHERE COALESCE(s->>'voided', 'false') <> 'true'
                 AND COALESCE(s->>'actualEndTime', '') <> ''
                 AND COALESCE(s->>'actualStartTime', '') = '') THEN
        RAISE EXCEPTION 'Không thể kết thúc lượt KTV chưa bắt đầu';
    END IF;
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_a_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '1' AND COALESCE(s->>'voided', 'false') <> 'true';
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_b_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'voided', 'false') <> 'true';
    IF current_setting('app.sequential_rpc',true) IS DISTINCT FROM '1'
       AND COALESCE(v_new_options->'closedSequentialSlots','[]') IS DISTINCT FROM COALESCE(v_old_options->'closedSequentialSlots','[]') THEN
        RAISE EXCEPTION 'Chỉ được đóng lượt A/B qua thao tác chọn phạm vi';
    END IF;
    IF NEW.status NOT IN ('CANCELLED','PAUSED','IN_PROGRESS','PREPARING','READY','WAITING','NEW')
       AND NOT ((v_a_done OR COALESCE(v_new_options->'closedSequentialSlots','[]') @> '[1]'::jsonb)
         AND (v_b_done OR COALESCE(v_new_options->'closedSequentialSlots','[]') @> '[2]'::jsonb
           OR (v_new_options->>'finishedAfterA' = 'true' AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_new_segments) s WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'actualStartTime','') <> '')))
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
           WHERE COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'ktvId','') <> ''
             AND (COALESCE(s->>'actualStartTime','')='' OR COALESCE(s->>'actualEndTime','')=''))) THEN
        RAISE EXCEPTION 'Dịch vụ nối tiếp còn lượt chưa hoàn tất';
    END IF;
    RETURN NEW;
END;
$$;

-- Latest saved plan is the edit baseline; audit and optimistic locking are atomic.
-- Requires jsonb_unwrap_string and the sequential RPCs. No shared DB application here.
CREATE OR REPLACE FUNCTION dispatch_edit_snapshot(p_segments jsonb, p_options jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'segments', COALESCE((SELECT jsonb_object_agg(s->>'id', jsonb_strip_nulls(jsonb_build_object(
      'ktvId', s->'ktvId', 'sequenceSlot', s->'sequenceSlot', 'startTime', s->'startTime',
      'endTime', s->'endTime', 'duration', s->'duration', 'plannedStartAt', s->'plannedStartAt',
      'plannedEndAt', s->'plannedEndAt', 'actualStartTime', s->'actualStartTime',
      'actualEndTime', s->'actualEndTime', 'voided', s->'voided', 'pauses', s->'pauses')))
      FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(p_segments), '[]')) s WHERE s->>'id' IS NOT NULL), '{}'),
    'names', COALESCE(NULLIF(jsonb_unwrap_string(p_options)->'serviceNamesForKtvs', 'null'), '{}'),
    'displayName', jsonb_unwrap_string(p_options)->'displayName');
$$;

CREATE OR REPLACE FUNCTION keep_dispatch_edit_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_opts jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}');
  new_opts jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}');
  before_state jsonb;
  after_state jsonb;
  changes jsonb := '[]';
  old_seg jsonb;
  new_seg jsonb;
  segment_id text;
  field_name text;
  employee_id text;
  revision bigint := COALESCE((old_opts->>'dispatchRevision')::bigint, 0);
  action_name text := NULLIF(current_setting('app.dispatch_action', true), '');
  actor jsonb := COALESCE(NULLIF(current_setting('app.dispatch_actor', true), '')::jsonb, 'null');
BEGIN
  -- A background writer holding old options must not undo a saved service name.
  IF action_name IS NULL AND COALESCE((new_opts->>'dispatchRevision')::bigint, 0) < revision THEN
    new_opts := (new_opts - 'serviceNamesForKtvs' - 'displayName') ||
      jsonb_build_object('serviceNamesForKtvs', COALESCE(old_opts->'serviceNamesForKtvs', '{}'),
                         'displayName', old_opts->'displayName');
  END IF;
  before_state := dispatch_edit_snapshot(OLD.segments, old_opts);
  after_state := dispatch_edit_snapshot(NEW.segments, new_opts);
  FOR segment_id IN SELECT jsonb_object_keys(before_state->'segments') UNION SELECT jsonb_object_keys(after_state->'segments') LOOP
    old_seg := before_state->'segments'->segment_id;
    new_seg := after_state->'segments'->segment_id;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided','pauses']) LOOP
      IF old_seg->field_name IS DISTINCT FROM new_seg->field_name THEN
        changes := changes || jsonb_build_array(jsonb_build_object('segmentId', segment_id,
          'employeeId', COALESCE(new_seg->>'ktvId', old_seg->>'ktvId'), 'field', field_name,
          'before', old_seg->field_name, 'after', new_seg->field_name));
      END IF;
    END LOOP;
  END LOOP;
  FOR employee_id IN SELECT jsonb_object_keys(before_state->'names') UNION SELECT jsonb_object_keys(after_state->'names') LOOP
    IF before_state->'names'->employee_id IS DISTINCT FROM after_state->'names'->employee_id THEN
      changes := changes || jsonb_build_array(jsonb_build_object('employeeId', employee_id,
        'field', 'serviceNameForKtv', 'before', before_state->'names'->employee_id, 'after', after_state->'names'->employee_id));
    END IF;
  END LOOP;
  IF before_state->'displayName' IS DISTINCT FROM after_state->'displayName' THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'displayName',
      'before', before_state->'displayName', 'after', after_state->'displayName'));
  END IF;
  new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
    'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]'));
  -- Preserve counter entries that arrived while the form was open, plus new entries.
  IF old_opts ? 'counterLog' OR new_opts ? 'counterLog' THEN
    new_opts := jsonb_set(new_opts, '{counterLog}', COALESCE((SELECT jsonb_agg(value ORDER BY first_pos)
      FROM (SELECT value, min(ord) first_pos FROM jsonb_array_elements(
        COALESCE(old_opts->'counterLog', '[]') || COALESCE(new_opts->'counterLog', '[]')) WITH ORDINALITY a(value, ord)
        GROUP BY value) unique_entries), '[]'));
  END IF;
  IF changes <> '[]' OR action_name IS NOT NULL THEN
    revision := revision + 1;
    new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
      'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]') || jsonb_build_array(jsonb_build_object(
        'revision', revision, 'at', clock_timestamp(), 'action', COALESCE(action_name, 'UPDATE'),
        'actor', actor, 'changes', changes)));
  END IF;
  NEW.options := new_opts;
  RETURN NEW;
END;
$$;


-- Service-role FINISH commit: all item/child writes and booking status share one transaction.
CREATE OR REPLACE FUNCTION ktv_finish_service_atomic(
    p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb,
    p_guest_ratings jsonb, p_updates jsonb, p_booking_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    booking_row "Bookings"%ROWTYPE;
    item_row "BookingItems"%ROWTYPE;
    snapshot jsonb;
    patch jsonb;
    field text;
    guests jsonb;
BEGIN
    IF jsonb_typeof(p_item_snapshots) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_guest_ratings) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_updates) = 0
       OR p_booking_status IS NULL
       OR p_booking_status NOT IN ('NEW','PREPARING','IN_PROGRESS','CLEANING','FEEDBACK','DONE') THEN
        RAISE EXCEPTION 'Invalid FINISH batch';
    END IF;
    SELECT * INTO booking_row FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    -- Match dispatch's lock order: booking, items by id, guests by id.
    PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
    PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
    IF p_booking_snapshot->>'id' IS DISTINCT FROM p_booking_id
       OR to_jsonb(booking_row)->'status' IS DISTINCT FROM p_booking_snapshot->'status'
       OR to_jsonb(booking_row)->'rating' IS DISTINCT FROM p_booking_snapshot->'rating' THEN
        RAISE EXCEPTION 'FINISH snapshot changed; reload booking';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rating',rating) ORDER BY id),'[]') INTO guests
      FROM "BookingGuests" WHERE booking_id = p_booking_id;
    IF guests IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(value ORDER BY value->>'id'),'[]') FROM jsonb_array_elements(p_guest_ratings)) THEN
        RAISE EXCEPTION 'FINISH ratings changed; reload booking';
    END IF;
    IF jsonb_array_length(p_item_snapshots) <> (SELECT count(*) FROM "BookingItems" WHERE "bookingId" = p_booking_id)
       OR jsonb_array_length(p_item_snapshots) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_item_snapshots))
       OR jsonb_array_length(p_updates) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_updates)) THEN
        RAISE EXCEPTION 'FINISH item set changed; reload booking';
    END IF;
    FOR snapshot IN SELECT value FROM jsonb_array_elements(p_item_snapshots) LOOP
        SELECT * INTO item_row FROM "BookingItems" WHERE id = snapshot->>'id' AND "bookingId" = p_booking_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'FINISH item not found'; END IF;
        -- Every field used by the handler must be present, not omitted by a malformed payload.
        IF NOT snapshot ?& ARRAY['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'] THEN
            RAISE EXCEPTION 'Incomplete FINISH snapshot';
        END IF;
        FOR field IN SELECT jsonb_object_keys(snapshot) LOOP
            IF (CASE WHEN field = 'handover_submitted_at'
                THEN item_row.handover_submitted_at IS DISTINCT FROM (snapshot->>field)::timestamptz
                ELSE to_jsonb(item_row)->field IS DISTINCT FROM snapshot->field END) THEN
                RAISE EXCEPTION 'FINISH item snapshot changed: %; reload booking', item_row.id;
            END IF;
        END LOOP;
    END LOOP;
    FOR patch IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_item_snapshots) s WHERE s->>'id' = patch->>'id')
           OR patch->>'status' IS NULL
           OR patch->>'status' NOT IN ('CANCELLED','DONE','IN_PROGRESS','PAUSED','CLEANING','FEEDBACK')
           OR NOT patch ? 'status'
           OR (patch - ARRAY['id','segments','status','handover_images','handover_status','handover_skipped','handover_submitted_at']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Invalid FINISH item update';
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') = 'string' THEN
            patch := jsonb_set(patch,'{segments}',(patch->>'segments')::jsonb);
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Invalid FINISH segments';
        END IF;
        SELECT * INTO item_row FROM "BookingItems" WHERE id = patch->>'id' AND "bookingId" = p_booking_id;
        SELECT * INTO item_row FROM jsonb_populate_record(item_row,patch - 'id');
        UPDATE "BookingItems" SET segments = item_row.segments, status = item_row.status,
            handover_images = item_row.handover_images, handover_status = item_row.handover_status,
            handover_skipped = item_row.handover_skipped, handover_submitted_at = item_row.handover_submitted_at
          WHERE id = item_row.id;
    END LOOP;
    SELECT * INTO booking_row FROM jsonb_populate_record(booking_row, jsonb_build_object('status', p_booking_status));
    UPDATE "Bookings" SET status = booking_row.status, "updatedAt" = now() WHERE id = p_booking_id RETURNING * INTO booking_row;
    RETURN jsonb_build_object('success',true,'booking',to_jsonb(booking_row));
END $$;
REVOKE ALL ON FUNCTION ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text) TO service_role;

-- Closed B cannot be revived through a later assignment.
CREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(
    p_booking_id text, p_item_id text, p_to_ktv text,
    p_planned_start_at timestamptz, p_duration_minutes integer, p_confirm_overlap boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_a_assignment "KtvAssignments"%ROWTYPE;
    v_turn "TurnQueue"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_new_b jsonb;
    v_reference timestamptz;
    v_old_ktv text;
    v_b_id text;
    v_end_at timestamptz;
    v_service_day date;
    v_expected_at timestamptz;
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT "bookingDate"::date INTO v_service_day FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF v_service_day IS NULL THEN RAISE EXCEPTION 'Missing service day'; END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND (COALESCE(value->>'voided', 'false') <> 'true'
      OR (COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb AND value->>'note'='CANCELLED_NO_CREDIT'))
    ORDER BY COALESCE(value->>'voided','false')='true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR (COALESCE(v_options->>'finishedAfterA', 'false') = 'true' OR COALESCE(v_options->'closedSequentialSlots','[]') @> '[2]'::jsonb)
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND (status IN ('ACTIVE', 'COMPLETED')
        OR (status='CANCELLED' AND COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb))
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công của A'; END IF;
    v_reference := COALESCE(NULLIF(v_a->>'actualEndTime', '')::timestamptz,
                            v_a_assignment.planned_end_time);
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND v_reference IS NOT NULL THEN
        IF v_a_assignment.planned_start_time IS NOT NULL
           AND v_reference <= v_a_assignment.planned_start_time THEN
            v_reference := v_reference + interval '1 day';
        END IF;
    END IF;
    v_expected_at := (v_service_day + (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < (v_a->>'startTime')::time THEN
        v_expected_at := v_expected_at + interval '1 day';
    END IF;
    IF p_planned_start_at IS DISTINCT FROM v_expected_at OR v_a_assignment.business_date <> v_service_day THEN
        RAISE EXCEPTION 'B must follow the booking service day; reload plan';
    END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'Giờ kết thúc của A chưa hợp lệ; hãy sửa mốc A'; END IF;
    IF p_planned_start_at < v_reference AND COALESCE(p_confirm_overlap, false) = false THEN
        RETURN jsonb_build_object('success', false, 'code', 'OVERLAP_CONFIRM_REQUIRED',
            'referenceAt', v_reference, 'referenceKind',
            CASE WHEN COALESCE(v_a->>'actualEndTime', '') <> '' THEN 'actual' ELSE 'planned' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Staff" WHERE id = p_to_ktv AND status = 'ĐANG LÀM') THEN
        RAISE EXCEPTION 'KTV B không khả dụng';
    END IF;
    v_old_ktv := v_b->>'ktvId';
    SELECT * INTO v_turn FROM "TurnQueue"
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date FOR UPDATE;
    IF NOT FOUND OR (p_to_ktv IS DISTINCT FROM v_old_ktv
       AND (v_turn.status <> 'waiting' OR v_turn.current_order_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'KTV B không còn rảnh; tải lại sổ tua';
    END IF;
    IF EXISTS (SELECT 1 FROM "KtvAssignments"
               WHERE employee_id = p_to_ktv AND business_date = v_a_assignment.business_date
                 AND status = 'ACTIVE' AND (booking_item_id <> p_item_id OR segment_id IS DISTINCT FROM v_b->>'id')) THEN
        RAISE EXCEPTION 'KTV B đang có phân công khác';
    END IF;
    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id = p_to_ktv
      AND ka.status = 'ACTIVE' AND (ka.booking_item_id <> p_item_id OR ka.segment_id IS DISTINCT FROM v_b->>'id')
      AND ka.planned_start_time < v_end_at AND ka.planned_end_time > p_planned_start_at) THEN
        RAISE EXCEPTION 'KTV B has another overlapping assignment';
    END IF;
    v_b_id := CASE WHEN p_to_ktv = v_old_ktv THEN v_b->>'id' ELSE gen_random_uuid()::text END;
    v_new_b := jsonb_build_object(
        'id', v_b_id, 'ktvId', p_to_ktv, 'sequenceSlot', 2,
        'roomId', v_a->'roomId', 'bedId', v_a->'bedId',
        'plannedStartAt', p_planned_start_at, 'plannedEndAt', v_end_at,
        'startTime', to_char(p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'endTime', to_char(v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'duration', p_duration_minutes);
    IF v_b IS NOT NULL THEN
        IF p_to_ktv = v_old_ktv THEN
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b_id THEN v_new_b ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        ELSE
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                                  THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
            v_segments := v_segments || jsonb_build_array(v_new_b);
            UPDATE "KtvAssignments" SET status = 'CANCELLED'
            WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
            DELETE FROM "TurnLedger" tl USING "Bookings" booking
            WHERE booking.id = p_booking_id AND tl.date = v_a_assignment.business_date
              AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
              AND tl.employee_id = v_old_ktv
              AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                              JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                              WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                                AND ka.business_date = tl.date AND ka.employee_id = v_old_ktv
                                AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
            PERFORM promote_next_assignment(v_old_ktv, v_a_assignment.business_date);
        END IF;
    ELSE
        v_segments := v_segments || jsonb_build_array(v_new_b);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET segments = v_segments,
        "technicianCodes" = array_append(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id,
        segment_id, planned_start_time, planned_end_time, room_id, bed_id, status, dispatch_source)
    VALUES (p_to_ktv, v_a_assignment.business_date, p_booking_id, p_item_id, v_b_id,
        p_planned_start_at, v_end_at, v_a->>'roomId', v_a->>'bedId', 'ACTIVE', 'SEQUENTIAL_SLOT_B')
    ON CONFLICT (employee_id, booking_item_id) DO UPDATE SET
        segment_id = EXCLUDED.segment_id, planned_start_time = EXCLUDED.planned_start_time,
        planned_end_time = EXCLUDED.planned_end_time, status = 'ACTIVE',
        dispatch_source = EXCLUDED.dispatch_source;
    UPDATE "TurnQueue" SET status = 'assigned', current_order_id = p_booking_id,
        booking_item_id = p_item_id, booking_item_ids = ARRAY[p_item_id]::text[],
        room_id = v_a->>'roomId', bed_id = v_a->>'bedId',
        start_time = (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time = (v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date;
    INSERT INTO "TurnLedger" (date, booking_id, employee_id, source)
    SELECT v_a_assignment.business_date, COALESCE(parent_booking_id, id), p_to_ktv, 'DISPATCH_CONFIRM'
    FROM "Bookings" WHERE id = p_booking_id
    ON CONFLICT (date, booking_id, employee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'segmentId', v_b_id);
END;
$$;

-- Release room duty after scoped cancellation without reopening a closed A/B slot.
CREATE OR REPLACE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item "BookingItems"%ROWTYPE; a "KtvAssignments"%ROWTYPE; v_segments jsonb; live_done jsonb;
  seg jsonb; images jsonb; changed_dates date[] := '{}'; day date; count_done integer := 0;
  now_at timestamptz := clock_timestamp(); b "Bookings"%ROWTYPE; promotion jsonb;
  opts jsonb; all_done boolean; all_handed boolean; rated boolean; next_status text;
BEGIN
  IF COALESCE(p_employee_id,'') = '' OR jsonb_typeof(p_photo_urls) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_photo_urls) > 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_photo_urls) v WHERE jsonb_typeof(v) <> 'string')
    OR (p_item_ids IS NOT NULL AND jsonb_typeof(p_item_ids) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid RELEASE payload';
  END IF;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
  PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
  FOR item IN SELECT * FROM "BookingItems" WHERE "bookingId" = p_booking_id
    AND (p_item_ids IS NULL OR p_item_ids ? id) ORDER BY id LOOP
    v_segments := jsonb_unwrap_string(item.segments);
    IF jsonb_typeof(v_segments) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid RELEASE v_segments'; END IF;
    SELECT COALESCE(jsonb_agg(s),'[]') INTO live_done FROM jsonb_array_elements(v_segments) s
      WHERE (COALESCE(s->>'voided','false') <> 'true' OR s->>'note'='CANCELLED_NO_CREDIT')
        AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> '';
    IF jsonb_array_length(live_done) = 0 THEN CONTINUE; END IF;
    IF jsonb_array_length(p_photo_urls) = 0 AND item.handover_status IS DISTINCT FROM 'SKIPPED'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) s WHERE COALESCE(s->>'handoverTime','') <> '') THEN
      RAISE EXCEPTION 'Submit photos or use existing skip quota before release';
    END IF;
    count_done := count_done + 1;
    SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
      THEN s || jsonb_build_object('feedbackTime',COALESCE(NULLIF(s->>'feedbackTime',''),now_at::text)) ELSE s END ORDER BY ord)
      INTO v_segments FROM jsonb_array_elements(v_segments) WITH ORDINALITY v(s,ord);
    IF jsonb_array_length(p_photo_urls) > 0 THEN
      SELECT COALESCE(jsonb_object_agg(p_employee_id || ' · Ảnh ' || ord::text,value),'{}') INTO images
        FROM jsonb_array_elements(p_photo_urls) WITH ORDINALITY v(value,ord);
      SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
        THEN s || jsonb_build_object('handoverTime',now_at,'handoverPhotoUrls',p_photo_urls) ELSE s END ORDER BY ord)
        INTO v_segments FROM jsonb_array_elements(v_segments) WITH ORDINALITY v(s,ord);
      UPDATE "BookingItems" SET segments = v_segments, handover_images = (CASE WHEN jsonb_typeof(item.handover_images) = 'object' THEN item.handover_images
        WHEN jsonb_typeof(item.handover_images) = 'array' THEN (SELECT COALESCE(jsonb_object_agg('Ảnh cũ ' || ord::text,value),'{}')
          FROM jsonb_array_elements(item.handover_images) WITH ORDINALITY v(value,ord)) ELSE '{}' END) || images,
        handover_status = 'PENDING', handover_skipped = false, handover_submitted_at = now_at WHERE id = item.id;
    END IF;
    opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
    SELECT bool_and(COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''),
      bool_and(COALESCE(s->>'handoverTime','') <> '') INTO all_done,all_handed FROM jsonb_array_elements(v_segments) s
      WHERE COALESCE(s->>'ktvId','') <> '' AND (COALESCE(s->>'voided','false') <> 'true'
        OR (s->>'note'='CANCELLED_NO_CREDIT' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''));
    IF opts->>'sequentialSlots' = '2' THEN
      all_done := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) s
        WHERE COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'ktvId','') <> ''
          AND (COALESCE(s->>'actualStartTime','') = '' OR COALESCE(s->>'actualEndTime','') = ''))
        AND (COALESCE(opts->'closedSequentialSlots','[]') @> '[1]'::jsonb OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'sequenceSlot'='1'
            AND COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''))
        AND (COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb OR opts->>'finishedAfterA'='true' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'sequenceSlot'='2'
            AND COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''));
    END IF;
    rated := item."itemRating" IS NOT NULL OR b.rating IS NOT NULL OR EXISTS (
      SELECT 1 FROM "BookingGuests" WHERE id = item.guest_id AND rating IS NOT NULL);
    next_status := CASE WHEN item.status IN ('DONE','CANCELLED') THEN item.status::text
      WHEN NOT COALESCE(all_done,false) THEN CASE WHEN item.status::text='PAUSED' THEN 'PAUSED' ELSE 'IN_PROGRESS' END
      WHEN rated AND all_handed THEN 'DONE' ELSE 'FEEDBACK' END;
    SELECT * INTO item FROM jsonb_populate_record(item,jsonb_build_object('status',next_status));
    UPDATE "BookingItems" SET segments = v_segments, status = item.status WHERE id = item.id;
    -- Skip preserves SKIPPED/debt and does not fabricate physical handoverTime.
    FOR a IN SELECT * FROM "KtvAssignments" WHERE booking_id = p_booking_id
      AND booking_item_id = item.id AND employee_id = p_employee_id AND status IN ('ACTIVE','QUEUED','READY')
      ORDER BY business_date, segment_id FOR UPDATE LOOP
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = a.segment_id)
        OR (a.segment_id IS NULL AND jsonb_array_length(live_done) = 1 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE COALESCE(s->>'voided','false') <> 'true'
          AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
          AND COALESCE(s->>'actualEndTime','') = '')) THEN
        UPDATE "KtvAssignments" SET status = 'COMPLETED', updated_at = now_at
          WHERE employee_id = a.employee_id AND booking_item_id = a.booking_item_id AND segment_id IS NOT DISTINCT FROM a.segment_id;
        changed_dates := array_append(changed_dates,a.business_date);
      END IF;
    END LOOP;
  END LOOP;
  IF count_done = 0 THEN RAISE EXCEPTION 'No completed live work to release'; END IF;
  FOR day IN SELECT DISTINCT unnest(changed_dates) LOOP
    -- Repaying an old debt must never promote/clear another booking currently being served.
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id = p_employee_id AND business_date = day AND status = 'ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = day
        AND current_order_id IS NOT NULL AND current_order_id <> p_booking_id) THEN
      promotion := promote_next_assignment(p_employee_id,day);
      IF promotion ? 'success' AND NOT COALESCE((promotion->>'success')::boolean,false) THEN RAISE EXCEPTION 'Promotion failed'; END IF;
    END IF;
  END LOOP;
  PERFORM dispatch_recompute_booking_status(p_booking_id);
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;

-- Keep initial dispatch A/B plans consistent with their own assigned minutes.
CREATE OR REPLACE FUNCTION dispatch_apply_edit(p_booking_id text, p_action text, p_payload jsonb, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  edit jsonb;
  item_row "BookingItems"%ROWTYPE;
  result jsonb;
  item_updates jsonb := COALESCE(p_payload->'itemUpdates', '[]');
  opts jsonb;
  segment jsonb;
  old_segment jsonb;
  segment_list jsonb;
  plan_day date;
  plan_start timestamptz;
  normal_updates jsonb := '[]';
  live_ids text[] := ARRAY[]::text[];
  service_day date;
  guest_patch jsonb;
  guest_row "BookingGuests"%ROWTYPE;
  staff_id text;
  next_position integer;
  next_checkin integer;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH','ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A','EDIT_ACTUAL_TIME') THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn; tải lại bảng'; END IF;
  IF p_action IN ('ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A') THEN
    item_updates := jsonb_build_array(jsonb_build_object('id', p_payload->>'itemId',
      'options', jsonb_build_object('dispatchRevision', p_payload->'expectedRevision')));
  END IF;
  FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) ORDER BY value->>'id' LOOP
    SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dịch vụ không thuộc đơn; tải lại bảng'; END IF;
    IF COALESCE((jsonb_unwrap_string(item_row.options)->>'dispatchRevision')::bigint, 0)
       <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint, 0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Tải lại đơn trước khi chỉnh tiếp; bản cũ chưa được lưu.';
    END IF;
  END LOOP;
  -- All revision checks above must pass before guest/count/queue business writes.
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id = p_booking_id;
  IF service_day IS NULL THEN RAISE EXCEPTION 'Missing booking service day'; END IF;
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'date' AND NULLIF(p_payload->>'date','')::date IS DISTINCT FROM service_day THEN
      RAISE EXCEPTION 'Dispatch date differs from booking service day';
    END IF;
    p_payload := p_payload || jsonb_build_object('date',service_day);
    IF p_payload ? 'guestCount' THEN
      IF (p_payload->>'guestCount')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid guest count'; END IF;
      UPDATE "Bookings" SET "guestCount" = (p_payload->>'guestCount')::integer WHERE id = p_booking_id;
    END IF;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'newGuests','[]')) LOOP
      IF guest_patch->>'booking_id' IS DISTINCT FROM p_booking_id OR COALESCE(guest_patch->>'id','') = '' THEN
        RAISE EXCEPTION 'Invalid new guest';
      END IF;
      INSERT INTO "BookingGuests" (id,booking_id,guest_index,guest_label,status)
        VALUES (guest_patch->>'id',p_booking_id,(guest_patch->>'guest_index')::integer,guest_patch->>'guest_label','PENDING');
    END LOOP;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      IF edit ? 'guest_id' THEN
        IF NOT EXISTS (SELECT 1 FROM "BookingGuests" WHERE id = edit->>'guest_id' AND booking_id = p_booking_id) THEN
          RAISE EXCEPTION 'Guest does not belong to booking';
        END IF;
        UPDATE "BookingItems" SET guest_id = edit->>'guest_id' WHERE id = edit->>'id' AND "bookingId" = p_booking_id;
      END IF;
    END LOOP;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'guestUpdates','[]')) LOOP
      SELECT * INTO guest_row FROM "BookingGuests" WHERE id = guest_patch->>'id' AND booking_id = p_booking_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Guest update target changed'; END IF;
      guest_patch := (guest_patch - 'id') ||
        CASE WHEN guest_patch ? 'bedId' THEN jsonb_build_object('bed_id',guest_patch->'bedId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'roomId' THEN jsonb_build_object('room_id',guest_patch->'roomId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'focusArea' THEN jsonb_build_object('focus_area',guest_patch->'focusArea') ELSE '{}' END;
      SELECT * INTO guest_row FROM jsonb_populate_record(guest_row,guest_patch - ARRAY['bedId','roomId','focusArea']);
      UPDATE "BookingGuests" SET bed_id = guest_row.bed_id, room_id = guest_row.room_id,
        status = guest_row.status, notes = guest_row.notes, focus_area = guest_row.focus_area WHERE id = guest_row.id;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND jsonb_array_length(COALESCE(p_payload->'turnStaffIds','[]')) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('TurnQueue-tail:' || service_day::text));
    SELECT COALESCE(max(queue_position),0),COALESCE(max(check_in_order),0) INTO next_position,next_checkin FROM "TurnQueue" WHERE date = service_day;
    FOR staff_id IN SELECT DISTINCT value FROM jsonb_array_elements_text(p_payload->'turnStaffIds') ORDER BY value LOOP
      next_position := next_position + 1; next_checkin := next_checkin + 1;
      INSERT INTO "TurnQueue" (employee_id,date,status,queue_position,check_in_order,turns_completed)
        VALUES (staff_id,service_day,'waiting',next_position,next_checkin,0) ON CONFLICT (employee_id,date) DO NOTHING;
    END LOOP;
  END IF;
  PERFORM set_config('app.dispatch_action', p_action, true);
  PERFORM set_config('app.dispatch_actor', COALESCE(p_actor, 'null')::text, true);
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'confirmedOverlapItemIds' AND jsonb_typeof(p_payload->'confirmedOverlapItemIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Danh sách xác nhận chồng giờ không hợp lệ';
    END IF;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' = '2'
         AND item_row.status IN ('PREPARING','READY','IN_PROGRESS') THEN
        PERFORM dispatch_save_sequential_update(p_booking_id,edit,
          COALESCE(p_payload->'confirmedOverlapItemIds', '[]'::jsonb) ? item_row.id
          OR (jsonb_array_length(item_updates) = 1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false)));
        live_ids := array_append(live_ids,item_row.id);
      ELSE
        normal_updates := normal_updates || jsonb_build_array(edit);
      END IF;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND cardinality(live_ids) > 0 AND jsonb_array_length(normal_updates) = 0 THEN
    result := '{"success":true}';
  ELSIF p_action = 'DISPATCH' THEN
    result := dispatch_confirm_booking(p_booking_id, (p_payload->>'date')::date,
      COALESCE(p_payload->>'status', 'PREPARING'), p_payload->>'technicianCode', p_payload->>'bedId',
      p_payload->>'roomName', p_payload->>'notes', COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(p_payload->'staffAssignments','[]'))
        WHERE NOT (value->>'bookingItemId' = ANY(live_ids))), '[]'), normal_updates);
    IF COALESCE((result->>'success')::boolean, false) = false THEN RAISE EXCEPTION '%', COALESCE(result->>'error', 'Điều phối chưa được lưu'); END IF;
    -- A/B minutes come from the persisted slot, even if a caller submitted the catalogue end clock.
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' IS DISTINCT FROM '2' THEN CONTINUE; END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments)) LOOP
        IF COALESCE(segment->>'voided','false')='true' OR COALESCE(segment->>'ktvId','')='' THEN CONTINUE; END IF;
        plan_start := COALESCE(NULLIF(segment->>'plannedStartAt','')::timestamptz,
          (service_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
        IF COALESCE(segment->>'plannedStartAt','')='' AND segment->>'sequenceSlot'='2'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments)) first_slot
            WHERE first_slot->>'sequenceSlot'='1' AND COALESCE(first_slot->>'voided','false') <> 'true'
              AND (segment->>'startTime')::time < (first_slot->>'startTime')::time) THEN
          plan_start := plan_start + interval '1 day';
        END IF;
        UPDATE "KtvAssignments" SET planned_start_time=plan_start,
          planned_end_time=plan_start + make_interval(mins => (segment->>'duration')::integer),
          segment_id=segment->>'id',updated_at=clock_timestamp()
          WHERE booking_id=p_booking_id AND booking_item_id=item_row.id AND employee_id=segment->>'ktvId'
            AND status IN ('ACTIVE','QUEUED','READY');
        UPDATE "TurnQueue" t SET (start_time,estimated_end_time) = (
          SELECT (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
            (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
          FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=service_day
            AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY')
            AND ka.booking_item_id=ANY(COALESCE(t.booking_item_ids,ARRAY[]::text[]) || ARRAY[t.booking_item_id]))
          WHERE t.employee_id=segment->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id
            AND t.status='assigned';
      END LOOP;
    END LOOP;
  ELSIF p_action = 'EDIT_ACTUAL_TIME' THEN
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_array_length(edit->'segments') <> jsonb_array_length(jsonb_unwrap_string(item_row.segments))
         OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(edit->'segments')) <> jsonb_array_length(edit->'segments') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; tải lại đơn';
      END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(edit->'segments') LOOP
        SELECT value INTO old_segment FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments))
        WHERE value->>'id' = segment->>'id';
        IF old_segment IS NULL OR (old_segment - 'actualStartTime' - 'actualEndTime')
           IS DISTINCT FROM (segment - 'actualStartTime' - 'actualEndTime')
           OR (old_segment->>'voided' = 'true' AND old_segment IS DISTINCT FROM segment)
           OR (COALESCE(old_segment->>'actualStartTime', '') <> '' AND COALESCE(segment->>'actualStartTime', '') = '')
           OR (COALESCE(old_segment->>'actualEndTime', '') <> '' AND COALESCE(segment->>'actualEndTime', '') = '') THEN
          RAISE EXCEPTION 'Chỉ chỉnh giờ thực tế, không xóa mốc hoặc đổi chặng đã lưu';
        END IF;
        IF COALESCE(segment->>'actualEndTime', '') <> '' AND
           (COALESCE(segment->>'actualStartTime', '') = '' OR
            (segment->>'actualEndTime')::timestamptz < (segment->>'actualStartTime')::timestamptz) THEN
          RAISE EXCEPTION 'Giờ kết thúc phải sau giờ bắt đầu';
        END IF;
      END LOOP;
      -- The payload now matches the locked row apart from validated actual stamps.
      PERFORM set_config('app.sequential_rpc', '1', true);
      UPDATE "BookingItems" SET segments = edit->'segments' WHERE id = edit->>'id';
      PERFORM set_config('app.sequential_rpc', '', true);
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'DRAFT' THEN
    UPDATE "Bookings" SET "technicianCode" = CASE WHEN p_payload ? 'technicianCode' THEN p_payload->>'technicianCode' ELSE "technicianCode" END,
      "bedId" = p_payload->>'bedId', "roomName" = p_payload->>'roomName',
      notes = p_payload->>'notes', "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT COALESCE(jsonb_unwrap_string(options), '{}') INTO opts FROM "BookingItems" WHERE id = edit->>'id';
      segment_list := COALESCE(edit->'segments', (SELECT segments FROM "BookingItems" WHERE id = edit->>'id'));
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          SELECT value INTO old_segment FROM "BookingItems" bi, jsonb_array_elements(COALESCE(bi.segments, '[]'))
          WHERE bi.id = edit->>'id' AND value->>'id' = segment->>'id' LIMIT 1;
          IF COALESCE(segment->>'startTime', '') <> '' AND COALESCE(segment->>'duration', '') <> ''
             AND COALESCE(segment->>'actualStartTime', '') = ''
             AND (old_segment->'startTime' IS DISTINCT FROM segment->'startTime'
                  OR old_segment->'duration' IS DISTINCT FROM segment->'duration'
                  OR old_segment->'endTime' IS DISTINCT FROM segment->'endTime') THEN
            SELECT COALESCE(NULLIF(p_payload->>'date', '')::date,
              (NULLIF(old_segment->>'plannedStartAt', '')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
              (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = edit->>'id'
               AND segment_id = segment->>'id' LIMIT 1)) INTO plan_day;
            IF plan_day IS NOT NULL THEN
              plan_start := (plan_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
              segment_list := (SELECT jsonb_agg(CASE WHEN value->>'id' = segment->>'id' THEN value ||
                jsonb_build_object('plannedStartAt', plan_start, 'plannedEndAt',
                  plan_start + make_interval(mins => (segment->>'duration')::integer)) ELSE value END ORDER BY ord)
                FROM jsonb_array_elements(segment_list) WITH ORDINALITY a(value, ord));
            END IF;
          END IF;
        END LOOP;
      END IF;
      UPDATE "BookingItems" SET "roomName" = edit->>'roomName', "bedId" = edit->>'bedId',
        "technicianCodes" = ARRAY(SELECT jsonb_array_elements_text(COALESCE(edit->'technicianCodes', '[]'))),
        segments = segment_list, options = opts || COALESCE(jsonb_unwrap_string(edit->'options'), '{}'),
        guest_id = CASE WHEN edit ? 'guest_id' THEN edit->>'guest_id' ELSE guest_id END
      WHERE id = edit->>'id';
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' AND jsonb_unwrap_string(edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
         AND COALESCE(jsonb_unwrap_string(edit->'options')->>'mergedIntoId', '') = '' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          IF COALESCE(segment->>'ktvId', '') <> '' AND COALESCE(segment->>'startTime', '') <> '' THEN
            UPDATE "KtvAssignments" SET
              planned_start_time = (business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh',
              planned_end_time = ((business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                + make_interval(mins => (segment->>'duration')::integer)
            WHERE booking_id = p_booking_id AND booking_item_id = edit->>'id'
              AND segment_id = segment->>'id' AND status IN ('ACTIVE','QUEUED','READY')
              AND COALESCE(segment->>'actualStartTime', '') = '';
            UPDATE "TurnQueue" SET start_time = (segment->>'startTime')::time,
              estimated_end_time = COALESCE(NULLIF(segment->>'endTime', '')::time, estimated_end_time)
            WHERE employee_id = segment->>'ktvId' AND current_order_id = p_booking_id AND status = 'assigned';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'ENABLE_SEQUENTIAL' THEN
    result := dispatch_enable_sequential_item(p_booking_id, p_payload->>'itemId');
  ELSIF p_action = 'ASSIGN_B' THEN
    IF p_payload ? 'metadata' AND (jsonb_typeof(p_payload->'metadata') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'serviceNamesForKtvs') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'notesForKtvs') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM (
                    SELECT value FROM jsonb_each(p_payload->'metadata'->'serviceNamesForKtvs')
                    UNION ALL SELECT value FROM jsonb_each(p_payload->'metadata'->'notesForKtvs')) entries
                  WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')) THEN
      RAISE EXCEPTION 'Tên/ghi chú B không hợp lệ';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id, p_payload->>'itemId', p_payload->>'toKtvId',
      (p_payload->>'plannedStartAt')::timestamptz, (p_payload->>'durationMinutes')::integer,
      COALESCE((p_payload->>'confirmOverlap')::boolean, false));
    IF COALESCE((result->>'success')::boolean, false) AND p_payload ? 'metadata' THEN
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options), '{}') ||
        jsonb_build_object('serviceNamesForKtvs', p_payload->'metadata'->'serviceNamesForKtvs',
                          'notesForKtvs', p_payload->'metadata'->'notesForKtvs')
      WHERE id = p_payload->>'itemId' AND "bookingId" = p_booking_id;
    END IF;
  ELSE
    result := dispatch_finish_sequential_after_a(p_booking_id, p_payload->>'itemId');
  END IF;
  PERFORM set_config('app.dispatch_action', '', true);
  PERFORM set_config('app.dispatch_actor', '', true);
  RETURN result || jsonb_build_object('revisions', (SELECT jsonb_object_agg(id,
    COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint, 0)) FROM "BookingItems"
    WHERE "bookingId" = p_booking_id AND id IN (SELECT value->>'id' FROM jsonb_array_elements(item_updates))));
END;
$$;
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927150000', 'sequential_scoped_lifecycle') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927180000_unassign_unstarted_dispatch_staff ─────────────────────────────
-- Removing a plan is distinct from closing A/B: the free slot remains assignable.
CREATE OR REPLACE FUNCTION dispatch_unassign_unstarted_staff(
  p_booking_id text, p_item_id text, p_ktv_id text, p_expected_revision bigint, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item "BookingItems"%ROWTYPE;
  opts jsonb;
  v_segments jsonb;
  target jsonb;
  remaining jsonb;
  service_day date;
  family_id text;
BEGIN
  SELECT "bookingDate"::date, COALESCE(parent_booking_id,id) INTO service_day,family_id
    FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND OR item.status NOT IN ('NEW','WAITING','PREPARING','READY','IN_PROGRESS') THEN
    RAISE EXCEPTION 'Ca đã chuyển trạng thái; tải lại đơn';
  END IF;
  opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
  v_segments := COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF p_expected_revision IS NULL OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã có bản lưu mới; bản đang sửa chưa được lưu';
  END IF;
  SELECT value INTO target FROM jsonb_array_elements(v_segments)
    WHERE value->>'ktvId'=p_ktv_id AND COALESCE(value->>'voided','false') <> 'true' LIMIT 1;
  IF target IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      AND (COALESCE(s->>'actualStartTime','') <> '' OR COALESCE(s->>'actualEndTime','') <> '')) THEN
    RAISE EXCEPTION 'Nhân viên đã bắt đầu hoặc đã đổi; dùng Dừng/Đổi để giữ giờ thực tế';
  END IF;
  IF target->>'sequenceSlot'='1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      AND COALESCE(s->>'actualStartTime','') <> '') THEN
    RAISE EXCEPTION 'B đã bắt đầu; không được bỏ kế hoạch A qua thao tác bỏ phân công';
  END IF;
  v_segments := (SELECT jsonb_agg(CASE
    WHEN s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || jsonb_build_object('voided',true,'voidedAt',clock_timestamp(),'note','UNASSIGNED','customCommissionDuration',0)
    WHEN target->>'sequenceSlot'='1' AND s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || '{"sequenceSlot":1}'::jsonb
    ELSE s END ORDER BY ord) FROM jsonb_array_elements(v_segments) WITH ORDINALITY r(s,ord));
  remaining := COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(v_segments) s WHERE COALESCE(s->>'voided','false') <> 'true'),'[]');
  PERFORM set_config('app.dispatch_action','UNASSIGN_STAFF',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  PERFORM set_config('app.sequential_rpc','1',true);
  UPDATE "BookingItems" SET segments=v_segments,
    "technicianCodes"=ARRAY(SELECT DISTINCT s->>'ktvId' FROM jsonb_array_elements(remaining) s),
    status=CASE WHEN jsonb_array_length(remaining)=0 THEN 'WAITING' ELSE status END
    WHERE id=p_item_id;
  PERFORM set_config('app.sequential_rpc','',true);
  UPDATE "KtvAssignments" SET status='CANCELLED',updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND booking_id=p_booking_id AND employee_id=p_ktv_id
      AND status IN ('ACTIVE','QUEUED','READY');
  DELETE FROM "TurnLedger" tl WHERE tl.employee_id=p_ktv_id AND tl.date=service_day AND tl.booking_id=family_id
    AND NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka JOIN "Bookings" b ON b.id=ka.booking_id
      WHERE COALESCE(b.parent_booking_id,b.id)=family_id AND ka.employee_id=p_ktv_id
        AND ka.business_date=service_day AND ka.status IN ('ACTIVE','QUEUED','READY','COMPLETED'));
  PERFORM promote_next_assignment(p_ktv_id,service_day);
  SELECT COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint,0) INTO p_expected_revision
    FROM "BookingItems" WHERE id=p_item_id;
  PERFORM set_config('app.dispatch_action','',true);
  PERFORM set_config('app.dispatch_actor','',true);
  RETURN jsonb_build_object('success',true,'revision',p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb) TO service_role;

-- All unstarted plans are editable; running and historical work stays immutable.
CREATE OR REPLACE FUNCTION dispatch_save_sequential_update(p_booking_id text, p_edit jsonb, p_confirm_overlap boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item_row "BookingItems"%ROWTYPE;
  opts jsonb;
  old_segments jsonb;
  incoming_segments jsonb := jsonb_unwrap_string(p_edit->'segments');
  old_segment jsonb;
  incoming jsonb;
  a jsonb;
  next_a jsonb;
  a_changed boolean := false;
  b jsonb;
  next_b jsonb;
  field_name text;
  plan_start timestamptz;
  plan_day date;
  result jsonb;
BEGIN
  SELECT * INTO item_row FROM "BookingItems" WHERE id = p_edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
  opts := COALESCE(jsonb_unwrap_string(item_row.options), '{}');
  old_segments := COALESCE(jsonb_unwrap_string(item_row.segments), '[]');
  IF NOT FOUND OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
     OR item_row.status NOT IN ('PREPARING','READY','IN_PROGRESS')
     OR jsonb_unwrap_string(p_edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
     OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> COALESCE((jsonb_unwrap_string(p_edit->'options')->>'dispatchRevision')::bigint,0)
     OR jsonb_typeof(incoming_segments) <> 'array' OR jsonb_array_length(old_segments) <> jsonb_array_length(incoming_segments) THEN
    RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn trước khi cập nhật B';
  END IF;
  FOR old_segment IN SELECT value FROM jsonb_array_elements(old_segments) LOOP
    SELECT value INTO incoming FROM jsonb_array_elements(incoming_segments) WHERE value->>'id' = old_segment->>'id';
    IF incoming IS NULL THEN RAISE EXCEPTION 'Không được xóa chặng đã điều phối'; END IF;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) LOOP
      IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; dùng thao tác đổi B riêng';
      END IF;
    END LOOP;
    IF old_segment->>'sequenceSlot' = '1' AND COALESCE(old_segment->>'voided','false') <> 'true'
       AND COALESCE(old_segment->>'actualStartTime','') = '' AND COALESCE(old_segment->>'actualEndTime','') = '' THEN
      a := old_segment; next_a := incoming;
    ELSIF old_segment->>'sequenceSlot' = '2' AND COALESCE(old_segment->>'voided','false') <> 'true' THEN
      b := old_segment; next_b := incoming;
    ELSE
      FOR field_name IN SELECT unnest(ARRAY['startTime','endTime','duration','plannedStartAt','plannedEndAt']) LOOP
        IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
          RAISE EXCEPTION 'Không đổi kế hoạch A hoặc chặng cũ khi cập nhật B';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  a_changed := a IS NOT NULL AND (a->'startTime' IS DISTINCT FROM next_a->'startTime'
    OR a->'endTime' IS DISTINCT FROM next_a->'endTime' OR a->'duration' IS DISTINCT FROM next_a->'duration');
  IF a_changed THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa kế hoạch A'; END IF;
    IF COALESCE((next_a->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Phút A không hợp lệ'; END IF;
    SELECT "bookingDate"::date INTO plan_day FROM "Bookings" WHERE id=p_booking_id;
    plan_start := (plan_day + (next_a->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF next_a->>'endTime' IS DISTINCT FROM to_char((plan_start + make_interval(mins => (next_a->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN
      RAISE EXCEPTION 'Giờ kết thúc A không khớp thời lượng';
    END IF;
    IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=a->>'ktvId' AND ka.status='ACTIVE'
      AND ka.booking_item_id<>item_row.id AND ka.planned_start_time<plan_start+make_interval(mins=>(next_a->>'duration')::integer)
      AND ka.planned_end_time>plan_start) THEN RAISE EXCEPTION 'A đang có phân công chồng giờ'; END IF;
    next_a := next_a || jsonb_build_object('plannedStartAt',plan_start,'plannedEndAt',plan_start+make_interval(mins=>(next_a->>'duration')::integer));
    PERFORM set_config('app.sequential_rpc','1',true);
    UPDATE "BookingItems" SET segments=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN next_a ELSE value END ORDER BY ord)
      FROM jsonb_array_elements(jsonb_unwrap_string(segments)) WITH ORDINALITY r(value,ord)) WHERE id=item_row.id;
    PERFORM set_config('app.sequential_rpc','',true);
    UPDATE "KtvAssignments" SET planned_start_time=plan_start,planned_end_time=plan_start+make_interval(mins=>(next_a->>'duration')::integer),updated_at=clock_timestamp()
      WHERE booking_id=p_booking_id AND booking_item_id=item_row.id AND segment_id=a->>'id' AND status IN ('ACTIVE','QUEUED','READY');
    IF NOT FOUND THEN RAISE EXCEPTION 'Phân công A đã thay đổi'; END IF;
    UPDATE "TurnQueue" SET start_time=(plan_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
      estimated_end_time=((plan_start+make_interval(mins=>(next_a->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      WHERE employee_id=a->>'ktvId' AND date=plan_day AND current_order_id=p_booking_id AND booking_item_id=item_row.id;
  END IF;
  IF b IS NOT NULL AND (b->'startTime' IS DISTINCT FROM next_b->'startTime'
      OR b->'endTime' IS DISTINCT FROM next_b->'endTime' OR b->'duration' IS DISTINCT FROM next_b->'duration' OR a_changed) THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa giờ dự kiến'; END IF;
    IF COALESCE(next_b->>'startTime','') = '' OR COALESCE((next_b->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'Giờ/phút B không hợp lệ';
    END IF;
    IF abs(extract(epoch FROM ((next_b->>'startTime')::time - (b->>'startTime')::time))) >= 43200 THEN
      RAISE EXCEPTION 'Giờ B có thể chuyển ngày; dùng Sửa B để chọn ngày/giờ đầy đủ';
    END IF;
    SELECT COALESCE((NULLIF(b->>'plannedStartAt','')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
      (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = item_row.id AND segment_id = b->>'id' LIMIT 1)) INTO plan_day;
    IF plan_day IS NULL THEN RAISE EXCEPTION 'Thiếu ngày phân công B; tải lại đơn'; END IF;
    plan_start := (plan_day + (next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF next_b->>'endTime' IS DISTINCT FROM to_char((plan_start + make_interval(mins => (next_b->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN
      RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id,item_row.id,b->>'ktvId',plan_start,
      (next_b->>'duration')::integer,p_confirm_overlap);
    IF result->>'code' = 'OVERLAP_CONFIRM_REQUIRED' THEN
      RAISE EXCEPTION USING MESSAGE = 'OVERLAP_CONFIRM_REQUIRED', DETAIL = (result || jsonb_build_object('itemId', item_row.id))::text;
    END IF;
    IF COALESCE((result->>'success')::boolean,false) = false THEN RAISE EXCEPTION 'Chưa cập nhật được kế hoạch B'; END IF;
  END IF;
  -- Read options again: the planned-time RPC may already have appended an audit entry.
  UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}') || COALESCE(jsonb_unwrap_string(p_edit->'options'),'{}')
  WHERE id = item_row.id;
  RETURN '{"success":true}';
END;
$$;
REVOKE ALL ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) TO service_role;

-- One Save may remove several rows; all removals either commit or roll back together.
CREATE OR REPLACE FUNCTION dispatch_unassign_unstarted_staffs(
  p_booking_id text,p_item_id text,p_ktv_ids text[],p_expected_revision bigint,p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE employee text; result jsonb;
BEGIN
  PERFORM 1 FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  IF p_ktv_ids IS NULL OR cardinality(p_ktv_ids)=0 OR cardinality(p_ktv_ids)<> (SELECT count(DISTINCT id) FROM unnest(p_ktv_ids) id) THEN
    RAISE EXCEPTION 'Danh sách nhân viên cần bỏ không hợp lệ';
  END IF;
  FOREACH employee IN ARRAY p_ktv_ids LOOP
    result:=dispatch_unassign_unstarted_staff(p_booking_id,p_item_id,employee,p_expected_revision,p_actor);
    p_expected_revision:=(result->>'revision')::bigint;
  END LOOP;
  RETURN jsonb_build_object('success',true,'revision',p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION dispatch_unassign_unstarted_staffs(text,text,text[],bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_unassign_unstarted_staffs(text,text,text[],bigint,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927180000', 'unassign_unstarted_dispatch_staff') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927190000_sync_unstarted_dispatch_plan ─────────────────────────────
-- DRAFT callers editing an unstarted plan must update the assignment/queue clocks too.
CREATE OR REPLACE FUNCTION sync_unstarted_dispatch_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE seg jsonb; old_seg jsonb; service_day date; planned_start timestamptz; planned_end timestamptz;
BEGIN
  IF current_setting('app.dispatch_action',true) IS DISTINCT FROM 'DRAFT' THEN RETURN NEW; END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=NEW."bookingId";
  FOR seg IN SELECT value FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(NEW.segments),'[]')) LOOP
    IF COALESCE(seg->>'voided','false')='true' OR COALESCE(seg->>'actualStartTime','')<>'' OR COALESCE(seg->>'actualEndTime','')<>'' THEN CONTINUE; END IF;
    SELECT value INTO old_seg FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(OLD.segments),'[]'))
      WHERE value->>'id'=seg->>'id' AND value->>'ktvId'=seg->>'ktvId';
    IF old_seg IS NULL OR (seg->'startTime',seg->'endTime',seg->'duration') IS NOT DISTINCT FROM (old_seg->'startTime',old_seg->'endTime',old_seg->'duration') THEN CONTINUE; END IF;
    IF COALESCE((seg->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Thời lượng nhân viên không hợp lệ'; END IF;
    planned_start := COALESCE(NULLIF(seg->>'plannedStartAt','')::timestamptz,(service_day+(seg->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
    planned_end := planned_start+make_interval(mins=>(seg->>'duration')::integer);
    IF seg->>'endTime' IS DISTINCT FROM to_char(planned_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN RAISE EXCEPTION 'Giờ kết thúc không khớp thời lượng'; END IF;
    IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=seg->>'ktvId' AND ka.status='ACTIVE'
      AND ka.booking_item_id<>NEW.id AND ka.planned_start_time<planned_end AND ka.planned_end_time>planned_start) THEN
      RAISE EXCEPTION 'Nhân viên có phân công chồng giờ';
    END IF;
    UPDATE "KtvAssignments" SET planned_start_time=planned_start,planned_end_time=planned_end,
      room_id=seg->>'roomId',bed_id=seg->>'bedId',updated_at=clock_timestamp()
      WHERE booking_id=NEW."bookingId" AND booking_item_id=NEW.id AND employee_id=seg->>'ktvId'
        AND (segment_id=seg->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
    UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
      (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,(max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date AND ka.booking_id=NEW."bookingId"
        AND ka.status IN ('ACTIVE','QUEUED','READY') AND ka.booking_item_id=ANY(COALESCE(t.booking_item_ids,ARRAY[]::text[]) || ARRAY[t.booking_item_id]))
      WHERE t.employee_id=seg->>'ktvId' AND t.date=service_day AND t.current_order_id=NEW."bookingId";
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_unstarted_dispatch_plan_trigger ON "BookingItems";
CREATE TRIGGER sync_unstarted_dispatch_plan_trigger AFTER UPDATE OF segments ON "BookingItems"
  FOR EACH ROW EXECUTE FUNCTION sync_unstarted_dispatch_plan();
REVOKE ALL ON FUNCTION sync_unstarted_dispatch_plan() FROM PUBLIC,anon,authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927190000', 'sync_unstarted_dispatch_plan') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927200000_dispatch_form_commit ─────────────────────────────
-- Save and Dispatch commit the whole editable form in one transaction.
CREATE OR REPLACE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb; desired jsonb; old jsonb;
  seg jsonb; incoming jsonb; plans jsonb; next_b jsonb; old_b jsonb;
  revision bigint; result jsonb; updates jsonb := '[]'; removed text;
  confirm_overlap boolean; service_day date; start_at timestamptz;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH') OR jsonb_typeof(COALESCE(p_payload->'itemUpdates','[]')) <> 'array' THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')))
    <> jsonb_array_length(COALESCE(p_payload->'itemUpdates','[]')) THEN RAISE EXCEPTION 'Trùng dịch vụ trong bản lưu'; END IF;
  -- Lock and check every revision before the first removal, enable, or assignment.
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) ORDER BY value->>'id' LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id FOR UPDATE;
    IF NOT FOUND OR COALESCE((jsonb_unwrap_string(item.options)->>'dispatchRevision')::bigint,0)
      <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Bản đang sửa chưa được lưu; tải lại và kiểm tra.';
    END IF;
  END LOOP;
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id';
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    desired:=COALESCE(jsonb_unwrap_string(edit->'segments'),old);
    IF jsonb_typeof(desired)<>'array' OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(desired))<>jsonb_array_length(desired) THEN
      RAISE EXCEPTION 'Danh sách chặng không hợp lệ';
    END IF;
    FOR incoming IN SELECT value FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' LOOP
      IF COALESCE(incoming->>'id','')='' OR COALESCE(incoming->>'ktvId','')=''
        OR COALESCE(incoming->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR COALESCE((incoming->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ'; END IF;
    END LOOP;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND
      ((SELECT count(DISTINCT value->>'sequenceSlot') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
      OR (EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'))
      OR (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'sequenceSlot','') NOT IN ('1','2'))
      OR (SELECT count(DISTINCT value->>'ktvId') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')) THEN
      RAISE EXCEPTION 'Nối tiếp cần A và tối đa một B khác nhân viên';
    END IF;
    -- Actual work is immutable even if a client omits it from the form.
    FOR seg IN SELECT value FROM jsonb_array_elements(old) WHERE COALESCE(value->>'voided','false')<>'true'
      AND (COALESCE(value->>'actualStartTime','')<>'' OR COALESCE(value->>'actualEndTime','')<>'') LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['ktvId','roomId','bedId','startTime','endTime','duration','actualStartTime','actualEndTime']) k
        WHERE COALESCE(incoming->>k,'') IS DISTINCT FROM COALESCE(seg->>k,'')) THEN
        RAISE EXCEPTION 'Nhân viên đã bắt đầu; dùng Dừng/Đổi để giữ giờ thực tế';
      END IF;
    END LOOP;
    IF item.status NOT IN ('PREPARING','READY','IN_PROGRESS') THEN
      IF p_action='DISPATCH' AND item.status IN ('NEW','WAITING') AND EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') THEN
        edit:=edit||jsonb_build_object('status','PREPARING');
      END IF;
      updates:=updates||jsonb_build_array(edit); CONTINUE;
    END IF;
    confirm_overlap:=COALESCE(p_payload->'confirmedOverlapItemIds','[]') ? item.id
      OR (jsonb_array_length(p_payload->'itemUpdates')=1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false));
    revision:=COALESCE((opts->>'dispatchRevision')::bigint,0);
    FOR removed IN SELECT DISTINCT value->>'ktvId' FROM jsonb_array_elements(old) oldseg
      WHERE COALESCE(value->>'voided','false')<>'true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n
        WHERE n->>'ktvId'=oldseg.value->>'ktvId' AND COALESCE(n->>'voided','false')<>'true') LOOP
      result:=dispatch_unassign_unstarted_staff(p_booking_id,item.id,removed,revision,p_actor);
      revision:=(result->>'revision')::bigint;
    END LOOP;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}'); old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    next_b:=NULL;
    SELECT value INTO next_b FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    SELECT value INTO old_b FROM jsonb_array_elements(old) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    -- New employees can only enter a live form as an unstarted sequential B.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n WHERE COALESCE(n->>'voided','false')<>'true'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old) s WHERE s->>'id'=n->>'id' AND s->>'ktvId'=n->>'ktvId' AND COALESCE(s->>'voided','false')<>'true')
      AND NOT (jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND n->>'sequenceSlot'='2' AND old_b IS NULL)) THEN
      RAISE EXCEPTION 'Ca đã điều phối; nhân viên mới chỉ được gán vào lượt B chưa bắt đầu';
    END IF;
    -- Build the old shape for the shared DRAFT updater; historical work is copied from DB.
    plans:='[]';
    FOR seg IN SELECT value FROM jsonb_array_elements(old) LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND value->>'ktvId'=seg->>'ktvId' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NOT NULL AND COALESCE(seg->>'voided','false')<>'true' AND COALESCE(seg->>'actualStartTime','')='' AND COALESCE(seg->>'actualEndTime','')='' THEN
        seg:=seg||jsonb_build_object('startTime',incoming->'startTime','endTime',incoming->'endTime','duration',incoming->'duration');
      END IF;
      plans:=plans||jsonb_build_array(seg);
    END LOOP;
    incoming:=edit||jsonb_build_object('segments',plans,'options',COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||
      jsonb_build_object('dispatchRevision',revision,'sequentialSlots',opts->'sequentialSlots'));
    result:=dispatch_apply_edit(p_booking_id,'DRAFT',p_payload||jsonb_build_object('newGuests','[]'::jsonb,'guestUpdates','[]'::jsonb,
      'itemUpdates',jsonb_build_array(incoming - 'guest_id'),'confirmOverlap',confirm_overlap),p_actor);
    revision:=(result->'revisions'->>item.id)::bigint;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
      result:=dispatch_apply_edit(p_booking_id,'ENABLE_SEQUENTIAL',jsonb_build_object('itemId',item.id,'expectedRevision',revision),p_actor);
      revision:=(result->'revisions'->>item.id)::bigint;
    END IF;
    IF next_b IS NOT NULL AND old_b IS NULL THEN
      SELECT value INTO seg FROM "BookingItems" bi,jsonb_array_elements(jsonb_unwrap_string(bi.segments)) WHERE bi.id=item.id AND value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
      IF seg IS NULL OR COALESCE(next_b->>'roomId','') IS DISTINCT FROM COALESCE(seg->>'roomId','') OR COALESCE(next_b->>'bedId','') IS DISTINCT FROM COALESCE(seg->>'bedId','') THEN
        RAISE EXCEPTION 'Lượt B cần cùng phòng và giường với A';
      END IF;
      start_at:=COALESCE(NULLIF(next_b->>'plannedStartAt','')::timestamptz,(service_day+(next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF COALESCE(next_b->>'plannedStartAt','')='' AND next_b->>'startTime'<seg->>'startTime' THEN start_at:=start_at+interval '1 day'; END IF;
      result:=dispatch_apply_edit(p_booking_id,'ASSIGN_B',jsonb_build_object('itemId',item.id,'expectedRevision',revision,'toKtvId',next_b->>'ktvId',
        'plannedStartAt',start_at,'durationMinutes',(next_b->>'duration')::integer,'confirmOverlap',confirm_overlap),p_actor);
      IF result->>'code'='OVERLAP_CONFIRM_REQUIRED' THEN RAISE EXCEPTION USING MESSAGE='OVERLAP_CONFIRM_REQUIRED',DETAIL=(result||jsonb_build_object('itemId',item.id))::text; END IF;
      IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Không gán được B'; END IF;
    END IF;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    -- The final common call applies guest changes and metadata with the acknowledged revision.
    updates:=updates||jsonb_build_array(edit||jsonb_build_object('segments',jsonb_unwrap_string(item.segments),
      'technicianCodes',to_jsonb(item."technicianCodes"),'status',item.status,'options',jsonb_unwrap_string(item.options)||
      (COALESCE(jsonb_unwrap_string(edit->'options'),'{}')-'dispatchRevision')||jsonb_build_object('dispatchRevision',jsonb_unwrap_string(item.options)->'dispatchRevision')));
  END LOOP;
  result:=dispatch_apply_edit(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',updates),p_actor);
  IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Chưa lưu được phân công'; END IF;
  RETURN result||jsonb_build_object('savedItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',bi.id,'status',bi.status,
    'segments',jsonb_unwrap_string(bi.segments),'options',jsonb_unwrap_string(bi.options),'roomName',bi."roomName",'bedId',bi."bedId") ORDER BY bi.id)
    FROM "BookingItems" bi WHERE bi."bookingId"=p_booking_id AND bi.id IN(SELECT value->>'id' FROM jsonb_array_elements(updates))),'[]'));
END $$;
REVOKE ALL ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927200000', 'dispatch_form_commit') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927210000_turn_queue_edits ─────────────────────────────
-- Server-only edits: a batch commits entirely or rolls back; concurrent +/- use a locked SQL delta.
CREATE OR REPLACE FUNCTION public.turn_queue_apply_edits(p_date date, p_action text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target record;
  entry jsonb;
  new_order integer;
  delta integer;
  affected integer := 0;
BEGIN
  IF p_date IS NULL OR p_action NOT IN ('ORDER','RESET','DELTA') THEN
    RAISE EXCEPTION 'Dữ liệu chỉnh lượt không hợp lệ.';
  END IF;
  -- All queue editors acquire locks in the same order (also protects mixed reset/order batches).
  PERFORM 1 FROM "TurnQueue" WHERE date=p_date ORDER BY id FOR UPDATE;
  IF p_action='DELTA' THEN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR COALESCE(p_payload->>'delta','') NOT IN ('-1','1') THEN
      RAISE EXCEPTION 'Mỗi lần chỉ được tăng hoặc giảm một tua.';
    END IF;
    delta := (p_payload->>'delta')::integer;
    SELECT * INTO target FROM "TurnQueue" WHERE date=p_date AND employee_id=p_payload->>'employeeId';
    IF NOT FOUND THEN RAISE EXCEPTION 'KTV không có trong lượt của ngày này.'; END IF;
    UPDATE "TurnQueue" SET manual_adjustment=COALESCE(manual_adjustment,0)+delta,
      turns_completed=GREATEST(0,(SELECT count(*) FROM "TurnLedger" l
        WHERE l.date=p_date AND l.employee_id=target.employee_id AND COALESCE(l.is_punished,false)=false)
        +COALESCE(manual_adjustment,0)+delta)
      WHERE id=target.id;
    RETURN jsonb_build_object('success',true,'employeeId',target.employee_id);
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload)=0 THEN
    RAISE EXCEPTION 'Không có thứ tự để lưu.';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload)) <>
     (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_payload)) THEN
    RAISE EXCEPTION 'Danh sách có hàng bị trùng.';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
    SELECT * INTO target FROM "TurnQueue" WHERE date=p_date AND id::text=entry->>'id';
    IF NOT FOUND THEN RAISE EXCEPTION 'Hàng đợi đã thay đổi. Tải lại dữ liệu trước khi lưu.'; END IF;
    IF entry->>'expectedOrder' IS NULL OR entry->>'expectedPosition' IS NULL OR
       target.check_in_order IS DISTINCT FROM (entry->>'expectedOrder')::integer OR
       target.queue_position IS DISTINCT FROM (entry->>'expectedPosition')::integer THEN
      RAISE EXCEPTION 'Thứ tự đã được cập nhật ở nơi khác. Bản nháp vẫn được giữ.';
    END IF;
    new_order := (entry->>'order')::integer;
    IF new_order IS NULL OR new_order < 1 OR new_order > 100000 THEN
      RAISE EXCEPTION 'Thứ tự phải là số nguyên từ 1 đến 100000.';
    END IF;
    UPDATE "TurnQueue" SET queue_position=new_order,
      check_in_order=CASE WHEN p_action='ORDER' THEN new_order ELSE check_in_order END
      WHERE id=target.id;
    affected := affected+1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'updated',affected);
END;
$$;
REVOKE ALL ON FUNCTION public.turn_queue_apply_edits(date,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.turn_queue_apply_edits(date,text,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927210000', 'turn_queue_edits') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927220000_extend_running_sequential_a ─────────────────────────────
-- Give the running A employee the full service when B has not started.
CREATE FUNCTION dispatch_extend_running_sequential_a(
  p_booking_id text, p_item_id text, p_expected_revision bigint, p_minutes integer, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; opts jsonb; v_segments jsonb; a jsonb;
  starts_at timestamptz; ends_at timestamptz; service_day date; saved "BookingItems"%ROWTYPE;
BEGIN
  IF p_minutes NOT BETWEEN 1 AND 600 OR p_expected_revision IS NULL THEN RAISE EXCEPTION 'Thời lượng không hợp lệ'; END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  v_segments:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF item.status::text <> 'IN_PROGRESS' OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> p_expected_revision
    OR COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi điều chỉnh';
  END IF;
  SELECT value INTO a FROM jsonb_array_elements(v_segments) WHERE value->>'sequenceSlot'='1'
    AND COALESCE(value->>'voided','false')<>'true';
  IF a IS NULL OR COALESCE(a->>'actualStartTime','')='' OR COALESCE(a->>'actualEndTime','')<>''
    OR p_minutes <= COALESCE((a->>'duration')::integer,0)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'sequenceSlot'='2'
      AND (COALESCE(s->>'voided','false')<>'true' OR COALESCE(s->>'actualStartTime','')<>'')) THEN
    RAISE EXCEPTION 'Chỉ được giao trọn cho A đang làm khi B chưa được gán hoặc bắt đầu';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=a->>'ktvId'
    AND ka.booking_item_id<>p_item_id AND ka.status IN ('ACTIVE','QUEUED','READY')
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên có phân công khác chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của A';
  END IF;
  v_segments:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(v_segments) WITH ORDINALITY s(value,ord));
  opts:=jsonb_set(opts,'{closedSequentialSlots}',COALESCE(opts->'closedSequentialSlots','[]')||'[2]'::jsonb,true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','EXTEND_A_FULL',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=v_segments,options=opts WHERE id=p_item_id RETURNING * INTO saved;
  UPDATE "KtvAssignments" SET planned_start_time=starts_at,planned_end_time=ends_at,updated_at=clock_timestamp()
    WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=a->>'ktvId'
      AND (segment_id=a->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id=a->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('success',true,'revision',jsonb_unwrap_string(saved.options)->'dispatchRevision',
    'employeeId',a->>'ktvId','startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'));
END $$;
REVOKE ALL ON FUNCTION dispatch_extend_running_sequential_a(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_extend_running_sequential_a(text,text,bigint,integer,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927220000', 'extend_running_sequential_a') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260927230000_adjust_running_sequential_duration ─────────────────────────────
-- A running employee may change assigned minutes through the normal Save/Dispatch form.
-- B stays available for a shorter A; it closes only when A covers this item's service length.
DROP FUNCTION IF EXISTS dispatch_extend_running_sequential_a(text,text,bigint,integer,jsonb);

CREATE FUNCTION dispatch_adjust_running_sequential_a(
  p_booking_id text,p_item_id text,p_expected_revision bigint,p_minutes integer,p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE; opts jsonb; segs jsonb; a jsonb;
  service_minutes integer; service_day date; starts_at timestamptz; ends_at timestamptz;
  previous_rpc text; previous_action text; previous_actor text;
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 600 OR p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Thời lượng phải từ 1 đến 600 phút';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF item.status::text<>'IN_PROGRESS' OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi sửa thời lượng';
  END IF;
  SELECT value INTO a FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='1'
    AND COALESCE(value->>'voided','false')<>'true';
  IF a IS NULL OR COALESCE(a->>'actualStartTime','')='' OR COALESCE(a->>'actualEndTime','')<>''
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(segs) s WHERE s->>'sequenceSlot'='2'
      AND (COALESCE(s->>'voided','false')<>'true' OR COALESCE(s->>'actualStartTime','')<>'')) THEN
    RAISE EXCEPTION 'Chỉ được sửa thời lượng A đang làm khi B chưa nhận việc';
  END IF;
  SELECT duration INTO service_minutes FROM "Services" WHERE id=item."serviceId";
  service_minutes:=COALESCE(NULLIF((opts->>'vipDuration')::integer,0),NULLIF((opts->>'duration')::integer,0),service_minutes);
  IF service_minutes IS NULL OR service_minutes<1 THEN RAISE EXCEPTION 'Không xác định được thời lượng dịch vụ'; END IF;
  IF COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb AND p_minutes<service_minutes THEN
    RAISE EXCEPTION 'Lượt B đã đóng; không thể giảm A xuống dưới thời lượng dịch vụ';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=a->>'ktvId'
    AND ka.booking_item_id<>p_item_id AND ka.status IN ('ACTIVE','QUEUED','READY')
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên có phân công khác chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của A';
  END IF;
  segs:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  IF p_minutes>=service_minutes AND NOT COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb THEN
    opts:=jsonb_set(opts,'{closedSequentialSlots}',COALESCE(opts->'closedSequentialSlots','[]')||'[2]'::jsonb,true);
  END IF;
  previous_rpc:=current_setting('app.sequential_rpc',true);
  previous_action:=current_setting('app.dispatch_action',true);
  previous_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_A_DURATION',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(previous_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(previous_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(previous_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=starts_at,planned_end_time=ends_at,updated_at=clock_timestamp()
    WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=a->>'ktvId'
      AND (segment_id=a->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id=a->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('employeeId',a->>'ktvId','minutes',p_minutes,
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'closedB',COALESCE(jsonb_unwrap_string(saved.options)->'closedSequentialSlots','[]') @> '[2]'::jsonb,
    'segments',jsonb_unwrap_string(saved.segments),'options',jsonb_unwrap_string(saved.options));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) RENAME TO dispatch_commit_form_base;
REVOKE ALL ON FUNCTION dispatch_commit_form_base(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; old_a jsonb; incoming_a jsonb; saved jsonb;
  proposed integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
    old_a:=NULL; incoming_a:=NULL;
    IF FOUND AND item.status::text='IN_PROGRESS' AND jsonb_unwrap_string(item.options)->>'sequentialSlots'='2' THEN
      SELECT value INTO old_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
      SELECT value INTO incoming_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
        WHERE value->>'id'=old_a->>'id';
    END IF;
    IF old_a IS NOT NULL AND incoming_a IS NOT NULL AND COALESCE(old_a->>'actualStartTime','')<>''
      AND COALESCE(old_a->>'actualEndTime','')='' AND incoming_a->'duration' IS DISTINCT FROM old_a->'duration' THEN
      proposed:=(incoming_a->>'duration')::integer;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
        WHERE COALESCE(incoming_a->>k,'') IS DISTINCT FROM COALESCE(old_a->>k,''))
        OR incoming_a->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(old_a->>'startTime')::time)+make_interval(mins=>proposed),'HH24:MI')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]')) s
          WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false')<>'true') THEN
        RAISE EXCEPTION 'Chỉ được đổi thời lượng A; giữ nguyên nhân viên, giờ bắt đầu và lượt B';
      END IF;
      saved:=dispatch_adjust_running_sequential_a(p_booking_id,item.id,
        COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),proposed,p_actor);
      changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
        'minutes',proposed,'startTime',saved->>'startTime','endTime',saved->>'endTime','closedB',saved->'closedB'));
      edit:=edit||jsonb_build_object('segments',saved->'segments','options',
        COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object(
          'dispatchRevision',saved->'options'->'dispatchRevision',
          'closedSequentialSlots',COALESCE(saved->'options'->'closedSequentialSlots','[]'::jsonb)));
    END IF;
    patched:=patched||jsonb_build_array(edit);
  END LOOP;
  result:=dispatch_commit_form_base(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',patched),p_actor);
  RETURN result||jsonb_build_object('durationChanges',changes);
END $$;
REVOKE ALL ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260927230000', 'adjust_running_sequential_duration') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260928010000_start_after_completed_queue ─────────────────────────────
-- A completed prior assignment can leave TurnQueue pointing at its old order.
-- Reconcile only when the next assignment is ACTIVE and the old work was handed over.
CREATE OR REPLACE FUNCTION ktv_start_service_atomic(
  p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb, p_guest_ratings jsonb,
  p_updates jsonb, p_employee_id text, p_target_segment_id text, p_started_at timestamptz, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b "Bookings"%ROWTYPE; t "TurnQueue"%ROWTYPE; result jsonb; service_day date;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b."timeStart" IS DISTINCT FROM NULLIF(p_booking_snapshot->>'timeStart','')::timestamptz
     OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'START snapshot changed; reload'; END IF;
  service_day := b."bookingDate"::date;
  IF service_day IS NULL OR p_started_at IS NULL OR COALESCE(p_employee_id,'') = '' THEN RAISE EXCEPTION 'Invalid START'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) patch,
    jsonb_array_elements(jsonb_unwrap_string(patch->'segments')) seg
    WHERE seg->>'id' = p_target_segment_id AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\s+-\s+'))
      AND COALESCE(seg->>'voided','false') <> 'true' AND NULLIF(seg->>'actualStartTime','')::timestamptz = p_started_at) THEN
    RAISE EXCEPTION 'Invalid START target';
  END IF;
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}'
    OR p_turn_patch->>'current_order_id' IS DISTINCT FROM p_booking_id THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  IF t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id THEN
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=p_employee_id
      AND ka.business_date=service_day AND ka.booking_id=p_booking_id AND ka.segment_id=p_target_segment_id
      AND ka.status='ACTIVE')
      OR EXISTS (SELECT 1 FROM "BookingItems" old_item,
        jsonb_array_elements(COALESCE(jsonb_unwrap_string(old_item.segments),'[]')) old_seg
        WHERE old_item."bookingId"=t.current_order_id
          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(old_seg->>'ktvId'),'\s+-\s+'))
          AND COALESCE(old_seg->>'voided','false')<>'true'
          AND COALESCE(old_seg->>'actualStartTime','')<>''
          AND (COALESCE(old_seg->>'actualEndTime','')='' OR COALESCE(old_seg->>'handoverTime','')='')) THEN
      RAISE EXCEPTION 'Ca trước chưa bàn giao hoặc phân công mới đã đổi; tải lại';
    END IF;
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;
REVOKE ALL ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamp with time zone,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamp with time zone,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260928010000', 'start_after_completed_queue') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260928020000_prevent_live_assignment_overlap ─────────────────────────────
-- Prevent live assignment overlaps and protect actual running work.
-- Preflight existing overlaps and invalid clocks before applying in one transaction.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The legacy dispatcher temporarily writes same-day midnight clocks before its
-- outer RPC repairs them. Check final state at COMMIT, while the index always has
-- a valid range expression. Empty temporary ranges cannot survive the final guard.
ALTER TABLE "KtvAssignments" ADD CONSTRAINT ktv_assignments_no_live_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(planned_start_time,GREATEST(planned_start_time,planned_end_time),'[)') WITH &&
  ) WHERE (status IN ('ACTIVE','QUEUED','READY') AND business_date >= DATE '2026-10-04' -- PROD 04/10: chỉ từ 04/10
    AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION validate_final_ktv_assignment_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KtvAssignments" WHERE id=NEW.id
    AND status IN ('ACTIVE','QUEUED','READY')
    AND business_date >= DATE '2026-10-04' -- PROD 04/10: dòng quá khứ không bị chặn
    AND (planned_start_time IS NULL OR planned_end_time IS NULL
      OR NOT isfinite(planned_start_time) OR NOT isfinite(planned_end_time)
      OR planned_end_time<=planned_start_time)) THEN
    RAISE EXCEPTION 'Giờ phân công không hợp lệ; tải lại và kiểm tra';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER validate_final_ktv_assignment_plan_trigger
  AFTER INSERT OR UPDATE ON "KtvAssignments" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_final_ktv_assignment_plan();
REVOKE ALL ON FUNCTION validate_final_ktv_assignment_plan() FROM PUBLIC,anon,authenticated;

-- A stale waiting queue is not evidence that physical work has ended.
CREATE FUNCTION protect_running_ktv_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status='COMPLETED' AND OLD.status IN ('ACTIVE','QUEUED','READY')
    AND EXISTS (SELECT 1 FROM "BookingItems" i,
      jsonb_array_elements(COALESCE(jsonb_unwrap_string(i.segments),'[]')) s
      WHERE i.id=OLD.booking_item_id AND i."bookingId"=OLD.booking_id
        AND (OLD.segment_id IS NULL OR s->>'id'=OLD.segment_id)
        AND lower(OLD.employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'voided','false')<>'true'
        AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') THEN
    RAISE EXCEPTION 'KTV đang làm, chưa kết thúc; không được tự dọn phân công';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_running_ktv_assignment_trigger BEFORE UPDATE OF status ON "KtvAssignments"
  FOR EACH ROW EXECUTE FUNCTION protect_running_ktv_assignment();
REVOKE ALL ON FUNCTION protect_running_ktv_assignment() FROM PUBLIC,anon,authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260928020000', 'prevent_live_assignment_overlap') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260928030000_adjust_running_sequential_pair ─────────────────────────────
-- Keep A/B in one item while changing a running A's planned minutes.
-- B may move only before starting; assignment and queue clocks change atomically.
CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_pair(
  p_booking_id text, p_item_id text, p_expected_revision bigint,
  p_a_minutes integer, p_b_start text, p_b_minutes integer, p_metadata jsonb, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE;
  opts jsonb; segs jsonb; a jsonb; b jsonb;
  service_day date; a_start timestamptz; a_end timestamptz;
  b_start timestamptz; b_end timestamptz; old_action text; old_actor text; old_rpc text;
BEGIN
  IF p_expected_revision IS NULL OR p_a_minutes NOT BETWEEN 1 AND 600
    OR p_b_minutes NOT BETWEEN 1 AND 600
    OR p_b_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  SELECT value INTO a FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
  SELECT value INTO b FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
  IF item.status::text<>'IN_PROGRESS' OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision
    OR a IS NULL OR b IS NULL OR COALESCE(a->>'actualStartTime','')=''
    OR COALESCE(a->>'actualEndTime','')<>'' OR COALESCE(b->>'actualStartTime','')<>''
    OR a->>'roomId' IS DISTINCT FROM b->>'roomId' OR a->>'bedId' IS DISTINCT FROM b->>'bedId' THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại trước khi sửa A/B';
  END IF;
  a_start:=(a->>'actualStartTime')::timestamptz;
  a_end:=a_start+make_interval(mins=>p_a_minutes);
  b_start:=(service_day+p_b_start::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  IF b_start<a_start THEN b_start:=b_start+interval '1 day'; END IF;
  b_end:=b_start+make_interval(mins=>p_b_minutes);
  IF b_start<a_end THEN RAISE EXCEPTION 'B không thể bắt đầu trước khi A kết thúc'; END IF;
  IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status IN ('ACTIVE','QUEUED','READY')
    AND ((ka.employee_id=a->>'ktvId' AND ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
      OR (ka.employee_id=b->>'ktvId' AND ka.planned_start_time<b_end AND ka.planned_end_time>b_start)
      OR (ka.bed_id=b->>'bedId' AND ka.room_id=b->>'roomId'
        AND ((ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
          OR (ka.planned_start_time<b_end AND ka.planned_end_time>b_start))))) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng giờ';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=a->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY'))
    OR NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=b->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Thiếu phân công A/B';
  END IF;
  segs:=(SELECT jsonb_agg(CASE
    WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(a_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(a_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_a_minutes,'plannedStartAt',a_start,'plannedEndAt',a_end)
    WHEN value->>'id'=b->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(b_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(b_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_b_minutes,'plannedStartAt',b_start,'plannedEndAt',b_end)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  old_rpc:=current_setting('app.sequential_rpc',true);
  old_action:=current_setting('app.dispatch_action',true);
  old_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_SEQUENTIAL_PAIR',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts||COALESCE(p_metadata,'{}') WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(old_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(old_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(old_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=a_start,planned_end_time=a_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=a->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "KtvAssignments" SET planned_start_time=b_start,planned_end_time=b_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=b->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id IN (a->>'ktvId',b->>'ktvId') AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('success',true,'revision',jsonb_unwrap_string(saved.options)->'dispatchRevision',
    'savedItem',jsonb_build_object('id',saved.id,'status',saved.status,'segments',jsonb_unwrap_string(saved.segments),
      'options',jsonb_unwrap_string(saved.options),'roomName',saved."roomName",'bedId',saved."bedId"));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260928030000', 'adjust_running_sequential_pair') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260929010000_unstick_staff_and_running_duration ─────────────────────────────
-- A completed prior assignment can leave TurnQueue pointing at its old order.
-- Reconcile only when the next assignment is ACTIVE and the old work was handed over.
CREATE OR REPLACE FUNCTION ktv_start_service_atomic(
  p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb, p_guest_ratings jsonb,
  p_updates jsonb, p_employee_id text, p_target_segment_id text, p_started_at timestamptz, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b "Bookings"%ROWTYPE; t "TurnQueue"%ROWTYPE; result jsonb; service_day date;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b."timeStart" IS DISTINCT FROM NULLIF(p_booking_snapshot->>'timeStart','')::timestamptz
     OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'START snapshot changed; reload'; END IF;
  service_day := b."bookingDate"::date;
  IF service_day IS NULL OR p_started_at IS NULL OR COALESCE(p_employee_id,'') = '' THEN RAISE EXCEPTION 'Invalid START'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) patch,
    jsonb_array_elements(jsonb_unwrap_string(patch->'segments')) seg
    WHERE seg->>'id' = p_target_segment_id AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\s+-\s+'))
      AND COALESCE(seg->>'voided','false') <> 'true' AND NULLIF(seg->>'actualStartTime','')::timestamptz = p_started_at) THEN
    RAISE EXCEPTION 'Invalid START target';
  END IF;
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}'
    OR p_turn_patch->>'current_order_id' IS DISTINCT FROM p_booking_id THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  IF t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id THEN
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=p_employee_id
      AND ka.business_date=service_day AND ka.booking_id=p_booking_id AND ka.segment_id=p_target_segment_id
      AND ka.status='ACTIVE')
      OR EXISTS (SELECT 1 FROM "BookingItems" old_item,
        jsonb_array_elements(COALESCE(jsonb_unwrap_string(old_item.segments),'[]')) old_seg
        WHERE old_item."bookingId"=t.current_order_id
          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(old_seg->>'ktvId'),'\s+-\s+'))
          AND COALESCE(old_seg->>'voided','false')<>'true'
          AND COALESCE(old_seg->>'actualStartTime','')<>''
          AND (COALESCE(old_seg->>'actualEndTime','')='' OR (COALESCE(old_seg->>'handoverTime','')=''
            AND NOT (old_item.handover_status='SKIPPED' AND old_item.handover_skipped IS TRUE)))) THEN
      RAISE EXCEPTION 'Ca trước chưa bàn giao hoặc phân công mới đã đổi; tải lại';
    END IF;
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;
REVOKE ALL ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamp with time zone,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamp with time zone,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_a(
  p_booking_id text,p_item_id text,p_expected_revision bigint,p_minutes integer,p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE; opts jsonb; segs jsonb; a jsonb;
  service_minutes integer; service_day date; starts_at timestamptz; ends_at timestamptz;
  previous_rpc text; previous_action text; previous_actor text;
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 600 OR p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Thời lượng phải từ 1 đến 600 phút';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED')
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi sửa thời lượng';
  END IF;
  SELECT value INTO a FROM jsonb_array_elements(segs)
    WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
      AND COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'actualStartTime','')<>''
      AND COALESCE(value->>'actualEndTime','')='';
  IF a IS NULL OR COALESCE(a->>'actualStartTime','')='' OR COALESCE(a->>'actualEndTime','')<>''
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(segs) s WHERE s->>'id' IS DISTINCT FROM a->>'id'
      AND (COALESCE(s->>'voided','false')<>'true' OR COALESCE(s->>'actualStartTime','')<>'')) THEN
    RAISE EXCEPTION 'Chỉ được sửa thời lượng ca đang làm khi không có ca khác cùng dịch vụ';
  END IF;
  SELECT duration INTO service_minutes FROM "Services" WHERE id=item."serviceId";
  service_minutes:=COALESCE(NULLIF((opts->>'vipDuration')::integer,0),NULLIF((opts->>'duration')::integer,0),service_minutes);
  IF service_minutes IS NULL OR service_minutes<1 THEN RAISE EXCEPTION 'Không xác định được thời lượng dịch vụ'; END IF;
  IF opts->>'sequentialSlots'='2' AND COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb AND p_minutes<service_minutes THEN
    RAISE EXCEPTION 'Lượt B đã đóng; không thể giảm A xuống dưới thời lượng dịch vụ';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status IN ('ACTIVE','QUEUED','READY')
    AND (ka.employee_id=a->>'ktvId' OR (ka.room_id=a->>'roomId' AND ka.bed_id=a->>'bedId'))
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của A';
  END IF;
  segs:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  IF opts->>'sequentialSlots'='2' AND p_minutes>=service_minutes
    AND NOT COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb THEN
    opts:=jsonb_set(opts,'{closedSequentialSlots}',COALESCE(opts->'closedSequentialSlots','[]')||'[2]'::jsonb,true);
  END IF;
  previous_rpc:=current_setting('app.sequential_rpc',true);
  previous_action:=current_setting('app.dispatch_action',true);
  previous_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_A_DURATION',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(previous_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(previous_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(previous_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=starts_at,planned_end_time=ends_at,updated_at=clock_timestamp()
    WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=a->>'ktvId'
      AND (segment_id=a->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id=a->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('employeeId',a->>'ktvId','minutes',p_minutes,
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'closedB',COALESCE(jsonb_unwrap_string(saved.options)->'closedSequentialSlots','[]') @> '[2]'::jsonb,
    'segments',jsonb_unwrap_string(saved.segments),'options',jsonb_unwrap_string(saved.options));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_pair(
  p_booking_id text, p_item_id text, p_expected_revision bigint,
  p_a_minutes integer, p_b_start text, p_b_minutes integer, p_metadata jsonb, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE;
  opts jsonb; segs jsonb; a jsonb; b jsonb;
  service_day date; a_start timestamptz; a_end timestamptz;
  b_start timestamptz; b_end timestamptz; old_action text; old_actor text; old_rpc text;
BEGIN
  IF p_expected_revision IS NULL OR p_a_minutes NOT BETWEEN 1 AND 600
    OR p_b_minutes NOT BETWEEN 1 AND 600
    OR p_b_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  SELECT value INTO a FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
  SELECT value INTO b FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED') OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision
    OR a IS NULL OR b IS NULL OR COALESCE(a->>'actualStartTime','')=''
    OR COALESCE(a->>'actualEndTime','')<>'' OR COALESCE(b->>'actualStartTime','')<>''
    OR a->>'roomId' IS DISTINCT FROM b->>'roomId' OR a->>'bedId' IS DISTINCT FROM b->>'bedId' THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại trước khi sửa A/B';
  END IF;
  a_start:=(a->>'actualStartTime')::timestamptz;
  a_end:=a_start+make_interval(mins=>p_a_minutes);
  b_start:=(service_day+p_b_start::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  IF b_start<a_start THEN b_start:=b_start+interval '1 day'; END IF;
  b_end:=b_start+make_interval(mins=>p_b_minutes);
  IF b_start<a_end THEN RAISE EXCEPTION 'B không thể bắt đầu trước khi A kết thúc'; END IF;
  IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status IN ('ACTIVE','QUEUED','READY')
    AND ((ka.employee_id=a->>'ktvId' AND ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
      OR (ka.employee_id=b->>'ktvId' AND ka.planned_start_time<b_end AND ka.planned_end_time>b_start)
      OR (ka.bed_id=b->>'bedId' AND ka.room_id=b->>'roomId'
        AND ((ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
          OR (ka.planned_start_time<b_end AND ka.planned_end_time>b_start))))) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng giờ';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=a->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY'))
    OR NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=b->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Thiếu phân công A/B';
  END IF;
  segs:=(SELECT jsonb_agg(CASE
    WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(a_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(a_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_a_minutes,'plannedStartAt',a_start,'plannedEndAt',a_end)
    WHEN value->>'id'=b->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(b_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(b_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_b_minutes,'plannedStartAt',b_start,'plannedEndAt',b_end)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  old_rpc:=current_setting('app.sequential_rpc',true);
  old_action:=current_setting('app.dispatch_action',true);
  old_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_SEQUENTIAL_PAIR',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts||COALESCE(p_metadata,'{}') WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(old_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(old_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(old_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=a_start,planned_end_time=a_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=a->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "KtvAssignments" SET planned_start_time=b_start,planned_end_time=b_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=b->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id IN (a->>'ktvId',b->>'ktvId') AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('success',true,'revision',jsonb_unwrap_string(saved.options)->'dispatchRevision',
    'savedItem',jsonb_build_object('id',saved.id,'status',saved.status,'segments',jsonb_unwrap_string(saved.segments),
      'options',jsonb_unwrap_string(saved.options),'roomName',saved."roomName",'bedId',saved."bedId"));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) TO service_role;

-- The release RPC can leave a completed order in TurnQueue when the next
-- assignment was already ACTIVE. Reconcile it in the same transaction.
ALTER FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) RENAME TO ktv_release_work_atomic_base;
REVOKE ALL ON FUNCTION ktv_release_work_atomic_base(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; turn_row "TurnQueue"%ROWTYPE; next_work "KtvAssignments"%ROWTYPE;
  work_day date;
BEGIN
  result := ktv_release_work_atomic_base(p_booking_id,p_employee_id,p_photo_urls,p_item_ids);
  FOR work_day IN SELECT DISTINCT business_date FROM "KtvAssignments"
    WHERE employee_id=p_employee_id AND booking_id=p_booking_id AND status='COMPLETED' LOOP
    SELECT * INTO turn_row FROM "TurnQueue" WHERE employee_id=p_employee_id AND date=work_day FOR UPDATE;
    IF NOT FOUND OR turn_row.current_order_id IS DISTINCT FROM p_booking_id THEN CONTINUE; END IF;
    -- A second started segment in this order still owns the queue.
    IF EXISTS (SELECT 1 FROM "BookingItems" bi,
      jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
      WHERE bi."bookingId"=p_booking_id
        AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'voided','false')<>'true'
        AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') THEN CONTINUE; END IF;
    SELECT ka.* INTO next_work FROM "KtvAssignments" ka
      JOIN "Bookings" b ON b.id=ka.booking_id
      JOIN "BookingItems" bi ON bi.id=ka.booking_item_id
      WHERE ka.employee_id=p_employee_id AND ka.business_date=work_day AND ka.status='ACTIVE'
        AND ka.booking_item_id IS DISTINCT FROM turn_row.booking_item_id
        AND b.status NOT IN ('DONE','CANCELLED','SPLIT')
        AND bi.status NOT IN ('DONE','CANCELLED','FEEDBACK','CLEANING')
      ORDER BY ka.planned_start_time NULLS LAST,ka.priority,ka.created_at LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE "TurnQueue" SET status='assigned',current_order_id=next_work.booking_id,
      booking_item_id=next_work.booking_item_id,booking_item_ids=ARRAY[next_work.booking_item_id]::text[],
      room_id=next_work.room_id,bed_id=next_work.bed_id,
      start_time=(next_work.planned_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
      estimated_end_time=(next_work.planned_end_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      WHERE employee_id=p_employee_id AND date=work_day;
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260929010000', 'unstick_staff_and_running_duration') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260929020000_allow_running_duration_rpc ─────────────────────────────
-- The server action saves a running single-employee duration through this RPC.
-- Keep browser roles blocked; only the server's service key may call it.
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb)
  TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260929020000', 'allow_running_duration_rpc') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260929030000_running_form_commit_all_states ─────────────────────────────
-- Keep whole-form Save/Dispatch on the same atomic duration path as row Save.
CREATE OR REPLACE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb;
  old_a jsonb; incoming_a jsonb; old_b jsonb; incoming_b jsonb; saved jsonb;
  a_minutes integer; b_minutes integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old_a:=NULL; incoming_a:=NULL; old_b:=NULL; incoming_b:=NULL;
    IF FOUND AND item.status::text IN ('IN_PROGRESS','PAUSED') THEN
      SELECT value INTO old_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
          AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')='';
      IF old_a IS NOT NULL THEN
        SELECT value INTO incoming_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
          WHERE value->>'id'=old_a->>'id' AND COALESCE(value->>'voided','false')<>'true';
        SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
          WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
        IF old_b IS NOT NULL THEN
          SELECT value INTO incoming_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
            WHERE value->>'id'=old_b->>'id' AND COALESCE(value->>'voided','false')<>'true';
        END IF;
      END IF;
    END IF;
    IF old_a IS NOT NULL AND incoming_a IS NOT NULL AND
      (incoming_a->'duration' IS DISTINCT FROM old_a->'duration' OR
       (old_b IS NOT NULL AND incoming_b IS NOT NULL AND
        (incoming_b->>'startTime' IS DISTINCT FROM old_b->>'startTime' OR
         incoming_b->'duration' IS DISTINCT FROM old_b->'duration'))) THEN
      a_minutes:=(incoming_a->>'duration')::integer;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
        WHERE COALESCE(incoming_a->>k,'') IS DISTINCT FROM COALESCE(old_a->>k,''))
        OR incoming_a->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(old_a->>'startTime')::time)+make_interval(mins=>a_minutes),'HH24:MI') THEN
        RAISE EXCEPTION 'Chỉ được đổi thời lượng A; giữ nguyên nhân viên, phòng và giờ bắt đầu';
      END IF;
      IF old_b IS NOT NULL THEN
        IF incoming_b IS NULL OR COALESCE(old_b->>'actualStartTime','')<>''
          OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) k
            WHERE COALESCE(incoming_b->>k,'') IS DISTINCT FROM COALESCE(old_b->>k,'')) THEN
          RAISE EXCEPTION 'Chỉ được đổi thời lượng A và giờ B chưa bắt đầu';
        END IF;
        b_minutes:=(incoming_b->>'duration')::integer;
        IF incoming_b->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(incoming_b->>'startTime')::time)+make_interval(mins=>b_minutes),'HH24:MI') THEN
          RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
        END IF;
        saved:=dispatch_adjust_running_sequential_pair(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),
          a_minutes,incoming_b->>'startTime',b_minutes,'{}'::jsonb,p_actor);
        saved:=saved->'savedItem';
        changes:=changes||jsonb_build_array(
          jsonb_build_object('itemId',item.id,'employeeId',old_a->>'ktvId','minutes',a_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id')),
          jsonb_build_object('itemId',item.id,'employeeId',old_b->>'ktvId','minutes',b_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id')));
      ELSE
        saved:=dispatch_adjust_running_sequential_a(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),a_minutes,p_actor);
        changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
          'minutes',a_minutes,'startTime',saved->>'startTime','endTime',saved->>'endTime','closedB',saved->'closedB'));
      END IF;
      edit:=edit||jsonb_build_object('segments',saved->'segments','options',
        COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object(
          'dispatchRevision',saved->'options'->'dispatchRevision')||
          CASE WHEN saved->'options' ? 'closedSequentialSlots'
            THEN jsonb_build_object('closedSequentialSlots',saved->'options'->'closedSequentialSlots')
            ELSE '{}'::jsonb END);
    END IF;
    patched:=patched||jsonb_build_array(edit);
  END LOOP;
  result:=dispatch_commit_form_base(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',patched),p_actor);
  RETURN result||jsonb_build_object('durationChanges',changes);
END $$;
REVOKE ALL ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260929030000', 'running_form_commit_all_states') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260929160000_live_queue_and_early_b ─────────────────────────────
-- A later QUEUED order may be dispatched while the KTV is still serving.
-- Only simultaneously ACTIVE plans reserve a staff member's clock.
ALTER TABLE "KtvAssignments" DROP CONSTRAINT ktv_assignments_no_live_overlap;
ALTER TABLE "KtvAssignments" ADD CONSTRAINT ktv_assignments_no_live_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(planned_start_time,GREATEST(planned_start_time,planned_end_time),'[)') WITH &&
  ) WHERE (status='ACTIVE' AND business_date >= DATE '2026-10-04' -- PROD 04/10: chỉ từ 04/10
    AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_a(
  p_booking_id text,p_item_id text,p_expected_revision bigint,p_minutes integer,p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE; opts jsonb; segs jsonb; a jsonb;
  service_minutes integer; service_day date; starts_at timestamptz; ends_at timestamptz;
  previous_rpc text; previous_action text; previous_actor text;
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 600 OR p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Thời lượng phải từ 1 đến 600 phút';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED')
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi sửa thời lượng';
  END IF;
  SELECT value INTO a FROM jsonb_array_elements(segs)
    WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
      AND COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'actualStartTime','')<>''
      AND COALESCE(value->>'actualEndTime','')='';
  IF a IS NULL OR COALESCE(a->>'actualStartTime','')='' OR COALESCE(a->>'actualEndTime','')<>''
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(segs) s WHERE s->>'id' IS DISTINCT FROM a->>'id'
      AND (COALESCE(s->>'voided','false')<>'true' OR COALESCE(s->>'actualStartTime','')<>'')) THEN
    RAISE EXCEPTION 'Chỉ được sửa thời lượng ca đang làm khi không có ca khác cùng dịch vụ';
  END IF;
  SELECT duration INTO service_minutes FROM "Services" WHERE id=item."serviceId";
  service_minutes:=COALESCE(NULLIF((opts->>'vipDuration')::integer,0),NULLIF((opts->>'duration')::integer,0),service_minutes);
  IF service_minutes IS NULL OR service_minutes<1 THEN RAISE EXCEPTION 'Không xác định được thời lượng dịch vụ'; END IF;
  IF opts->>'sequentialSlots'='2' AND COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb AND p_minutes<service_minutes THEN
    RAISE EXCEPTION 'Lượt B đã đóng; không thể giảm A xuống dưới thời lượng dịch vụ';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status='ACTIVE'
    AND (ka.employee_id=a->>'ktvId' OR (ka.room_id=a->>'roomId' AND ka.bed_id=a->>'bedId'))
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của A';
  END IF;
  segs:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  IF opts->>'sequentialSlots'='2' AND p_minutes>=service_minutes
    AND NOT COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb THEN
    opts:=jsonb_set(opts,'{closedSequentialSlots}',COALESCE(opts->'closedSequentialSlots','[]')||'[2]'::jsonb,true);
  END IF;
  previous_rpc:=current_setting('app.sequential_rpc',true);
  previous_action:=current_setting('app.dispatch_action',true);
  previous_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_A_DURATION',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(previous_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(previous_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(previous_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=starts_at,planned_end_time=ends_at,updated_at=clock_timestamp()
    WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=a->>'ktvId'
      AND (segment_id=a->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id=a->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('employeeId',a->>'ktvId','minutes',p_minutes,
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'closedB',COALESCE(jsonb_unwrap_string(saved.options)->'closedSequentialSlots','[]') @> '[2]'::jsonb,
    'segments',jsonb_unwrap_string(saved.segments),'options',jsonb_unwrap_string(saved.options));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_pair(
  p_booking_id text, p_item_id text, p_expected_revision bigint,
  p_a_minutes integer, p_b_start text, p_b_minutes integer, p_metadata jsonb, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE;
  opts jsonb; segs jsonb; a jsonb; b jsonb;
  service_day date; a_start timestamptz; a_end timestamptz;
  b_start timestamptz; b_end timestamptz; old_action text; old_actor text; old_rpc text;
BEGIN
  IF p_expected_revision IS NULL OR p_a_minutes NOT BETWEEN 1 AND 600
    OR p_b_minutes NOT BETWEEN 1 AND 600
    OR p_b_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  SELECT value INTO a FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
  SELECT value INTO b FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED') OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision
    OR a IS NULL OR b IS NULL OR COALESCE(a->>'actualStartTime','')=''
    OR COALESCE(a->>'actualEndTime','')<>'' OR COALESCE(b->>'actualStartTime','')<>''
    OR a->>'roomId' IS DISTINCT FROM b->>'roomId' OR a->>'bedId' IS DISTINCT FROM b->>'bedId' THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại trước khi sửa A/B';
  END IF;
  a_start:=(a->>'actualStartTime')::timestamptz;
  a_end:=a_start+make_interval(mins=>p_a_minutes);
  b_start:=(service_day+p_b_start::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  IF b_start<a_start THEN b_start:=b_start+interval '1 day'; END IF;
  b_end:=b_start+make_interval(mins=>p_b_minutes);
  -- B may start after A starts, even while A is still serving.
  IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status='ACTIVE'
    AND ((ka.employee_id=a->>'ktvId' AND ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
      OR (ka.employee_id=b->>'ktvId' AND ka.planned_start_time<b_end AND ka.planned_end_time>b_start)
      OR (ka.bed_id=b->>'bedId' AND ka.room_id=b->>'roomId'
        AND ((ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
          OR (ka.planned_start_time<b_end AND ka.planned_end_time>b_start))))) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng giờ';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=a->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY'))
    OR NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=b->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Thiếu phân công A/B';
  END IF;
  segs:=(SELECT jsonb_agg(CASE
    WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(a_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(a_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_a_minutes,'plannedStartAt',a_start,'plannedEndAt',a_end)
    WHEN value->>'id'=b->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(b_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(b_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_b_minutes,'plannedStartAt',b_start,'plannedEndAt',b_end)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  old_rpc:=current_setting('app.sequential_rpc',true);
  old_action:=current_setting('app.dispatch_action',true);
  old_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_SEQUENTIAL_PAIR',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts||COALESCE(p_metadata,'{}') WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(old_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(old_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(old_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=a_start,planned_end_time=a_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=a->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "KtvAssignments" SET planned_start_time=b_start,planned_end_time=b_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=b->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id IN (a->>'ktvId',b->>'ktvId') AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('success',true,'revision',jsonb_unwrap_string(saved.options)->'dispatchRevision',
    'savedItem',jsonb_build_object('id',saved.id,'status',saved.status,'segments',jsonb_unwrap_string(saved.segments),
      'options',jsonb_unwrap_string(saved.options),'roomName',saved."roomName",'bedId',saved."bedId"));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) TO service_role;

-- Permit the paused item through the same locked dispatch path as a running item.
CREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(
    p_booking_id text, p_item_id text, p_to_ktv text,
    p_planned_start_at timestamptz, p_duration_minutes integer, p_confirm_overlap boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_a_assignment "KtvAssignments"%ROWTYPE;
    v_turn "TurnQueue"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_new_b jsonb;
    v_reference timestamptz;
    v_old_ktv text;
    v_b_id text;
    v_end_at timestamptz;
    v_service_day date;
    v_expected_at timestamptz;
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT "bookingDate"::date INTO v_service_day FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF v_service_day IS NULL THEN RAISE EXCEPTION 'Missing service day'; END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND (COALESCE(value->>'voided', 'false') <> 'true'
      OR (COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb AND value->>'note'='CANCELLED_NO_CREDIT'))
    ORDER BY COALESCE(value->>'voided','false')='true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR (COALESCE(v_options->>'finishedAfterA', 'false') = 'true' OR COALESCE(v_options->'closedSequentialSlots','[]') @> '[2]'::jsonb)
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND (status IN ('ACTIVE', 'COMPLETED')
        OR (status='CANCELLED' AND COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb))
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công của A'; END IF;
    v_reference := COALESCE(NULLIF(v_a->>'actualEndTime', '')::timestamptz,
                            v_a_assignment.planned_end_time);
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND v_reference IS NOT NULL THEN
        IF v_a_assignment.planned_start_time IS NOT NULL
           AND v_reference <= v_a_assignment.planned_start_time THEN
            v_reference := v_reference + interval '1 day';
        END IF;
    END IF;
    v_expected_at := (v_service_day + (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < (v_a->>'startTime')::time THEN
        v_expected_at := v_expected_at + interval '1 day';
    END IF;
    IF p_planned_start_at IS DISTINCT FROM v_expected_at OR v_a_assignment.business_date <> v_service_day THEN
        RAISE EXCEPTION 'B must follow the booking service day; reload plan';
    END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'Giờ kết thúc của A chưa hợp lệ; hãy sửa mốc A'; END IF;
    IF p_planned_start_at < v_reference AND COALESCE(p_confirm_overlap, false) = false THEN
        RETURN jsonb_build_object('success', false, 'code', 'OVERLAP_CONFIRM_REQUIRED',
            'referenceAt', v_reference, 'referenceKind',
            CASE WHEN COALESCE(v_a->>'actualEndTime', '') <> '' THEN 'actual' ELSE 'planned' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Staff" WHERE id = p_to_ktv AND status = 'ĐANG LÀM') THEN
        RAISE EXCEPTION 'KTV B không khả dụng';
    END IF;
    v_old_ktv := v_b->>'ktvId';
    SELECT * INTO v_turn FROM "TurnQueue"
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date FOR UPDATE;
    IF NOT FOUND OR (p_to_ktv IS DISTINCT FROM v_old_ktv
       AND (v_turn.status <> 'waiting' OR v_turn.current_order_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'KTV B không còn rảnh; tải lại sổ tua';
    END IF;
    IF EXISTS (SELECT 1 FROM "KtvAssignments"
               WHERE employee_id = p_to_ktv AND business_date = v_a_assignment.business_date
                 AND status = 'ACTIVE' AND (booking_item_id <> p_item_id OR segment_id IS DISTINCT FROM v_b->>'id')) THEN
        RAISE EXCEPTION 'KTV B đang có phân công khác';
    END IF;
    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id = p_to_ktv
      AND ka.status = 'ACTIVE' AND (ka.booking_item_id <> p_item_id OR ka.segment_id IS DISTINCT FROM v_b->>'id')
      AND ka.planned_start_time < v_end_at AND ka.planned_end_time > p_planned_start_at) THEN
        RAISE EXCEPTION 'KTV B has another overlapping assignment';
    END IF;
    v_b_id := CASE WHEN p_to_ktv = v_old_ktv THEN v_b->>'id' ELSE gen_random_uuid()::text END;
    v_new_b := jsonb_build_object(
        'id', v_b_id, 'ktvId', p_to_ktv, 'sequenceSlot', 2,
        'roomId', v_a->'roomId', 'bedId', v_a->'bedId',
        'plannedStartAt', p_planned_start_at, 'plannedEndAt', v_end_at,
        'startTime', to_char(p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'endTime', to_char(v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'duration', p_duration_minutes);
    IF v_b IS NOT NULL THEN
        IF p_to_ktv = v_old_ktv THEN
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b_id THEN v_new_b ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        ELSE
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                                  THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
            v_segments := v_segments || jsonb_build_array(v_new_b);
            UPDATE "KtvAssignments" SET status = 'CANCELLED'
            WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
            DELETE FROM "TurnLedger" tl USING "Bookings" booking
            WHERE booking.id = p_booking_id AND tl.date = v_a_assignment.business_date
              AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
              AND tl.employee_id = v_old_ktv
              AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                              JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                              WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                                AND ka.business_date = tl.date AND ka.employee_id = v_old_ktv
                                AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
            PERFORM promote_next_assignment(v_old_ktv, v_a_assignment.business_date);
        END IF;
    ELSE
        v_segments := v_segments || jsonb_build_array(v_new_b);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET segments = v_segments,
        "technicianCodes" = array_append(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id,
        segment_id, planned_start_time, planned_end_time, room_id, bed_id, status, dispatch_source)
    VALUES (p_to_ktv, v_a_assignment.business_date, p_booking_id, p_item_id, v_b_id,
        p_planned_start_at, v_end_at, v_a->>'roomId', v_a->>'bedId', 'ACTIVE', 'SEQUENTIAL_SLOT_B')
    ON CONFLICT (employee_id, booking_item_id) DO UPDATE SET
        segment_id = EXCLUDED.segment_id, planned_start_time = EXCLUDED.planned_start_time,
        planned_end_time = EXCLUDED.planned_end_time, status = 'ACTIVE',
        dispatch_source = EXCLUDED.dispatch_source;
    UPDATE "TurnQueue" SET status = 'assigned', current_order_id = p_booking_id,
        booking_item_id = p_item_id, booking_item_ids = ARRAY[p_item_id]::text[],
        room_id = v_a->>'roomId', bed_id = v_a->>'bedId',
        start_time = (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time = (v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date;
    INSERT INTO "TurnLedger" (date, booking_id, employee_id, source)
    SELECT v_a_assignment.business_date, COALESCE(parent_booking_id, id), p_to_ktv, 'DISPATCH_CONFIRM'
    FROM "Bookings" WHERE id = p_booking_id
    ON CONFLICT (date, booking_id, employee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'segmentId', v_b_id);
END;
$$;

-- Permit the paused item through the same locked dispatch path as a running item.
CREATE OR REPLACE FUNCTION dispatch_save_sequential_update(p_booking_id text, p_edit jsonb, p_confirm_overlap boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item_row "BookingItems"%ROWTYPE;
  opts jsonb;
  old_segments jsonb;
  incoming_segments jsonb := jsonb_unwrap_string(p_edit->'segments');
  old_segment jsonb;
  incoming jsonb;
  a jsonb;
  next_a jsonb;
  a_changed boolean := false;
  b jsonb;
  next_b jsonb;
  field_name text;
  plan_start timestamptz;
  plan_day date;
  result jsonb;
BEGIN
  SELECT * INTO item_row FROM "BookingItems" WHERE id = p_edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
  opts := COALESCE(jsonb_unwrap_string(item_row.options), '{}');
  old_segments := COALESCE(jsonb_unwrap_string(item_row.segments), '[]');
  IF NOT FOUND OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
     OR item_row.status NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED')
     OR jsonb_unwrap_string(p_edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
     OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> COALESCE((jsonb_unwrap_string(p_edit->'options')->>'dispatchRevision')::bigint,0)
     OR jsonb_typeof(incoming_segments) <> 'array' OR jsonb_array_length(old_segments) <> jsonb_array_length(incoming_segments) THEN
    RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn trước khi cập nhật B';
  END IF;
  FOR old_segment IN SELECT value FROM jsonb_array_elements(old_segments) LOOP
    SELECT value INTO incoming FROM jsonb_array_elements(incoming_segments) WHERE value->>'id' = old_segment->>'id';
    IF incoming IS NULL THEN RAISE EXCEPTION 'Không được xóa chặng đã điều phối'; END IF;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) LOOP
      IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; dùng thao tác đổi B riêng';
      END IF;
    END LOOP;
    IF old_segment->>'sequenceSlot' = '1' AND COALESCE(old_segment->>'voided','false') <> 'true'
       AND COALESCE(old_segment->>'actualStartTime','') = '' AND COALESCE(old_segment->>'actualEndTime','') = '' THEN
      a := old_segment; next_a := incoming;
    ELSIF old_segment->>'sequenceSlot' = '2' AND COALESCE(old_segment->>'voided','false') <> 'true' THEN
      b := old_segment; next_b := incoming;
    ELSE
      FOR field_name IN SELECT unnest(ARRAY['startTime','endTime','duration','plannedStartAt','plannedEndAt']) LOOP
        IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
          RAISE EXCEPTION 'Không đổi kế hoạch A hoặc chặng cũ khi cập nhật B';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  a_changed := a IS NOT NULL AND (a->'startTime' IS DISTINCT FROM next_a->'startTime'
    OR a->'endTime' IS DISTINCT FROM next_a->'endTime' OR a->'duration' IS DISTINCT FROM next_a->'duration');
  IF a_changed THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa kế hoạch A'; END IF;
    IF COALESCE((next_a->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Phút A không hợp lệ'; END IF;
    SELECT "bookingDate"::date INTO plan_day FROM "Bookings" WHERE id=p_booking_id;
    plan_start := (plan_day + (next_a->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF next_a->>'endTime' IS DISTINCT FROM to_char((plan_start + make_interval(mins => (next_a->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN
      RAISE EXCEPTION 'Giờ kết thúc A không khớp thời lượng';
    END IF;
    IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=a->>'ktvId' AND ka.status='ACTIVE'
      AND ka.booking_item_id<>item_row.id AND ka.planned_start_time<plan_start+make_interval(mins=>(next_a->>'duration')::integer)
      AND ka.planned_end_time>plan_start) THEN RAISE EXCEPTION 'A đang có phân công chồng giờ'; END IF;
    next_a := next_a || jsonb_build_object('plannedStartAt',plan_start,'plannedEndAt',plan_start+make_interval(mins=>(next_a->>'duration')::integer));
    PERFORM set_config('app.sequential_rpc','1',true);
    UPDATE "BookingItems" SET segments=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN next_a ELSE value END ORDER BY ord)
      FROM jsonb_array_elements(jsonb_unwrap_string(segments)) WITH ORDINALITY r(value,ord)) WHERE id=item_row.id;
    PERFORM set_config('app.sequential_rpc','',true);
    UPDATE "KtvAssignments" SET planned_start_time=plan_start,planned_end_time=plan_start+make_interval(mins=>(next_a->>'duration')::integer),updated_at=clock_timestamp()
      WHERE booking_id=p_booking_id AND booking_item_id=item_row.id AND segment_id=a->>'id' AND status IN ('ACTIVE','QUEUED','READY');
    IF NOT FOUND THEN RAISE EXCEPTION 'Phân công A đã thay đổi'; END IF;
    UPDATE "TurnQueue" SET start_time=(plan_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
      estimated_end_time=((plan_start+make_interval(mins=>(next_a->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      WHERE employee_id=a->>'ktvId' AND date=plan_day AND current_order_id=p_booking_id AND booking_item_id=item_row.id;
  END IF;
  IF b IS NOT NULL AND (b->'startTime' IS DISTINCT FROM next_b->'startTime'
      OR b->'endTime' IS DISTINCT FROM next_b->'endTime' OR b->'duration' IS DISTINCT FROM next_b->'duration' OR a_changed) THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa giờ dự kiến'; END IF;
    IF COALESCE(next_b->>'startTime','') = '' OR COALESCE((next_b->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'Giờ/phút B không hợp lệ';
    END IF;
    IF abs(extract(epoch FROM ((next_b->>'startTime')::time - (b->>'startTime')::time))) >= 43200 THEN
      RAISE EXCEPTION 'Giờ B có thể chuyển ngày; dùng Sửa B để chọn ngày/giờ đầy đủ';
    END IF;
    SELECT COALESCE((NULLIF(b->>'plannedStartAt','')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
      (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = item_row.id AND segment_id = b->>'id' LIMIT 1)) INTO plan_day;
    IF plan_day IS NULL THEN RAISE EXCEPTION 'Thiếu ngày phân công B; tải lại đơn'; END IF;
    plan_start := (plan_day + (next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF next_b->>'endTime' IS DISTINCT FROM to_char((plan_start + make_interval(mins => (next_b->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN
      RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id,item_row.id,b->>'ktvId',plan_start,
      (next_b->>'duration')::integer,p_confirm_overlap);
    IF result->>'code' = 'OVERLAP_CONFIRM_REQUIRED' THEN
      RAISE EXCEPTION USING MESSAGE = 'OVERLAP_CONFIRM_REQUIRED', DETAIL = (result || jsonb_build_object('itemId', item_row.id))::text;
    END IF;
    IF COALESCE((result->>'success')::boolean,false) = false THEN RAISE EXCEPTION 'Chưa cập nhật được kế hoạch B'; END IF;
  END IF;
  -- Read options again: the planned-time RPC may already have appended an audit entry.
  UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}') || COALESCE(jsonb_unwrap_string(p_edit->'options'),'{}')
  WHERE id = item_row.id;
  RETURN '{"success":true}';
END;
$$;

-- Permit the paused item through the same locked dispatch path as a running item.
CREATE OR REPLACE FUNCTION dispatch_apply_edit(p_booking_id text, p_action text, p_payload jsonb, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  edit jsonb;
  item_row "BookingItems"%ROWTYPE;
  result jsonb;
  item_updates jsonb := COALESCE(p_payload->'itemUpdates', '[]');
  opts jsonb;
  segment jsonb;
  old_segment jsonb;
  segment_list jsonb;
  plan_day date;
  plan_start timestamptz;
  normal_updates jsonb := '[]';
  live_ids text[] := ARRAY[]::text[];
  service_day date;
  guest_patch jsonb;
  guest_row "BookingGuests"%ROWTYPE;
  staff_id text;
  next_position integer;
  next_checkin integer;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH','ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A','EDIT_ACTUAL_TIME') THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn; tải lại bảng'; END IF;
  IF p_action IN ('ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A') THEN
    item_updates := jsonb_build_array(jsonb_build_object('id', p_payload->>'itemId',
      'options', jsonb_build_object('dispatchRevision', p_payload->'expectedRevision')));
  END IF;
  FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) ORDER BY value->>'id' LOOP
    SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dịch vụ không thuộc đơn; tải lại bảng'; END IF;
    IF COALESCE((jsonb_unwrap_string(item_row.options)->>'dispatchRevision')::bigint, 0)
       <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint, 0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Tải lại đơn trước khi chỉnh tiếp; bản cũ chưa được lưu.';
    END IF;
  END LOOP;
  -- All revision checks above must pass before guest/count/queue business writes.
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id = p_booking_id;
  IF service_day IS NULL THEN RAISE EXCEPTION 'Missing booking service day'; END IF;
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'date' AND NULLIF(p_payload->>'date','')::date IS DISTINCT FROM service_day THEN
      RAISE EXCEPTION 'Dispatch date differs from booking service day';
    END IF;
    p_payload := p_payload || jsonb_build_object('date',service_day);
    IF p_payload ? 'guestCount' THEN
      IF (p_payload->>'guestCount')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid guest count'; END IF;
      UPDATE "Bookings" SET "guestCount" = (p_payload->>'guestCount')::integer WHERE id = p_booking_id;
    END IF;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'newGuests','[]')) LOOP
      IF guest_patch->>'booking_id' IS DISTINCT FROM p_booking_id OR COALESCE(guest_patch->>'id','') = '' THEN
        RAISE EXCEPTION 'Invalid new guest';
      END IF;
      INSERT INTO "BookingGuests" (id,booking_id,guest_index,guest_label,status)
        VALUES (guest_patch->>'id',p_booking_id,(guest_patch->>'guest_index')::integer,guest_patch->>'guest_label','PENDING');
    END LOOP;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      IF edit ? 'guest_id' THEN
        IF NOT EXISTS (SELECT 1 FROM "BookingGuests" WHERE id = edit->>'guest_id' AND booking_id = p_booking_id) THEN
          RAISE EXCEPTION 'Guest does not belong to booking';
        END IF;
        UPDATE "BookingItems" SET guest_id = edit->>'guest_id' WHERE id = edit->>'id' AND "bookingId" = p_booking_id;
      END IF;
    END LOOP;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'guestUpdates','[]')) LOOP
      SELECT * INTO guest_row FROM "BookingGuests" WHERE id = guest_patch->>'id' AND booking_id = p_booking_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Guest update target changed'; END IF;
      guest_patch := (guest_patch - 'id') ||
        CASE WHEN guest_patch ? 'bedId' THEN jsonb_build_object('bed_id',guest_patch->'bedId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'roomId' THEN jsonb_build_object('room_id',guest_patch->'roomId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'focusArea' THEN jsonb_build_object('focus_area',guest_patch->'focusArea') ELSE '{}' END;
      SELECT * INTO guest_row FROM jsonb_populate_record(guest_row,guest_patch - ARRAY['bedId','roomId','focusArea']);
      UPDATE "BookingGuests" SET bed_id = guest_row.bed_id, room_id = guest_row.room_id,
        status = guest_row.status, notes = guest_row.notes, focus_area = guest_row.focus_area WHERE id = guest_row.id;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND jsonb_array_length(COALESCE(p_payload->'turnStaffIds','[]')) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('TurnQueue-tail:' || service_day::text));
    SELECT COALESCE(max(queue_position),0),COALESCE(max(check_in_order),0) INTO next_position,next_checkin FROM "TurnQueue" WHERE date = service_day;
    FOR staff_id IN SELECT DISTINCT value FROM jsonb_array_elements_text(p_payload->'turnStaffIds') ORDER BY value LOOP
      next_position := next_position + 1; next_checkin := next_checkin + 1;
      INSERT INTO "TurnQueue" (employee_id,date,status,queue_position,check_in_order,turns_completed)
        VALUES (staff_id,service_day,'waiting',next_position,next_checkin,0) ON CONFLICT (employee_id,date) DO NOTHING;
    END LOOP;
  END IF;
  PERFORM set_config('app.dispatch_action', p_action, true);
  PERFORM set_config('app.dispatch_actor', COALESCE(p_actor, 'null')::text, true);
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'confirmedOverlapItemIds' AND jsonb_typeof(p_payload->'confirmedOverlapItemIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Danh sách xác nhận chồng giờ không hợp lệ';
    END IF;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' = '2'
         AND item_row.status IN ('PREPARING','READY','IN_PROGRESS','PAUSED') THEN
        PERFORM dispatch_save_sequential_update(p_booking_id,edit,
          COALESCE(p_payload->'confirmedOverlapItemIds', '[]'::jsonb) ? item_row.id
          OR (jsonb_array_length(item_updates) = 1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false)));
        live_ids := array_append(live_ids,item_row.id);
      ELSE
        normal_updates := normal_updates || jsonb_build_array(edit);
      END IF;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND cardinality(live_ids) > 0 AND jsonb_array_length(normal_updates) = 0 THEN
    result := '{"success":true}';
  ELSIF p_action = 'DISPATCH' THEN
    result := dispatch_confirm_booking(p_booking_id, (p_payload->>'date')::date,
      COALESCE(p_payload->>'status', 'PREPARING'), p_payload->>'technicianCode', p_payload->>'bedId',
      p_payload->>'roomName', p_payload->>'notes', COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(p_payload->'staffAssignments','[]'))
        WHERE NOT (value->>'bookingItemId' = ANY(live_ids))), '[]'), normal_updates);
    IF COALESCE((result->>'success')::boolean, false) = false THEN RAISE EXCEPTION '%', COALESCE(result->>'error', 'Điều phối chưa được lưu'); END IF;
    -- A/B minutes come from the persisted slot, even if a caller submitted the catalogue end clock.
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' IS DISTINCT FROM '2' THEN CONTINUE; END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments)) LOOP
        IF COALESCE(segment->>'voided','false')='true' OR COALESCE(segment->>'ktvId','')='' THEN CONTINUE; END IF;
        plan_start := COALESCE(NULLIF(segment->>'plannedStartAt','')::timestamptz,
          (service_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
        IF COALESCE(segment->>'plannedStartAt','')='' AND segment->>'sequenceSlot'='2'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments)) first_slot
            WHERE first_slot->>'sequenceSlot'='1' AND COALESCE(first_slot->>'voided','false') <> 'true'
              AND (segment->>'startTime')::time < (first_slot->>'startTime')::time) THEN
          plan_start := plan_start + interval '1 day';
        END IF;
        UPDATE "KtvAssignments" SET planned_start_time=plan_start,
          planned_end_time=plan_start + make_interval(mins => (segment->>'duration')::integer),
          segment_id=segment->>'id',updated_at=clock_timestamp()
          WHERE booking_id=p_booking_id AND booking_item_id=item_row.id AND employee_id=segment->>'ktvId'
            AND status IN ('ACTIVE','QUEUED','READY');
        UPDATE "TurnQueue" t SET (start_time,estimated_end_time) = (
          SELECT (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
            (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
          FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=service_day
            AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY')
            AND ka.booking_item_id=ANY(COALESCE(t.booking_item_ids,ARRAY[]::text[]) || ARRAY[t.booking_item_id]))
          WHERE t.employee_id=segment->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id
            AND t.status='assigned';
      END LOOP;
    END LOOP;
  ELSIF p_action = 'EDIT_ACTUAL_TIME' THEN
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_array_length(edit->'segments') <> jsonb_array_length(jsonb_unwrap_string(item_row.segments))
         OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(edit->'segments')) <> jsonb_array_length(edit->'segments') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; tải lại đơn';
      END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(edit->'segments') LOOP
        SELECT value INTO old_segment FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments))
        WHERE value->>'id' = segment->>'id';
        IF old_segment IS NULL OR (old_segment - 'actualStartTime' - 'actualEndTime')
           IS DISTINCT FROM (segment - 'actualStartTime' - 'actualEndTime')
           OR (old_segment->>'voided' = 'true' AND old_segment IS DISTINCT FROM segment)
           OR (COALESCE(old_segment->>'actualStartTime', '') <> '' AND COALESCE(segment->>'actualStartTime', '') = '')
           OR (COALESCE(old_segment->>'actualEndTime', '') <> '' AND COALESCE(segment->>'actualEndTime', '') = '') THEN
          RAISE EXCEPTION 'Chỉ chỉnh giờ thực tế, không xóa mốc hoặc đổi chặng đã lưu';
        END IF;
        IF COALESCE(segment->>'actualEndTime', '') <> '' AND
           (COALESCE(segment->>'actualStartTime', '') = '' OR
            (segment->>'actualEndTime')::timestamptz < (segment->>'actualStartTime')::timestamptz) THEN
          RAISE EXCEPTION 'Giờ kết thúc phải sau giờ bắt đầu';
        END IF;
      END LOOP;
      -- The payload now matches the locked row apart from validated actual stamps.
      PERFORM set_config('app.sequential_rpc', '1', true);
      UPDATE "BookingItems" SET segments = edit->'segments' WHERE id = edit->>'id';
      PERFORM set_config('app.sequential_rpc', '', true);
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'DRAFT' THEN
    UPDATE "Bookings" SET "technicianCode" = CASE WHEN p_payload ? 'technicianCode' THEN p_payload->>'technicianCode' ELSE "technicianCode" END,
      "bedId" = p_payload->>'bedId', "roomName" = p_payload->>'roomName',
      notes = p_payload->>'notes', "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT COALESCE(jsonb_unwrap_string(options), '{}') INTO opts FROM "BookingItems" WHERE id = edit->>'id';
      segment_list := COALESCE(edit->'segments', (SELECT segments FROM "BookingItems" WHERE id = edit->>'id'));
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          SELECT value INTO old_segment FROM "BookingItems" bi, jsonb_array_elements(COALESCE(bi.segments, '[]'))
          WHERE bi.id = edit->>'id' AND value->>'id' = segment->>'id' LIMIT 1;
          IF COALESCE(segment->>'startTime', '') <> '' AND COALESCE(segment->>'duration', '') <> ''
             AND COALESCE(segment->>'actualStartTime', '') = ''
             AND (old_segment->'startTime' IS DISTINCT FROM segment->'startTime'
                  OR old_segment->'duration' IS DISTINCT FROM segment->'duration'
                  OR old_segment->'endTime' IS DISTINCT FROM segment->'endTime') THEN
            SELECT COALESCE(NULLIF(p_payload->>'date', '')::date,
              (NULLIF(old_segment->>'plannedStartAt', '')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
              (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = edit->>'id'
               AND segment_id = segment->>'id' LIMIT 1)) INTO plan_day;
            IF plan_day IS NOT NULL THEN
              plan_start := (plan_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
              segment_list := (SELECT jsonb_agg(CASE WHEN value->>'id' = segment->>'id' THEN value ||
                jsonb_build_object('plannedStartAt', plan_start, 'plannedEndAt',
                  plan_start + make_interval(mins => (segment->>'duration')::integer)) ELSE value END ORDER BY ord)
                FROM jsonb_array_elements(segment_list) WITH ORDINALITY a(value, ord));
            END IF;
          END IF;
        END LOOP;
      END IF;
      UPDATE "BookingItems" SET "roomName" = edit->>'roomName', "bedId" = edit->>'bedId',
        "technicianCodes" = ARRAY(SELECT jsonb_array_elements_text(COALESCE(edit->'technicianCodes', '[]'))),
        segments = segment_list, options = opts || COALESCE(jsonb_unwrap_string(edit->'options'), '{}'),
        guest_id = CASE WHEN edit ? 'guest_id' THEN edit->>'guest_id' ELSE guest_id END
      WHERE id = edit->>'id';
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' AND jsonb_unwrap_string(edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
         AND COALESCE(jsonb_unwrap_string(edit->'options')->>'mergedIntoId', '') = '' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          IF COALESCE(segment->>'ktvId', '') <> '' AND COALESCE(segment->>'startTime', '') <> '' THEN
            UPDATE "KtvAssignments" SET
              planned_start_time = (business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh',
              planned_end_time = ((business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                + make_interval(mins => (segment->>'duration')::integer)
            WHERE booking_id = p_booking_id AND booking_item_id = edit->>'id'
              AND segment_id = segment->>'id' AND status IN ('ACTIVE','QUEUED','READY')
              AND COALESCE(segment->>'actualStartTime', '') = '';
            UPDATE "TurnQueue" SET start_time = (segment->>'startTime')::time,
              estimated_end_time = COALESCE(NULLIF(segment->>'endTime', '')::time, estimated_end_time)
            WHERE employee_id = segment->>'ktvId' AND current_order_id = p_booking_id AND status = 'assigned';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'ENABLE_SEQUENTIAL' THEN
    result := dispatch_enable_sequential_item(p_booking_id, p_payload->>'itemId');
  ELSIF p_action = 'ASSIGN_B' THEN
    IF p_payload ? 'metadata' AND (jsonb_typeof(p_payload->'metadata') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'serviceNamesForKtvs') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'notesForKtvs') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM (
                    SELECT value FROM jsonb_each(p_payload->'metadata'->'serviceNamesForKtvs')
                    UNION ALL SELECT value FROM jsonb_each(p_payload->'metadata'->'notesForKtvs')) entries
                  WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')) THEN
      RAISE EXCEPTION 'Tên/ghi chú B không hợp lệ';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id, p_payload->>'itemId', p_payload->>'toKtvId',
      (p_payload->>'plannedStartAt')::timestamptz, (p_payload->>'durationMinutes')::integer,
      COALESCE((p_payload->>'confirmOverlap')::boolean, false));
    IF COALESCE((result->>'success')::boolean, false) AND p_payload ? 'metadata' THEN
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options), '{}') ||
        jsonb_build_object('serviceNamesForKtvs', p_payload->'metadata'->'serviceNamesForKtvs',
                          'notesForKtvs', p_payload->'metadata'->'notesForKtvs')
      WHERE id = p_payload->>'itemId' AND "bookingId" = p_booking_id;
    END IF;
  ELSE
    result := dispatch_finish_sequential_after_a(p_booking_id, p_payload->>'itemId');
  END IF;
  PERFORM set_config('app.dispatch_action', '', true);
  PERFORM set_config('app.dispatch_actor', '', true);
  RETURN result || jsonb_build_object('revisions', (SELECT jsonb_object_agg(id,
    COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint, 0)) FROM "BookingItems"
    WHERE "bookingId" = p_booking_id AND id IN (SELECT value->>'id' FROM jsonb_array_elements(item_updates))));
END;
$$;

-- Permit the paused item through the same locked dispatch path as a running item.
CREATE OR REPLACE FUNCTION dispatch_commit_form_base(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb; desired jsonb; old jsonb;
  seg jsonb; incoming jsonb; plans jsonb; next_b jsonb; old_b jsonb;
  revision bigint; result jsonb; updates jsonb := '[]'; removed text;
  confirm_overlap boolean; service_day date; start_at timestamptz;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH') OR jsonb_typeof(COALESCE(p_payload->'itemUpdates','[]')) <> 'array' THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')))
    <> jsonb_array_length(COALESCE(p_payload->'itemUpdates','[]')) THEN RAISE EXCEPTION 'Trùng dịch vụ trong bản lưu'; END IF;
  -- Lock and check every revision before the first removal, enable, or assignment.
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) ORDER BY value->>'id' LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id FOR UPDATE;
    IF NOT FOUND OR COALESCE((jsonb_unwrap_string(item.options)->>'dispatchRevision')::bigint,0)
      <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Bản đang sửa chưa được lưu; tải lại và kiểm tra.';
    END IF;
  END LOOP;
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id';
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    desired:=COALESCE(jsonb_unwrap_string(edit->'segments'),old);
    IF jsonb_typeof(desired)<>'array' OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(desired))<>jsonb_array_length(desired) THEN
      RAISE EXCEPTION 'Danh sách chặng không hợp lệ';
    END IF;
    FOR incoming IN SELECT value FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' LOOP
      IF COALESCE(incoming->>'id','')='' OR COALESCE(incoming->>'ktvId','')=''
        OR COALESCE(incoming->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR COALESCE((incoming->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ'; END IF;
    END LOOP;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND
      ((SELECT count(DISTINCT value->>'sequenceSlot') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
      OR (EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'))
      OR (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'sequenceSlot','') NOT IN ('1','2'))
      OR (SELECT count(DISTINCT value->>'ktvId') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')) THEN
      RAISE EXCEPTION 'Nối tiếp cần A và tối đa một B khác nhân viên';
    END IF;
    -- Actual work is immutable even if a client omits it from the form.
    FOR seg IN SELECT value FROM jsonb_array_elements(old) WHERE COALESCE(value->>'voided','false')<>'true'
      AND (COALESCE(value->>'actualStartTime','')<>'' OR COALESCE(value->>'actualEndTime','')<>'') LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['ktvId','roomId','bedId','startTime','endTime','duration','actualStartTime','actualEndTime']) k
        WHERE COALESCE(incoming->>k,'') IS DISTINCT FROM COALESCE(seg->>k,'')) THEN
        RAISE EXCEPTION 'Nhân viên đã bắt đầu; dùng Dừng/Đổi để giữ giờ thực tế';
      END IF;
    END LOOP;
    IF item.status NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED') THEN
      IF p_action='DISPATCH' AND item.status IN ('NEW','WAITING') AND EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') THEN
        edit:=edit||jsonb_build_object('status','PREPARING');
      END IF;
      updates:=updates||jsonb_build_array(edit); CONTINUE;
    END IF;
    confirm_overlap:=COALESCE(p_payload->'confirmedOverlapItemIds','[]') ? item.id
      OR (jsonb_array_length(p_payload->'itemUpdates')=1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false));
    revision:=COALESCE((opts->>'dispatchRevision')::bigint,0);
    FOR removed IN SELECT DISTINCT value->>'ktvId' FROM jsonb_array_elements(old) oldseg
      WHERE COALESCE(value->>'voided','false')<>'true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n
        WHERE n->>'ktvId'=oldseg.value->>'ktvId' AND COALESCE(n->>'voided','false')<>'true') LOOP
      result:=dispatch_unassign_unstarted_staff(p_booking_id,item.id,removed,revision,p_actor);
      revision:=(result->>'revision')::bigint;
    END LOOP;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}'); old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    next_b:=NULL;
    SELECT value INTO next_b FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    SELECT value INTO old_b FROM jsonb_array_elements(old) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    -- New employees can only enter a live form as an unstarted sequential B.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n WHERE COALESCE(n->>'voided','false')<>'true'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old) s WHERE s->>'id'=n->>'id' AND s->>'ktvId'=n->>'ktvId' AND COALESCE(s->>'voided','false')<>'true')
      AND NOT (jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND n->>'sequenceSlot'='2' AND old_b IS NULL)) THEN
      RAISE EXCEPTION 'Ca đã điều phối; nhân viên mới chỉ được gán vào lượt B chưa bắt đầu';
    END IF;
    -- Build the old shape for the shared DRAFT updater; historical work is copied from DB.
    plans:='[]';
    FOR seg IN SELECT value FROM jsonb_array_elements(old) LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND value->>'ktvId'=seg->>'ktvId' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NOT NULL AND COALESCE(seg->>'voided','false')<>'true' AND COALESCE(seg->>'actualStartTime','')='' AND COALESCE(seg->>'actualEndTime','')='' THEN
        seg:=seg||jsonb_build_object('startTime',incoming->'startTime','endTime',incoming->'endTime','duration',incoming->'duration');
      END IF;
      plans:=plans||jsonb_build_array(seg);
    END LOOP;
    incoming:=edit||jsonb_build_object('segments',plans,'options',COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||
      jsonb_build_object('dispatchRevision',revision,'sequentialSlots',opts->'sequentialSlots'));
    result:=dispatch_apply_edit(p_booking_id,'DRAFT',p_payload||jsonb_build_object('newGuests','[]'::jsonb,'guestUpdates','[]'::jsonb,
      'itemUpdates',jsonb_build_array(incoming - 'guest_id'),'confirmOverlap',confirm_overlap),p_actor);
    revision:=(result->'revisions'->>item.id)::bigint;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
      result:=dispatch_apply_edit(p_booking_id,'ENABLE_SEQUENTIAL',jsonb_build_object('itemId',item.id,'expectedRevision',revision),p_actor);
      revision:=(result->'revisions'->>item.id)::bigint;
    END IF;
    IF next_b IS NOT NULL AND old_b IS NULL THEN
      SELECT value INTO seg FROM "BookingItems" bi,jsonb_array_elements(jsonb_unwrap_string(bi.segments)) WHERE bi.id=item.id AND value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
      IF seg IS NULL OR COALESCE(next_b->>'roomId','') IS DISTINCT FROM COALESCE(seg->>'roomId','') OR COALESCE(next_b->>'bedId','') IS DISTINCT FROM COALESCE(seg->>'bedId','') THEN
        RAISE EXCEPTION 'Lượt B cần cùng phòng và giường với A';
      END IF;
      start_at:=COALESCE(NULLIF(next_b->>'plannedStartAt','')::timestamptz,(service_day+(next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF COALESCE(next_b->>'plannedStartAt','')='' AND next_b->>'startTime'<seg->>'startTime' THEN start_at:=start_at+interval '1 day'; END IF;
      result:=dispatch_apply_edit(p_booking_id,'ASSIGN_B',jsonb_build_object('itemId',item.id,'expectedRevision',revision,'toKtvId',next_b->>'ktvId',
        'plannedStartAt',start_at,'durationMinutes',(next_b->>'duration')::integer,'confirmOverlap',confirm_overlap),p_actor);
      IF result->>'code'='OVERLAP_CONFIRM_REQUIRED' THEN RAISE EXCEPTION USING MESSAGE='OVERLAP_CONFIRM_REQUIRED',DETAIL=(result||jsonb_build_object('itemId',item.id))::text; END IF;
      IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Không gán được B'; END IF;
    END IF;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    -- The final common call applies guest changes and metadata with the acknowledged revision.
    updates:=updates||jsonb_build_array(edit||jsonb_build_object('segments',jsonb_unwrap_string(item.segments),
      'technicianCodes',to_jsonb(item."technicianCodes"),'status',item.status,'options',jsonb_unwrap_string(item.options)||
      (COALESCE(jsonb_unwrap_string(edit->'options'),'{}')-'dispatchRevision')||jsonb_build_object('dispatchRevision',jsonb_unwrap_string(item.options)->'dispatchRevision')));
  END LOOP;
  result:=dispatch_apply_edit(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',updates),p_actor);
  IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Chưa lưu được phân công'; END IF;
  RETURN result||jsonb_build_object('savedItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',bi.id,'status',bi.status,
    'segments',jsonb_unwrap_string(bi.segments),'options',jsonb_unwrap_string(bi.options),'roomName',bi."roomName",'bedId',bi."bedId") ORDER BY bi.id)
    FROM "BookingItems" bi WHERE bi."bookingId"=p_booking_id AND bi.id IN(SELECT value->>'id' FROM jsonb_array_elements(updates))),'[]'));
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260929160000', 'live_queue_and_early_b') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260930190000_release_completed_turnqueue ─────────────────────────────
-- A completed release must free the employee's turn, even when the old row is
-- still marked working. Keep this in the release transaction, not the GET API.
CREATE OR REPLACE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
  turn_row "TurnQueue"%ROWTYPE;
  next_work "KtvAssignments"%ROWTYPE;
  work_day date;
  promotion jsonb;
  next_running boolean;
BEGIN
  result := ktv_release_work_atomic_base(p_booking_id,p_employee_id,p_photo_urls,p_item_ids);
  FOR work_day IN SELECT DISTINCT business_date FROM "KtvAssignments"
    WHERE employee_id=p_employee_id AND booking_id=p_booking_id AND status='COMPLETED' LOOP
    SELECT * INTO turn_row FROM "TurnQueue"
      WHERE employee_id=p_employee_id AND date=work_day FOR UPDATE;
    IF NOT FOUND OR turn_row.current_order_id IS DISTINCT FROM p_booking_id THEN CONTINUE; END IF;

    -- Another started segment of this order still owns the turn.
    IF EXISTS (SELECT 1 FROM "BookingItems" bi,
      jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
      WHERE bi."bookingId"=p_booking_id
        AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'voided','false')<>'true'
        AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') THEN CONTINUE; END IF;

    -- A separately activated job takes precedence over the queued jobs.
    SELECT ka.* INTO next_work FROM "KtvAssignments" ka
      JOIN "Bookings" b ON b.id=ka.booking_id
      JOIN "BookingItems" bi ON bi.id=ka.booking_item_id
      WHERE ka.employee_id=p_employee_id AND ka.business_date=work_day AND ka.status='ACTIVE'
        AND b.status NOT IN ('DONE','CANCELLED','SPLIT')
        AND bi.status NOT IN ('DONE','CANCELLED','FEEDBACK','CLEANING')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
          WHERE (ka.segment_id IS NULL OR s->>'id'=ka.segment_id)
            AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
            AND COALESCE(s->>'voided','false')<>'true' AND COALESCE(s->>'actualEndTime','')='')
      ORDER BY ka.planned_start_time NULLS LAST,ka.priority,ka.created_at LIMIT 1;
    IF FOUND THEN
      SELECT EXISTS (SELECT 1 FROM "BookingItems" bi,
        jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
        WHERE bi.id=next_work.booking_item_id
          AND (next_work.segment_id IS NULL OR s->>'id'=next_work.segment_id)
          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
          AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') INTO next_running;
      UPDATE "TurnQueue" SET status=CASE WHEN next_running THEN 'working' ELSE 'assigned' END,
        current_order_id=next_work.booking_id,
        booking_item_id=next_work.booking_item_id,booking_item_ids=ARRAY[next_work.booking_item_id]::text[],
        room_id=next_work.room_id,bed_id=next_work.bed_id,
        start_time=(next_work.planned_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time=(next_work.planned_end_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
        WHERE employee_id=p_employee_id AND date=work_day;
      CONTINUE;
    END IF;

    IF turn_row.status='off' THEN
      UPDATE "TurnQueue" SET current_order_id=NULL,booking_item_id=NULL,
        booking_item_ids=ARRAY[]::text[],room_id=NULL,bed_id=NULL,
        start_time=NULL,estimated_end_time=NULL
        WHERE employee_id=p_employee_id AND date=work_day;
      CONTINUE;
    END IF;

    -- The promotion RPC deliberately defers while working. The released work
    -- is no longer running, so unlock that guard before promoting or clearing.
    UPDATE "TurnQueue" SET status='assigned'
      WHERE employee_id=p_employee_id AND date=work_day;
    promotion := promote_next_assignment(p_employee_id,work_day);
    IF NOT COALESCE((promotion->>'success')::boolean,false) THEN
      RAISE EXCEPTION 'Promotion failed after release: %',promotion;
    END IF;
  END LOOP;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260930190000', 'release_completed_turnqueue') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20260930200000_preserve_sequential_b_plan_day ─────────────────────────────
-- Keep B on its persisted calendar day when A starts late. This form sends a
-- clock for B, not a date; moving B to another day requires the dated B editor.
CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_pair(
  p_booking_id text, p_item_id text, p_expected_revision bigint,
  p_a_minutes integer, p_b_start text, p_b_minutes integer, p_metadata jsonb, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE;
  opts jsonb; segs jsonb; a jsonb; b jsonb;
  service_day date; b_plan_day date; a_start timestamptz; a_end timestamptz;
  b_start timestamptz; b_end timestamptz; old_action text; old_actor text; old_rpc text;
BEGIN
  IF p_expected_revision IS NULL OR p_a_minutes NOT BETWEEN 1 AND 600
    OR p_b_minutes NOT BETWEEN 1 AND 600
    OR p_b_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  SELECT value INTO a FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
  SELECT value INTO b FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED') OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision
    OR a IS NULL OR b IS NULL OR COALESCE(a->>'actualStartTime','')=''
    OR COALESCE(a->>'actualEndTime','')<>'' OR COALESCE(b->>'actualStartTime','')<>''
    OR a->>'roomId' IS DISTINCT FROM b->>'roomId' OR a->>'bedId' IS DISTINCT FROM b->>'bedId' THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại trước khi sửa A/B';
  END IF;
  a_start:=(a->>'actualStartTime')::timestamptz;
  a_end:=a_start+make_interval(mins=>p_a_minutes);
  IF COALESCE(b->>'startTime','')='' OR
    abs(extract(epoch FROM (p_b_start::time - (b->>'startTime')::time))) >= 43200 THEN
    RAISE EXCEPTION 'Giờ B có thể chuyển ngày; dùng Sửa B để chọn ngày/giờ đầy đủ';
  END IF;
  SELECT COALESCE(
    (NULLIF(b->>'plannedStartAt','')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    (SELECT (ka.planned_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
        AND ka.employee_id=b->>'ktvId' AND (ka.segment_id=b->>'id' OR ka.segment_id IS NULL)
        AND ka.status IN ('ACTIVE','QUEUED','READY')
      ORDER BY (ka.segment_id IS DISTINCT FROM b->>'id'),ka.created_at LIMIT 1)) INTO b_plan_day;
  IF b_plan_day IS NULL THEN RAISE EXCEPTION 'Thiếu ngày phân công B; tải lại đơn'; END IF;
  b_start:=(b_plan_day+p_b_start::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  b_end:=b_start+make_interval(mins=>p_b_minutes);
  -- B may start after A starts, even while A is still serving.
  IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status='ACTIVE'
    AND ((ka.employee_id=a->>'ktvId' AND ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
      OR (ka.employee_id=b->>'ktvId' AND ka.planned_start_time<b_end AND ka.planned_end_time>b_start)
      OR (ka.bed_id=b->>'bedId' AND ka.room_id=b->>'roomId'
        AND ((ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
          OR (ka.planned_start_time<b_end AND ka.planned_end_time>b_start))))) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng giờ';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=a->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY'))
    OR NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=b->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Thiếu phân công A/B';
  END IF;
  segs:=(SELECT jsonb_agg(CASE
    WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(a_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(a_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_a_minutes,'plannedStartAt',a_start,'plannedEndAt',a_end)
    WHEN value->>'id'=b->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(b_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(b_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_b_minutes,'plannedStartAt',b_start,'plannedEndAt',b_end)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  old_rpc:=current_setting('app.sequential_rpc',true);
  old_action:=current_setting('app.dispatch_action',true);
  old_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_SEQUENTIAL_PAIR',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts||COALESCE(p_metadata,'{}') WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(old_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(old_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(old_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=a_start,planned_end_time=a_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=a->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "KtvAssignments" SET planned_start_time=b_start,planned_end_time=b_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=b->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id IN (a->>'ktvId',b->>'ktvId') AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('success',true,'revision',jsonb_unwrap_string(saved.options)->'dispatchRevision',
    'savedItem',jsonb_build_object('id',saved.id,'status',saved.status,'segments',jsonb_unwrap_string(saved.segments),
      'options',jsonb_unwrap_string(saved.options),'roomName',saved."roomName",'bedId',saved."bedId"));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260930200000', 'preserve_sequential_b_plan_day') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261001090000_dispatch_plan_end_crosses_midnight ─────────────────────────────
-- P0-1 (plans/plan_fix_sequential_p0_p1_20261001.md): planned_end của slot vắt qua 00:00.
-- Thân hàm copy nguyên từ 20260830_add_dispatch_booking_guard.sql (đã đối chiếu khớp TEST),
-- chỉ thêm khối cộng 1 ngày khi end <= start. Không đổi chữ ký, grant giữ nguyên.
CREATE OR REPLACE FUNCTION dispatch_confirm_booking(
    p_booking_id text,
    p_date date,
    p_status text,
    p_technician_code text,
    p_bed_id text,
    p_room_name text,
    p_notes text,
    p_staff_assignments jsonb,
    p_item_updates jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ledger_booking_id text;
    v_assignment jsonb;
    v_item jsonb;
    v_error text;
    v_assignment_id uuid;
    v_booking_item_id text;
    v_segment_id text;
    v_planned_start_time timestamptz;
    v_planned_end_time timestamptz;
    v_priority integer;
    v_sequence_no integer;
    v_dispatch_source text;
BEGIN
    -- Guard: Không cho dispatch đơn cha đã tách
    IF EXISTS (SELECT 1 FROM "Bookings" WHERE "id" = p_booking_id AND "status"::text = 'SPLIT') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Đơn đã tách thành đơn con. Vui lòng điều phối từng đơn con riêng.');
    END IF;

    -- Guard: Đơn phải tồn tại thật. Chặn silent failure khi FE gửi mã ảo (-A/-B)
    IF NOT EXISTS (SELECT 1 FROM "Bookings" WHERE "id" = p_booking_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Không tìm thấy đơn hàng có mã "%s". Vui lòng tải lại trang và thử lại.', p_booking_id)
        );
    END IF;

    -- 0.5. Clean up assignments for KTVs that are NO LONGER in the new staff list for this booking
    DECLARE
        v_updated_item_ids text[];
        v_removed_ktv_id text;
        v_removed_item_id text;
        v_was_working boolean;
    BEGIN
        SELECT array_agg(elem->>'id') INTO v_updated_item_ids
        FROM jsonb_array_elements(p_item_updates) elem
        WHERE elem->>'id' IS NOT NULL;

        IF v_updated_item_ids IS NULL THEN
            v_updated_item_ids := ARRAY[]::text[];
        END IF;

        FOR v_removed_ktv_id, v_removed_item_id IN
            SELECT "employee_id", "booking_item_id" FROM "KtvAssignments" ka
            WHERE "booking_id" = p_booking_id
              AND "status" IN ('ACTIVE', 'QUEUED', 'READY')
              AND "booking_item_id" = ANY(v_updated_item_ids)
              AND NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(p_staff_assignments) elem
                  WHERE elem->>'ktvId' = ka."employee_id"
                    AND elem->>'bookingItemId' = ka."booking_item_id"
              )
        LOOP
            UPDATE "KtvAssignments"
            SET "status" = 'COMPLETED', "updated_at" = now()
            WHERE "booking_id" = p_booking_id
              AND "employee_id" = v_removed_ktv_id
              AND "booking_item_id" = v_removed_item_id
              AND "status" IN ('ACTIVE', 'QUEUED', 'READY');

            SELECT EXISTS(
                SELECT 1 FROM "TurnQueue"
                WHERE "employee_id" = v_removed_ktv_id
                  AND "date" = p_date
                  AND "current_order_id" = p_booking_id
                  AND "status" = 'working'
            ) INTO v_was_working;

            UPDATE "TurnQueue"
            SET "status" = CASE WHEN "status" = 'off' THEN 'off' ELSE 'waiting' END,
                "current_order_id" = NULL,
                "booking_item_id" = NULL,
                "booking_item_ids" = ARRAY[]::text[],
                "room_id" = NULL,
                "bed_id" = NULL,
                "start_time" = NULL,
                "estimated_end_time" = NULL
            WHERE "employee_id" = v_removed_ktv_id
              AND "date" = p_date
              AND "current_order_id" = p_booking_id;

            IF NOT v_was_working THEN
                IF NOT EXISTS (
                    SELECT 1 FROM "KtvAssignments"
                    WHERE "booking_id" = p_booking_id
                      AND "employee_id" = v_removed_ktv_id
                      AND "status" IN ('ACTIVE', 'QUEUED', 'READY')
                ) AND NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements(p_staff_assignments) elem
                    WHERE elem->>'ktvId' = v_removed_ktv_id
                ) THEN
                    DELETE FROM "TurnLedger"
                    WHERE "date" = p_date
                      AND "booking_id" = p_booking_id
                      AND "employee_id" = v_removed_ktv_id;
                END IF;
            END IF;
              
            PERFORM promote_next_assignment(v_removed_ktv_id, p_date);
        END LOOP;
    END;

    -- 1. Validate & insert TurnLedger
    FOR v_assignment IN SELECT jsonb_array_elements(p_staff_assignments)
    LOOP
        UPDATE "KtvAssignments" ka
        SET "status" = 'COMPLETED', "updated_at" = now()
        FROM "Bookings" b
        WHERE ka."booking_id" = b."id"
          AND ka."employee_id" = v_assignment->>'ktvId'
          AND ka."business_date" = p_date
          AND ka."status" = 'ACTIVE'
          AND b."status" IN ('DONE', 'FEEDBACK', 'CANCELLED', 'COMPLETED');

        IF EXISTS (
            SELECT 1 FROM "TurnQueue"
            WHERE "employee_id" = v_assignment->>'ktvId'
              AND "date" = p_date
              AND "status" = 'waiting'
        ) THEN
            UPDATE "KtvAssignments"
            SET "status" = 'COMPLETED', "updated_at" = now()
            WHERE "employee_id" = v_assignment->>'ktvId'
              AND "business_date" = p_date
              AND "status" = 'ACTIVE';
        END IF;
        BEGIN
            SELECT COALESCE(parent_booking_id, id) INTO v_ledger_booking_id
            FROM "Bookings"
            WHERE id = p_booking_id;

            INSERT INTO "TurnLedger" ("date", "booking_id", "employee_id", "source")
            VALUES (p_date, v_ledger_booking_id, v_assignment->>'ktvId', 'DISPATCH_CONFIRM')
            ON CONFLICT ("date", "booking_id", "employee_id") DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            v_error := SQLERRM;
            RAISE EXCEPTION 'Loi khi ghi so cai cho %: %', v_assignment->>'ktvId', v_error;
        END;

        v_booking_item_id := NULLIF(v_assignment->>'bookingItemId', '');
        IF v_booking_item_id IS NULL OR v_booking_item_id IN ('undefined', 'null') THEN
            RAISE EXCEPTION 'bookingItemId is required for KTV assignment of %', v_assignment->>'ktvId';
        END IF;

        v_segment_id := NULLIF(v_assignment->>'segmentId', '');
        IF v_segment_id IN ('undefined', 'null') THEN
            v_segment_id := NULL;
        END IF;

        v_priority := COALESCE(NULLIF(v_assignment->>'priority', '')::integer, 0);
        v_sequence_no := COALESCE(NULLIF(v_assignment->>'sequenceNo', '')::integer, 0);
        v_dispatch_source := COALESCE(NULLIF(v_assignment->>'dispatchSource', ''), 'DISPATCH_CONFIRM');

        v_planned_start_time := CASE
            WHEN NULLIF(v_assignment->>'startTime', '') IS NULL OR v_assignment->>'startTime' IN ('undefined', 'null') THEN NULL
            ELSE ((p_date::text || ' ' || (v_assignment->>'startTime'))::timestamp AT TIME ZONE 'Asia/Bangkok')
        END;

        v_planned_end_time := CASE
            WHEN NULLIF(v_assignment->>'endTime', '') IS NULL OR v_assignment->>'endTime' IN ('undefined', 'null') THEN NULL
            ELSE ((p_date::text || ' ' || (v_assignment->>'endTime'))::timestamp AT TIME ZONE 'Asia/Bangkok')
        END;

        -- endTime là đồng hồ HH:mm đã quấn qua 24h (UI dùng h % 24). Slot 23:50 → 00:50
        -- phải kết thúc ngày hôm sau. Trước đây ra end < start: sai im lặng, và từ khi có
        -- trigger validate_final_ktv_assignment_plan thì quầy không điều phối được ca đêm.
        -- Thời lượng tối đa 600 phút nên cộng đúng 1 ngày là đủ.
        IF v_planned_start_time IS NOT NULL AND v_planned_end_time IS NOT NULL
           AND v_planned_end_time <= v_planned_start_time THEN
            v_planned_end_time := v_planned_end_time + interval '1 day';
        END IF;

        -- 2a. Insert or update KtvAssignments
        INSERT INTO "KtvAssignments" (
            "employee_id",
            "business_date",
            "booking_id",
            "booking_item_id",
            "segment_id",
            "planned_start_time",
            "planned_end_time",
            "room_id",
            "bed_id",
            "priority",
            "sequence_no",
            "status",
            "dispatch_source"
        )
        VALUES (
            v_assignment->>'ktvId',
            p_date,
            p_booking_id,
            v_booking_item_id,
            v_segment_id,
            v_planned_start_time,
            v_planned_end_time,
            CASE WHEN v_assignment->>'roomId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'roomId' END,
            CASE WHEN v_assignment->>'bedId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'bedId' END,
            v_priority,
            v_sequence_no,
            'QUEUED',
            v_dispatch_source
        )
        ON CONFLICT ("employee_id", "booking_item_id") DO UPDATE
        SET
            "segment_id" = EXCLUDED."segment_id",
            "planned_start_time" = EXCLUDED."planned_start_time",
            "planned_end_time" = EXCLUDED."planned_end_time",
            "room_id" = EXCLUDED."room_id",
            "bed_id" = EXCLUDED."bed_id",
            "priority" = EXCLUDED."priority",
            "sequence_no" = EXCLUDED."sequence_no",
            "dispatch_source" = EXCLUDED."dispatch_source"
        RETURNING id INTO v_assignment_id;

        -- 2b. Xử lý Trạng thái ACTIVE & Đồng bộ TurnQueue
        DECLARE
            v_is_active_on_other boolean;
            v_is_active_on_this boolean;
        BEGIN
            SELECT EXISTS (
                SELECT 1
                FROM "KtvAssignments"
                WHERE "employee_id" = v_assignment->>'ktvId'
                  AND "business_date" = p_date
                  AND "status" = 'ACTIVE'
                  AND "booking_id" <> p_booking_id
                  AND "id" <> v_assignment_id
            ) INTO v_is_active_on_other;

            SELECT EXISTS (
                SELECT 1
                FROM "KtvAssignments"
                WHERE "employee_id" = v_assignment->>'ktvId'
                  AND "business_date" = p_date
                  AND "status" = 'ACTIVE'
                  AND "booking_id" = p_booking_id
                  AND "id" <> v_assignment_id
            ) INTO v_is_active_on_this;

            IF NOT v_is_active_on_other AND NOT v_is_active_on_this THEN
                UPDATE "KtvAssignments"
                SET "status" = 'ACTIVE'
                WHERE "id" = v_assignment_id;
            END IF;

            IF NOT v_is_active_on_other THEN
                INSERT INTO "TurnQueue" (
                    "employee_id",
                    "date",
                    "status",
                    "current_order_id",
                    "booking_item_id",
                    "booking_item_ids",
                    "room_id",
                    "bed_id",
                    "queue_position",
                    "start_time",
                    "estimated_end_time",
                    "last_served_at"
                )
                VALUES (
                    v_assignment->>'ktvId',
                    p_date,
                    'assigned',
                    p_booking_id,
                    v_booking_item_id,
                    ARRAY[v_booking_item_id]::text[],
                    CASE WHEN v_assignment->>'roomId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'roomId' END,
                    CASE WHEN v_assignment->>'bedId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'bedId' END,
                    COALESCE((CASE WHEN v_assignment->>'queuePos' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'queuePos' END)::integer, 0),
                    (CASE WHEN v_assignment->>'startTime' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'startTime' END)::time,
                    (CASE WHEN v_assignment->>'endTime' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'endTime' END)::time,
                    now()
                )
                ON CONFLICT ("employee_id", "date") DO UPDATE
                SET
                    "status" = CASE WHEN "TurnQueue"."status" = 'working' THEN 'working' ELSE 'assigned' END,
                    "current_order_id" = EXCLUDED."current_order_id",
                    "booking_item_id" = COALESCE((
                        SELECT elem->>'bookingItemId'
                        FROM jsonb_array_elements(p_staff_assignments) elem
                        WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                        ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                        LIMIT 1
                    ), EXCLUDED."booking_item_id"),
                    "booking_item_ids" = (
                        SELECT array_agg(DISTINCT elem->>'bookingItemId')
                        FROM jsonb_array_elements(p_staff_assignments) elem
                        WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                    ),
                    "room_id" = CASE
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."room_id"
                        ELSE (
                            SELECT NULLIF(elem->>'roomId', '')
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'roomId' NOT IN ('', 'undefined', 'null')
                            ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                            LIMIT 1
                        )
                    END,
                    "bed_id" = CASE
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."bed_id"
                        ELSE (
                            SELECT NULLIF(elem->>'bedId', '')
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'bedId' NOT IN ('', 'undefined', 'null')
                            ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                            LIMIT 1
                        )
                    END,
                    "queue_position" = CASE
                        WHEN EXCLUDED."queue_position" > 0 THEN EXCLUDED."queue_position"
                        ELSE "TurnQueue"."queue_position"
                    END,
                    "start_time" = CASE 
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."start_time"
                        ELSE COALESCE((
                            SELECT MIN((elem->>'startTime')::time)
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'startTime' NOT IN ('', 'undefined', 'null')
                        ), EXCLUDED."start_time")
                    END,
                    "estimated_end_time" = CASE
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."estimated_end_time"
                        ELSE COALESCE((
                            SELECT MAX((elem->>'endTime')::time)
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'endTime' NOT IN ('', 'undefined', 'null')
                        ), EXCLUDED."estimated_end_time")
                    END,
                    "last_served_at" = EXCLUDED."last_served_at";
            END IF;
        END;
    END LOOP;

    -- 2.5. Validate Booking Status Transition
    IF p_status IS NOT NULL THEN
        DECLARE
            v_current_status text;
            v_current_idx integer;
            v_new_idx integer;
        BEGIN
            SELECT "status"::text INTO v_current_status FROM "Bookings" WHERE "id" = p_booking_id;
            
            v_current_idx := CASE v_current_status
                WHEN 'NEW' THEN 0 WHEN 'WAITING' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'IN_PROGRESS' THEN 2 
                WHEN 'COMPLETED' THEN 3 WHEN 'CLEANING' THEN 3 WHEN 'waiting_rating' THEN 4 WHEN 'FEEDBACK' THEN 4 WHEN 'DONE' THEN 5
                WHEN 'CANCELLED' THEN 99 WHEN 'SPLIT' THEN 98
                ELSE -1
            END;

            v_new_idx := CASE p_status
                WHEN 'NEW' THEN 0 WHEN 'WAITING' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'IN_PROGRESS' THEN 2 
                WHEN 'COMPLETED' THEN 3 WHEN 'CLEANING' THEN 3 WHEN 'waiting_rating' THEN 4 WHEN 'FEEDBACK' THEN 4 WHEN 'DONE' THEN 5
                WHEN 'CANCELLED' THEN 99 WHEN 'SPLIT' THEN 98
                ELSE -1
            END;

            IF v_new_idx < v_current_idx AND p_status != 'CANCELLED' AND v_current_status != 'CANCELLED' THEN
                RAISE EXCEPTION 'Invalid status transition from % to %', v_current_status, p_status;
            END IF;
        END;
    END IF;

    -- 3. Update Bookings
    UPDATE "Bookings"
    SET
        "status" = COALESCE(p_status, "status"::text)::"BookingStatus",
        "technicianCode" = COALESCE(p_technician_code, "technicianCode"),
        "bedId" = COALESCE(p_bed_id, "bedId"),
        "roomName" = COALESCE(p_room_name, "roomName"),
        "notes" = COALESCE(p_notes, "notes"),
        "updatedAt" = now()
    WHERE "id" = p_booking_id;

    -- 4. Upsert BookingItems
    FOR v_item IN SELECT jsonb_array_elements(p_item_updates)
    LOOP
        UPDATE "BookingItems"
        SET 
            "roomName" = CASE WHEN v_item->>'roomName' IN ('', 'undefined', 'null') THEN NULL ELSE COALESCE(v_item->>'roomName', "roomName") END,
            "bedId" = CASE WHEN v_item->>'bedId' IN ('', 'undefined', 'null') THEN NULL ELSE COALESCE(v_item->>'bedId', "bedId") END,
            "technicianCodes" = CASE WHEN jsonb_typeof(v_item->'technicianCodes') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_item->'technicianCodes')) ELSE "technicianCodes" END,
            "status" = COALESCE(NULLIF(v_item->>'status', ''), "status"),
            "segments" = CASE WHEN jsonb_typeof(v_item->'segments') = 'array' THEN v_item->'segments' ELSE "segments" END,
            "options" = CASE WHEN jsonb_typeof(v_item->'options') = 'object' THEN v_item->'options' ELSE "options" END
        WHERE "id" = v_item->>'id';
    END LOOP;

    RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001090000', 'dispatch_plan_end_crosses_midnight') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261001091000_release_bumps_revision_keeps_handover ─────────────────────────────
-- P0-2 (plans/plan_fix_sequential_p0_p1_20261001.md): lưu form cũ sau khi KTV bàn giao làm mất
-- handoverTime + ảnh. (a) trường bàn giao vào snapshot → RELEASE tăng dispatchRevision;
-- (b) dispatch_commit_form_base giữ bằng chứng KTV từ bản đang lưu.
-- Thân hàm copy nguyên từ 20260927150000 (snapshot, history) và 20260929160000 (commit_form_base).
CREATE OR REPLACE FUNCTION dispatch_edit_snapshot(p_segments jsonb, p_options jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'segments', COALESCE((SELECT jsonb_object_agg(s->>'id', jsonb_strip_nulls(jsonb_build_object(
      'ktvId', s->'ktvId', 'sequenceSlot', s->'sequenceSlot', 'startTime', s->'startTime',
      'endTime', s->'endTime', 'duration', s->'duration', 'plannedStartAt', s->'plannedStartAt',
      'plannedEndAt', s->'plannedEndAt', 'actualStartTime', s->'actualStartTime',
      'actualEndTime', s->'actualEndTime', 'voided', s->'voided', 'pauses', s->'pauses',
      -- Bằng chứng bàn giao: phải làm tăng dispatchRevision để form quầy mở trước đó
      -- bị từ chối thay vì ghi đè mất ảnh/giờ bàn giao.
      'handoverTime', s->'handoverTime', 'handoverPhotoUrls', s->'handoverPhotoUrls',
      'feedbackTime', s->'feedbackTime')))
      FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(p_segments), '[]')) s WHERE s->>'id' IS NOT NULL), '{}'),
    'names', COALESCE(NULLIF(jsonb_unwrap_string(p_options)->'serviceNamesForKtvs', 'null'), '{}'),
    'displayName', jsonb_unwrap_string(p_options)->'displayName');
$$;

CREATE OR REPLACE FUNCTION keep_dispatch_edit_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_opts jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}');
  new_opts jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}');
  before_state jsonb;
  after_state jsonb;
  changes jsonb := '[]';
  old_seg jsonb;
  new_seg jsonb;
  segment_id text;
  field_name text;
  employee_id text;
  revision bigint := COALESCE((old_opts->>'dispatchRevision')::bigint, 0);
  action_name text := NULLIF(current_setting('app.dispatch_action', true), '');
  actor jsonb := COALESCE(NULLIF(current_setting('app.dispatch_actor', true), '')::jsonb, 'null');
BEGIN
  -- A background writer holding old options must not undo a saved service name.
  IF action_name IS NULL AND COALESCE((new_opts->>'dispatchRevision')::bigint, 0) < revision THEN
    new_opts := (new_opts - 'serviceNamesForKtvs' - 'displayName') ||
      jsonb_build_object('serviceNamesForKtvs', COALESCE(old_opts->'serviceNamesForKtvs', '{}'),
                         'displayName', old_opts->'displayName');
  END IF;
  before_state := dispatch_edit_snapshot(OLD.segments, old_opts);
  after_state := dispatch_edit_snapshot(NEW.segments, new_opts);
  FOR segment_id IN SELECT jsonb_object_keys(before_state->'segments') UNION SELECT jsonb_object_keys(after_state->'segments') LOOP
    old_seg := before_state->'segments'->segment_id;
    new_seg := after_state->'segments'->segment_id;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided','pauses',
      'handoverTime','handoverPhotoUrls','feedbackTime']) LOOP
      IF old_seg->field_name IS DISTINCT FROM new_seg->field_name THEN
        changes := changes || jsonb_build_array(jsonb_build_object('segmentId', segment_id,
          'employeeId', COALESCE(new_seg->>'ktvId', old_seg->>'ktvId'), 'field', field_name,
          'before', old_seg->field_name, 'after', new_seg->field_name));
      END IF;
    END LOOP;
  END LOOP;
  FOR employee_id IN SELECT jsonb_object_keys(before_state->'names') UNION SELECT jsonb_object_keys(after_state->'names') LOOP
    IF before_state->'names'->employee_id IS DISTINCT FROM after_state->'names'->employee_id THEN
      changes := changes || jsonb_build_array(jsonb_build_object('employeeId', employee_id,
        'field', 'serviceNameForKtv', 'before', before_state->'names'->employee_id, 'after', after_state->'names'->employee_id));
    END IF;
  END LOOP;
  IF before_state->'displayName' IS DISTINCT FROM after_state->'displayName' THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'displayName',
      'before', before_state->'displayName', 'after', after_state->'displayName'));
  END IF;
  new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
    'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]'));
  -- Preserve counter entries that arrived while the form was open, plus new entries.
  IF old_opts ? 'counterLog' OR new_opts ? 'counterLog' THEN
    new_opts := jsonb_set(new_opts, '{counterLog}', COALESCE((SELECT jsonb_agg(value ORDER BY first_pos)
      FROM (SELECT value, min(ord) first_pos FROM jsonb_array_elements(
        COALESCE(old_opts->'counterLog', '[]') || COALESCE(new_opts->'counterLog', '[]')) WITH ORDINALITY a(value, ord)
        GROUP BY value) unique_entries), '[]'));
  END IF;
  IF changes <> '[]' OR action_name IS NOT NULL THEN
    revision := revision + 1;
    new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
      'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]') || jsonb_build_array(jsonb_build_object(
        'revision', revision, 'at', clock_timestamp(), 'action', COALESCE(action_name, 'UPDATE'),
        'actor', actor, 'changes', changes)));
  END IF;
  NEW.options := new_opts;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_commit_form_base(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb; desired jsonb; old jsonb;
  seg jsonb; incoming jsonb; plans jsonb; next_b jsonb; old_b jsonb;
  revision bigint; result jsonb; updates jsonb := '[]'; removed text;
  confirm_overlap boolean; service_day date; start_at timestamptz;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH') OR jsonb_typeof(COALESCE(p_payload->'itemUpdates','[]')) <> 'array' THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')))
    <> jsonb_array_length(COALESCE(p_payload->'itemUpdates','[]')) THEN RAISE EXCEPTION 'Trùng dịch vụ trong bản lưu'; END IF;
  -- Lock and check every revision before the first removal, enable, or assignment.
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) ORDER BY value->>'id' LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id FOR UPDATE;
    IF NOT FOUND OR COALESCE((jsonb_unwrap_string(item.options)->>'dispatchRevision')::bigint,0)
      <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Bản đang sửa chưa được lưu; tải lại và kiểm tra.';
    END IF;
  END LOOP;
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id';
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    desired:=COALESCE(jsonb_unwrap_string(edit->'segments'),old);
    IF jsonb_typeof(desired)<>'array' OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(desired))<>jsonb_array_length(desired) THEN
      RAISE EXCEPTION 'Danh sách chặng không hợp lệ';
    END IF;
    FOR incoming IN SELECT value FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' LOOP
      IF COALESCE(incoming->>'id','')='' OR COALESCE(incoming->>'ktvId','')=''
        OR COALESCE(incoming->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR COALESCE((incoming->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ'; END IF;
    END LOOP;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND
      ((SELECT count(DISTINCT value->>'sequenceSlot') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
      OR (EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'))
      OR (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'sequenceSlot','') NOT IN ('1','2'))
      OR (SELECT count(DISTINCT value->>'ktvId') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')) THEN
      RAISE EXCEPTION 'Nối tiếp cần A và tối đa một B khác nhân viên';
    END IF;
    -- Actual work is immutable even if a client omits it from the form.
    FOR seg IN SELECT value FROM jsonb_array_elements(old) WHERE COALESCE(value->>'voided','false')<>'true'
      AND (COALESCE(value->>'actualStartTime','')<>'' OR COALESCE(value->>'actualEndTime','')<>'') LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['ktvId','roomId','bedId','startTime','endTime','duration','actualStartTime','actualEndTime']) k
        WHERE COALESCE(incoming->>k,'') IS DISTINCT FROM COALESCE(seg->>k,'')) THEN
        RAISE EXCEPTION 'Nhân viên đã bắt đầu; dùng Dừng/Đổi để giữ giờ thực tế';
      END IF;
    END LOOP;
    -- Bằng chứng KTV tạo (ảnh bắt đầu, dép khách, bàn giao, giờ feedback) thuộc về
    -- server. Form quầy chỉ sửa kế hoạch; giữ nguyên bản đang lưu của từng chặng
    -- dù client gửi bản cũ hoặc bỏ trống.
    desired := COALESCE((SELECT jsonb_agg(
        CASE WHEN o.value IS NULL THEN d.value
             ELSE (d.value - ARRAY['handoverTime','handoverPhotoUrls','feedbackTime','reviewTime','startPhotoUrl','guestSlipperPhotoUrl'])
                  || COALESCE((SELECT jsonb_object_agg(k.key, k.value) FROM jsonb_each(o.value) k
                     WHERE k.key = ANY(ARRAY['handoverTime','handoverPhotoUrls','feedbackTime','reviewTime','startPhotoUrl','guestSlipperPhotoUrl'])), '{}')
        END ORDER BY d.ord)
      FROM jsonb_array_elements(desired) WITH ORDINALITY d(value, ord)
      LEFT JOIN LATERAL (SELECT x.value FROM jsonb_array_elements(old) x WHERE x.value->>'id' = d.value->>'id' LIMIT 1) o ON true), '[]');
    edit := edit || jsonb_build_object('segments', desired);
    IF item.status NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED') THEN
      IF p_action='DISPATCH' AND item.status IN ('NEW','WAITING') AND EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') THEN
        edit:=edit||jsonb_build_object('status','PREPARING');
      END IF;
      updates:=updates||jsonb_build_array(edit); CONTINUE;
    END IF;
    confirm_overlap:=COALESCE(p_payload->'confirmedOverlapItemIds','[]') ? item.id
      OR (jsonb_array_length(p_payload->'itemUpdates')=1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false));
    revision:=COALESCE((opts->>'dispatchRevision')::bigint,0);
    FOR removed IN SELECT DISTINCT value->>'ktvId' FROM jsonb_array_elements(old) oldseg
      WHERE COALESCE(value->>'voided','false')<>'true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n
        WHERE n->>'ktvId'=oldseg.value->>'ktvId' AND COALESCE(n->>'voided','false')<>'true') LOOP
      result:=dispatch_unassign_unstarted_staff(p_booking_id,item.id,removed,revision,p_actor);
      revision:=(result->>'revision')::bigint;
    END LOOP;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}'); old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    next_b:=NULL;
    SELECT value INTO next_b FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    SELECT value INTO old_b FROM jsonb_array_elements(old) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    -- New employees can only enter a live form as an unstarted sequential B.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n WHERE COALESCE(n->>'voided','false')<>'true'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old) s WHERE s->>'id'=n->>'id' AND s->>'ktvId'=n->>'ktvId' AND COALESCE(s->>'voided','false')<>'true')
      AND NOT (jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND n->>'sequenceSlot'='2' AND old_b IS NULL)) THEN
      RAISE EXCEPTION 'Ca đã điều phối; nhân viên mới chỉ được gán vào lượt B chưa bắt đầu';
    END IF;
    -- Build the old shape for the shared DRAFT updater; historical work is copied from DB.
    plans:='[]';
    FOR seg IN SELECT value FROM jsonb_array_elements(old) LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND value->>'ktvId'=seg->>'ktvId' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NOT NULL AND COALESCE(seg->>'voided','false')<>'true' AND COALESCE(seg->>'actualStartTime','')='' AND COALESCE(seg->>'actualEndTime','')='' THEN
        seg:=seg||jsonb_build_object('startTime',incoming->'startTime','endTime',incoming->'endTime','duration',incoming->'duration');
      END IF;
      plans:=plans||jsonb_build_array(seg);
    END LOOP;
    incoming:=edit||jsonb_build_object('segments',plans,'options',COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||
      jsonb_build_object('dispatchRevision',revision,'sequentialSlots',opts->'sequentialSlots'));
    result:=dispatch_apply_edit(p_booking_id,'DRAFT',p_payload||jsonb_build_object('newGuests','[]'::jsonb,'guestUpdates','[]'::jsonb,
      'itemUpdates',jsonb_build_array(incoming - 'guest_id'),'confirmOverlap',confirm_overlap),p_actor);
    revision:=(result->'revisions'->>item.id)::bigint;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
      result:=dispatch_apply_edit(p_booking_id,'ENABLE_SEQUENTIAL',jsonb_build_object('itemId',item.id,'expectedRevision',revision),p_actor);
      revision:=(result->'revisions'->>item.id)::bigint;
    END IF;
    IF next_b IS NOT NULL AND old_b IS NULL THEN
      SELECT value INTO seg FROM "BookingItems" bi,jsonb_array_elements(jsonb_unwrap_string(bi.segments)) WHERE bi.id=item.id AND value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
      IF seg IS NULL OR COALESCE(next_b->>'roomId','') IS DISTINCT FROM COALESCE(seg->>'roomId','') OR COALESCE(next_b->>'bedId','') IS DISTINCT FROM COALESCE(seg->>'bedId','') THEN
        RAISE EXCEPTION 'Lượt B cần cùng phòng và giường với A';
      END IF;
      start_at:=COALESCE(NULLIF(next_b->>'plannedStartAt','')::timestamptz,(service_day+(next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF COALESCE(next_b->>'plannedStartAt','')='' AND next_b->>'startTime'<seg->>'startTime' THEN start_at:=start_at+interval '1 day'; END IF;
      result:=dispatch_apply_edit(p_booking_id,'ASSIGN_B',jsonb_build_object('itemId',item.id,'expectedRevision',revision,'toKtvId',next_b->>'ktvId',
        'plannedStartAt',start_at,'durationMinutes',(next_b->>'duration')::integer,'confirmOverlap',confirm_overlap),p_actor);
      IF result->>'code'='OVERLAP_CONFIRM_REQUIRED' THEN RAISE EXCEPTION USING MESSAGE='OVERLAP_CONFIRM_REQUIRED',DETAIL=(result||jsonb_build_object('itemId',item.id))::text; END IF;
      IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Không gán được B'; END IF;
    END IF;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    -- The final common call applies guest changes and metadata with the acknowledged revision.
    updates:=updates||jsonb_build_array(edit||jsonb_build_object('segments',jsonb_unwrap_string(item.segments),
      'technicianCodes',to_jsonb(item."technicianCodes"),'status',item.status,'options',jsonb_unwrap_string(item.options)||
      (COALESCE(jsonb_unwrap_string(edit->'options'),'{}')-'dispatchRevision')||jsonb_build_object('dispatchRevision',jsonb_unwrap_string(item.options)->'dispatchRevision')));
  END LOOP;
  result:=dispatch_apply_edit(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',updates),p_actor);
  IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Chưa lưu được phân công'; END IF;
  RETURN result||jsonb_build_object('savedItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',bi.id,'status',bi.status,
    'segments',jsonb_unwrap_string(bi.segments),'options',jsonb_unwrap_string(bi.options),'roomName',bi."roomName",'bedId',bi."bedId") ORDER BY bi.id)
    FROM "BookingItems" bi WHERE bi."bookingId"=p_booking_id AND bi.id IN(SELECT value->>'id' FROM jsonb_array_elements(updates))),'[]'));
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001091000', 'release_bumps_revision_keeps_handover') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261001092000_finish_atomic_never_regress_done ─────────────────────────────
-- P1-1 (plans/plan_fix_sequential_p0_p1_20261001.md): không lùi item DONE (CLAUDE.md 9.6).
-- Thân hàm copy nguyên từ 20260927150000_sequential_scoped_lifecycle.sql, chỉ thêm chốt DONE.
CREATE OR REPLACE FUNCTION ktv_finish_service_atomic(
    p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb,
    p_guest_ratings jsonb, p_updates jsonb, p_booking_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    booking_row "Bookings"%ROWTYPE;
    item_row "BookingItems"%ROWTYPE;
    snapshot jsonb;
    patch jsonb;
    field text;
    guests jsonb;
BEGIN
    IF jsonb_typeof(p_item_snapshots) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_guest_ratings) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_updates) = 0
       OR p_booking_status IS NULL
       OR p_booking_status NOT IN ('NEW','PREPARING','IN_PROGRESS','CLEANING','FEEDBACK','DONE') THEN
        RAISE EXCEPTION 'Invalid FINISH batch';
    END IF;
    SELECT * INTO booking_row FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    -- Match dispatch's lock order: booking, items by id, guests by id.
    PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
    PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
    IF p_booking_snapshot->>'id' IS DISTINCT FROM p_booking_id
       OR to_jsonb(booking_row)->'status' IS DISTINCT FROM p_booking_snapshot->'status'
       OR to_jsonb(booking_row)->'rating' IS DISTINCT FROM p_booking_snapshot->'rating' THEN
        RAISE EXCEPTION 'FINISH snapshot changed; reload booking';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rating',rating) ORDER BY id),'[]') INTO guests
      FROM "BookingGuests" WHERE booking_id = p_booking_id;
    IF guests IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(value ORDER BY value->>'id'),'[]') FROM jsonb_array_elements(p_guest_ratings)) THEN
        RAISE EXCEPTION 'FINISH ratings changed; reload booking';
    END IF;
    IF jsonb_array_length(p_item_snapshots) <> (SELECT count(*) FROM "BookingItems" WHERE "bookingId" = p_booking_id)
       OR jsonb_array_length(p_item_snapshots) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_item_snapshots))
       OR jsonb_array_length(p_updates) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_updates)) THEN
        RAISE EXCEPTION 'FINISH item set changed; reload booking';
    END IF;
    FOR snapshot IN SELECT value FROM jsonb_array_elements(p_item_snapshots) LOOP
        SELECT * INTO item_row FROM "BookingItems" WHERE id = snapshot->>'id' AND "bookingId" = p_booking_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'FINISH item not found'; END IF;
        -- Every field used by the handler must be present, not omitted by a malformed payload.
        IF NOT snapshot ?& ARRAY['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'] THEN
            RAISE EXCEPTION 'Incomplete FINISH snapshot';
        END IF;
        FOR field IN SELECT jsonb_object_keys(snapshot) LOOP
            IF (CASE WHEN field = 'handover_submitted_at'
                THEN item_row.handover_submitted_at IS DISTINCT FROM (snapshot->>field)::timestamptz
                ELSE to_jsonb(item_row)->field IS DISTINCT FROM snapshot->field END) THEN
                RAISE EXCEPTION 'FINISH item snapshot changed: %; reload booking', item_row.id;
            END IF;
        END LOOP;
    END LOOP;
    FOR patch IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_item_snapshots) s WHERE s->>'id' = patch->>'id')
           OR patch->>'status' IS NULL
           OR patch->>'status' NOT IN ('CANCELLED','DONE','IN_PROGRESS','PAUSED','CLEANING','FEEDBACK')
           OR NOT patch ? 'status'
           OR (patch - ARRAY['id','segments','status','handover_images','handover_status','handover_skipped','handover_submitted_at']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Invalid FINISH item update';
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') = 'string' THEN
            patch := jsonb_set(patch,'{segments}',(patch->>'segments')::jsonb);
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Invalid FINISH segments';
        END IF;
        SELECT * INTO item_row FROM "BookingItems" WHERE id = patch->>'id' AND "bookingId" = p_booking_id;
        -- Chốt cuối ở DB: dịch vụ đã DONE không được lùi, bất kể handler nào gửi lên.
        IF item_row.status::text = 'DONE' AND patch->>'status' IS DISTINCT FROM 'DONE' THEN
            RAISE EXCEPTION 'Dịch vụ đã hoàn tất, không được lùi trạng thái: %', item_row.id;
        END IF;
        SELECT * INTO item_row FROM jsonb_populate_record(item_row,patch - 'id');
        UPDATE "BookingItems" SET segments = item_row.segments, status = item_row.status,
            handover_images = item_row.handover_images, handover_status = item_row.handover_status,
            handover_skipped = item_row.handover_skipped, handover_submitted_at = item_row.handover_submitted_at
          WHERE id = item_row.id;
    END LOOP;
    SELECT * INTO booking_row FROM jsonb_populate_record(booking_row, jsonb_build_object('status', p_booking_status));
    UPDATE "Bookings" SET status = booking_row.status, "updatedAt" = now() WHERE id = p_booking_id RETURNING * INTO booking_row;
    RETURN jsonb_build_object('success',true,'booking',to_jsonb(booking_row));
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001092000', 'finish_atomic_never_regress_done') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261001100000_assign_b_dedupe_technician_codes ─────────────────────────────
-- F3 (plans/plan_fix_feedback_test_tay_20261001.md): gán B không được thêm KTV đã có sẵn
-- trong technicianCodes (TEST: ["B","C","C"] → hai dòng "C" trên điều phối/Kanban).
-- Thân hàm copy nguyên từ 20260929160000_live_queue_and_early_b.sql, chỉ đổi 1 dòng.
CREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(
    p_booking_id text, p_item_id text, p_to_ktv text,
    p_planned_start_at timestamptz, p_duration_minutes integer, p_confirm_overlap boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_a_assignment "KtvAssignments"%ROWTYPE;
    v_turn "TurnQueue"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_new_b jsonb;
    v_reference timestamptz;
    v_old_ktv text;
    v_b_id text;
    v_end_at timestamptz;
    v_service_day date;
    v_expected_at timestamptz;
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT "bookingDate"::date INTO v_service_day FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF v_service_day IS NULL THEN RAISE EXCEPTION 'Missing service day'; END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND (COALESCE(value->>'voided', 'false') <> 'true'
      OR (COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb AND value->>'note'='CANCELLED_NO_CREDIT'))
    ORDER BY COALESCE(value->>'voided','false')='true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR (COALESCE(v_options->>'finishedAfterA', 'false') = 'true' OR COALESCE(v_options->'closedSequentialSlots','[]') @> '[2]'::jsonb)
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND (status IN ('ACTIVE', 'COMPLETED')
        OR (status='CANCELLED' AND COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb))
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công của A'; END IF;
    v_reference := COALESCE(NULLIF(v_a->>'actualEndTime', '')::timestamptz,
                            v_a_assignment.planned_end_time);
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND v_reference IS NOT NULL THEN
        IF v_a_assignment.planned_start_time IS NOT NULL
           AND v_reference <= v_a_assignment.planned_start_time THEN
            v_reference := v_reference + interval '1 day';
        END IF;
    END IF;
    v_expected_at := (v_service_day + (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < (v_a->>'startTime')::time THEN
        v_expected_at := v_expected_at + interval '1 day';
    END IF;
    IF p_planned_start_at IS DISTINCT FROM v_expected_at OR v_a_assignment.business_date <> v_service_day THEN
        RAISE EXCEPTION 'B must follow the booking service day; reload plan';
    END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'Giờ kết thúc của A chưa hợp lệ; hãy sửa mốc A'; END IF;
    IF p_planned_start_at < v_reference AND COALESCE(p_confirm_overlap, false) = false THEN
        RETURN jsonb_build_object('success', false, 'code', 'OVERLAP_CONFIRM_REQUIRED',
            'referenceAt', v_reference, 'referenceKind',
            CASE WHEN COALESCE(v_a->>'actualEndTime', '') <> '' THEN 'actual' ELSE 'planned' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Staff" WHERE id = p_to_ktv AND status = 'ĐANG LÀM') THEN
        RAISE EXCEPTION 'KTV B không khả dụng';
    END IF;
    v_old_ktv := v_b->>'ktvId';
    SELECT * INTO v_turn FROM "TurnQueue"
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date FOR UPDATE;
    IF NOT FOUND OR (p_to_ktv IS DISTINCT FROM v_old_ktv
       AND (v_turn.status <> 'waiting' OR v_turn.current_order_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'KTV B không còn rảnh; tải lại sổ tua';
    END IF;
    IF EXISTS (SELECT 1 FROM "KtvAssignments"
               WHERE employee_id = p_to_ktv AND business_date = v_a_assignment.business_date
                 AND status = 'ACTIVE' AND (booking_item_id <> p_item_id OR segment_id IS DISTINCT FROM v_b->>'id')) THEN
        RAISE EXCEPTION 'KTV B đang có phân công khác';
    END IF;
    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id = p_to_ktv
      AND ka.status = 'ACTIVE' AND (ka.booking_item_id <> p_item_id OR ka.segment_id IS DISTINCT FROM v_b->>'id')
      AND ka.planned_start_time < v_end_at AND ka.planned_end_time > p_planned_start_at) THEN
        RAISE EXCEPTION 'KTV B has another overlapping assignment';
    END IF;
    v_b_id := CASE WHEN p_to_ktv = v_old_ktv THEN v_b->>'id' ELSE gen_random_uuid()::text END;
    v_new_b := jsonb_build_object(
        'id', v_b_id, 'ktvId', p_to_ktv, 'sequenceSlot', 2,
        'roomId', v_a->'roomId', 'bedId', v_a->'bedId',
        'plannedStartAt', p_planned_start_at, 'plannedEndAt', v_end_at,
        'startTime', to_char(p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'endTime', to_char(v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'duration', p_duration_minutes);
    IF v_b IS NOT NULL THEN
        IF p_to_ktv = v_old_ktv THEN
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b_id THEN v_new_b ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        ELSE
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                                  THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
            v_segments := v_segments || jsonb_build_array(v_new_b);
            UPDATE "KtvAssignments" SET status = 'CANCELLED'
            WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
            DELETE FROM "TurnLedger" tl USING "Bookings" booking
            WHERE booking.id = p_booking_id AND tl.date = v_a_assignment.business_date
              AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
              AND tl.employee_id = v_old_ktv
              AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                              JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                              WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                                AND ka.business_date = tl.date AND ka.employee_id = v_old_ktv
                                AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
            PERFORM promote_next_assignment(v_old_ktv, v_a_assignment.business_date);
        END IF;
    ELSE
        v_segments := v_segments || jsonb_build_array(v_new_b);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET segments = v_segments,
        "technicianCodes" = array_append(array_remove(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv), p_to_ktv)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id,
        segment_id, planned_start_time, planned_end_time, room_id, bed_id, status, dispatch_source)
    VALUES (p_to_ktv, v_a_assignment.business_date, p_booking_id, p_item_id, v_b_id,
        p_planned_start_at, v_end_at, v_a->>'roomId', v_a->>'bedId', 'ACTIVE', 'SEQUENTIAL_SLOT_B')
    ON CONFLICT (employee_id, booking_item_id) DO UPDATE SET
        segment_id = EXCLUDED.segment_id, planned_start_time = EXCLUDED.planned_start_time,
        planned_end_time = EXCLUDED.planned_end_time, status = 'ACTIVE',
        dispatch_source = EXCLUDED.dispatch_source;
    UPDATE "TurnQueue" SET status = 'assigned', current_order_id = p_booking_id,
        booking_item_id = p_item_id, booking_item_ids = ARRAY[p_item_id]::text[],
        room_id = v_a->>'roomId', bed_id = v_a->>'bedId',
        start_time = (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time = (v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date;
    INSERT INTO "TurnLedger" (date, booking_id, employee_id, source)
    SELECT v_a_assignment.business_date, COALESCE(parent_booking_id, id), p_to_ktv, 'DISPATCH_CONFIRM'
    FROM "Bookings" WHERE id = p_booking_id
    ON CONFLICT (date, booking_id, employee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'segmentId', v_b_id);
END;
$$;

-- Dọn mảng đã bị trùng (giữ thứ tự xuất hiện đầu tiên).
UPDATE "BookingItems" SET "technicianCodes" = ARRAY(
    SELECT c FROM (SELECT c, min(o) o FROM unnest("technicianCodes") WITH ORDINALITY u(c, o) GROUP BY c) x ORDER BY o)
WHERE cardinality("technicianCodes") <> (SELECT count(DISTINCT c) FROM unnest("technicianCodes") c)
  -- PROD 04/10/2026: chỉ đơn từ 04/10 — không sửa dữ liệu quá khứ.
  AND EXISTS (SELECT 1 FROM "Bookings" b WHERE b.id = "BookingItems"."bookingId" AND b."bookingDate" >= TIMESTAMP '2026-10-04');

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001100000', 'assign_b_dedupe_technician_codes') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261001101000_start_promotes_target_assignment ─────────────────────────────
-- F6b (plans/plan_fix_feedback_test_tay_20261001.md): KTV được bắt đầu đúng chặng mình bấm.
-- Thân hàm copy nguyên từ 20260929010000_unstick_staff_and_running_duration.sql, chỉ thêm khối đổi thứ tự.
CREATE OR REPLACE FUNCTION ktv_start_service_atomic(
  p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb, p_guest_ratings jsonb,
  p_updates jsonb, p_employee_id text, p_target_segment_id text, p_started_at timestamptz, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b "Bookings"%ROWTYPE; t "TurnQueue"%ROWTYPE; result jsonb; service_day date;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b."timeStart" IS DISTINCT FROM NULLIF(p_booking_snapshot->>'timeStart','')::timestamptz
     OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'START snapshot changed; reload'; END IF;
  service_day := b."bookingDate"::date;
  IF service_day IS NULL OR p_started_at IS NULL OR COALESCE(p_employee_id,'') = '' THEN RAISE EXCEPTION 'Invalid START'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) patch,
    jsonb_array_elements(jsonb_unwrap_string(patch->'segments')) seg
    WHERE seg->>'id' = p_target_segment_id AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\s+-\s+'))
      AND COALESCE(seg->>'voided','false') <> 'true' AND NULLIF(seg->>'actualStartTime','')::timestamptz = p_started_at) THEN
    RAISE EXCEPTION 'Invalid START target';
  END IF;
  -- KTV bấm bắt đầu một chặng đang QUEUED/READY (vd 2 dịch vụ, chặng B đã tới lượt trong khi
  -- dịch vụ kia chưa bắt đầu): đưa chặng đó lên ACTIVE, hạ phân công ACTIVE CHƯA bắt đầu khác
  -- của chính KTV trong ngày về QUEUED. Phân công đã bắt đầu thì không đụng.
  IF EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id=p_employee_id AND business_date=service_day
             AND booking_id=p_booking_id AND segment_id=p_target_segment_id AND status IN ('QUEUED','READY')) THEN
    UPDATE "KtvAssignments" ka SET status='QUEUED', updated_at=clock_timestamp()
      WHERE ka.employee_id=p_employee_id AND ka.business_date=service_day AND ka.status='ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM "BookingItems" i, jsonb_array_elements(COALESCE(jsonb_unwrap_string(i.segments),'[]')) s
                        WHERE i.id=ka.booking_item_id AND (ka.segment_id IS NULL OR s->>'id'=ka.segment_id)
                          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
                          AND COALESCE(s->>'voided','false')<>'true' AND COALESCE(s->>'actualStartTime','')<>'');
    UPDATE "KtvAssignments" SET status='ACTIVE', updated_at=clock_timestamp()
      WHERE employee_id=p_employee_id AND business_date=service_day AND booking_id=p_booking_id
        AND segment_id=p_target_segment_id AND status IN ('QUEUED','READY');
  END IF;
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}'
    OR p_turn_patch->>'current_order_id' IS DISTINCT FROM p_booking_id THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  IF t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id THEN
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=p_employee_id
      AND ka.business_date=service_day AND ka.booking_id=p_booking_id AND ka.segment_id=p_target_segment_id
      AND ka.status='ACTIVE')
      OR EXISTS (SELECT 1 FROM "BookingItems" old_item,
        jsonb_array_elements(COALESCE(jsonb_unwrap_string(old_item.segments),'[]')) old_seg
        WHERE old_item."bookingId"=t.current_order_id
          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(old_seg->>'ktvId'),'\s+-\s+'))
          AND COALESCE(old_seg->>'voided','false')<>'true'
          AND COALESCE(old_seg->>'actualStartTime','')<>''
          AND (COALESCE(old_seg->>'actualEndTime','')='' OR (COALESCE(old_seg->>'handoverTime','')=''
            AND NOT (old_item.handover_status='SKIPPED' AND old_item.handover_skipped IS TRUE)))) THEN
      RAISE EXCEPTION 'Ca trước chưa bàn giao hoặc phân công mới đã đổi; tải lại';
    END IF;
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

-- Sửa dữ liệu TEST: phân công bị ghi đè segment_id=null bởi dòng "giữ chỗ" thiếu segmentId
-- (page.tsx keepalive). Gán lại khi item chỉ có đúng 1 chặng sống của KTV đó.
UPDATE "KtvAssignments" ka SET segment_id = x.seg_id, updated_at = clock_timestamp()
FROM (SELECT ka2.id, min(s->>'id') seg_id
      FROM "KtvAssignments" ka2 JOIN "BookingItems" i ON i.id = ka2.booking_item_id,
           jsonb_array_elements(COALESCE(jsonb_unwrap_string(i.segments),'[]')) s
      WHERE ka2.segment_id IS NULL AND ka2.status IN ('ACTIVE','QUEUED','READY')
        AND ka2.business_date >= DATE '2026-10-04' -- PROD 04/10: không sửa dữ liệu quá khứ
        AND s->>'ktvId' = ka2.employee_id AND COALESCE(s->>'voided','false') <> 'true'
      GROUP BY ka2.id HAVING count(*) = 1) x
WHERE ka.id = x.id;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001101000', 'start_promotes_target_assignment') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261001102000_running_a_remove_b_then_adjust ─────────────────────────────
-- F8 (plans/plan_fix_feedback_test_tay_20261001.md): bỏ B chưa bắt đầu khi A đang làm — kèm hoặc
-- không kèm đổi thời lượng A — trong một lần lưu. Trước đây: bỏ B + đổi A bị chặn; chỉ bỏ B thì
-- không đóng lượt 2 nên A bấm Xong bị trigger chặn "còn lượt chưa hoàn tất". Thân hàm copy nguyên từ 20260929030000_running_form_commit_all_states.sql.
CREATE OR REPLACE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb;
  old_a jsonb; incoming_a jsonb; old_b jsonb; incoming_b jsonb; saved jsonb;
  a_minutes integer; b_minutes integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
  close_b boolean;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old_a:=NULL; incoming_a:=NULL; old_b:=NULL; incoming_b:=NULL; close_b:=false;
    IF FOUND AND item.status::text IN ('IN_PROGRESS','PAUSED') THEN
      SELECT value INTO old_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
          AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')='';
      IF old_a IS NOT NULL THEN
        SELECT value INTO incoming_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
          WHERE value->>'id'=old_a->>'id' AND COALESCE(value->>'voided','false')<>'true';
        SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
          WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
        IF old_b IS NOT NULL THEN
          SELECT value INTO incoming_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
            WHERE value->>'id'=old_b->>'id' AND COALESCE(value->>'voided','false')<>'true';
        END IF;
      END IF;
    END IF;
    -- Quầy bỏ B chưa bắt đầu khi A đang làm (kèm hoặc không kèm đổi thời lượng A; quầy đã
    -- xác nhận popup). Thứ tự: (1) gỡ B — void, huỷ phân công, xoá lượt tua nếu B không còn
    -- phân công; (2) đổi thời lượng A nếu có; (3) đóng lượt 2 để dịch vụ hoàn tất theo A.
    -- Đóng lượt 2 SAU khi đổi A vì _a chặn giảm A dưới thời lượng dịch vụ khi B đã đóng.
    IF old_a IS NOT NULL AND old_b IS NOT NULL AND incoming_b IS NULL AND COALESCE(old_b->>'actualStartTime','')='' THEN
      PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
        COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
      SELECT * INTO item FROM "BookingItems" WHERE id = item.id;
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision'));
      changes := changes || jsonb_build_array(jsonb_build_object('itemId', item.id,
        'employeeId', old_b->>'ktvId', 'removedB', true));
      old_b := NULL; close_b := true;
    END IF;
    IF old_a IS NOT NULL AND incoming_a IS NOT NULL AND
      (incoming_a->'duration' IS DISTINCT FROM old_a->'duration' OR
       (old_b IS NOT NULL AND incoming_b IS NOT NULL AND
        (incoming_b->>'startTime' IS DISTINCT FROM old_b->>'startTime' OR
         incoming_b->'duration' IS DISTINCT FROM old_b->'duration'))) THEN
      a_minutes:=(incoming_a->>'duration')::integer;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
        WHERE COALESCE(incoming_a->>k,'') IS DISTINCT FROM COALESCE(old_a->>k,''))
        OR incoming_a->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(old_a->>'startTime')::time)+make_interval(mins=>a_minutes),'HH24:MI') THEN
        RAISE EXCEPTION 'Chỉ được đổi thời lượng A; giữ nguyên nhân viên, phòng và giờ bắt đầu';
      END IF;
      IF old_b IS NOT NULL THEN
        IF incoming_b IS NULL OR COALESCE(old_b->>'actualStartTime','')<>''
          OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) k
            WHERE COALESCE(incoming_b->>k,'') IS DISTINCT FROM COALESCE(old_b->>k,'')) THEN
          RAISE EXCEPTION 'Chỉ được đổi thời lượng A và giờ B chưa bắt đầu';
        END IF;
        b_minutes:=(incoming_b->>'duration')::integer;
        IF incoming_b->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(incoming_b->>'startTime')::time)+make_interval(mins=>b_minutes),'HH24:MI') THEN
          RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
        END IF;
        saved:=dispatch_adjust_running_sequential_pair(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),
          a_minutes,incoming_b->>'startTime',b_minutes,'{}'::jsonb,p_actor);
        saved:=saved->'savedItem';
        changes:=changes||jsonb_build_array(
          jsonb_build_object('itemId',item.id,'employeeId',old_a->>'ktvId','minutes',a_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id')),
          jsonb_build_object('itemId',item.id,'employeeId',old_b->>'ktvId','minutes',b_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id')));
      ELSE
        saved:=dispatch_adjust_running_sequential_a(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),a_minutes,p_actor);
        changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
          'minutes',a_minutes,'startTime',saved->>'startTime','endTime',saved->>'endTime','closedB',saved->'closedB'));
      END IF;
      edit:=edit||jsonb_build_object('segments',saved->'segments','options',
        COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object(
          'dispatchRevision',saved->'options'->'dispatchRevision')||
          CASE WHEN saved->'options' ? 'closedSequentialSlots'
            THEN jsonb_build_object('closedSequentialSlots',saved->'options'->'closedSequentialSlots')
            ELSE '{}'::jsonb END);
    END IF;
    IF close_b THEN
      PERFORM set_config('app.sequential_rpc','1',true);
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}')
        || jsonb_build_object('closedSequentialSlots',
             COALESCE(jsonb_unwrap_string(options)->'closedSequentialSlots','[]') || '[2]'::jsonb)
        WHERE id = item.id RETURNING * INTO item;
      PERFORM set_config('app.sequential_rpc','',true);
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision',
                              'closedSequentialSlots', jsonb_unwrap_string(item.options)->'closedSequentialSlots'));
    END IF;
    patched:=patched||jsonb_build_array(edit);
  END LOOP;
  result:=dispatch_commit_form_base(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',patched),p_actor);
  RETURN result||jsonb_build_object('durationChanges',changes);
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001102000', 'running_a_remove_b_then_adjust') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261001103000_remove_b_after_a_done_paused_and_notif_rule ─────────────────────────────
-- plans/plan_fix_feedback_test_tay_20261001.md (mục V1/V3/T3, 01/10/2026)
-- V3: gỡ B chưa bắt đầu được cả khi dịch vụ đang PAUSED (trước báo "Ca đã chuyển trạng thái" gây hiểu nhầm).
--     Thân copy nguyên từ 20260927180000_unassign_unstarted_dispatch_staff.sql, chỉ thêm 'PAUSED'.
CREATE OR REPLACE FUNCTION dispatch_unassign_unstarted_staff(
  p_booking_id text, p_item_id text, p_ktv_id text, p_expected_revision bigint, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item "BookingItems"%ROWTYPE;
  opts jsonb;
  v_segments jsonb;
  target jsonb;
  remaining jsonb;
  service_day date;
  family_id text;
BEGIN
  SELECT "bookingDate"::date, COALESCE(parent_booking_id,id) INTO service_day,family_id
    FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND OR item.status NOT IN ('NEW','WAITING','PREPARING','READY','IN_PROGRESS','PAUSED') THEN
    RAISE EXCEPTION 'Ca đã chuyển trạng thái; tải lại đơn';
  END IF;
  opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
  v_segments := COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF p_expected_revision IS NULL OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã có bản lưu mới; bản đang sửa chưa được lưu';
  END IF;
  SELECT value INTO target FROM jsonb_array_elements(v_segments)
    WHERE value->>'ktvId'=p_ktv_id AND COALESCE(value->>'voided','false') <> 'true' LIMIT 1;
  IF target IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      AND (COALESCE(s->>'actualStartTime','') <> '' OR COALESCE(s->>'actualEndTime','') <> '')) THEN
    RAISE EXCEPTION 'Nhân viên đã bắt đầu hoặc đã đổi; dùng Dừng/Đổi để giữ giờ thực tế';
  END IF;
  IF target->>'sequenceSlot'='1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      AND COALESCE(s->>'actualStartTime','') <> '') THEN
    RAISE EXCEPTION 'B đã bắt đầu; không được bỏ kế hoạch A qua thao tác bỏ phân công';
  END IF;
  v_segments := (SELECT jsonb_agg(CASE
    WHEN s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || jsonb_build_object('voided',true,'voidedAt',clock_timestamp(),'note','UNASSIGNED','customCommissionDuration',0)
    WHEN target->>'sequenceSlot'='1' AND s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || '{"sequenceSlot":1}'::jsonb
    ELSE s END ORDER BY ord) FROM jsonb_array_elements(v_segments) WITH ORDINALITY r(s,ord));
  remaining := COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(v_segments) s WHERE COALESCE(s->>'voided','false') <> 'true'),'[]');
  PERFORM set_config('app.dispatch_action','UNASSIGN_STAFF',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  PERFORM set_config('app.sequential_rpc','1',true);
  UPDATE "BookingItems" SET segments=v_segments,
    "technicianCodes"=ARRAY(SELECT DISTINCT s->>'ktvId' FROM jsonb_array_elements(remaining) s),
    status=CASE WHEN jsonb_array_length(remaining)=0 THEN 'WAITING' ELSE status END
    WHERE id=p_item_id;
  PERFORM set_config('app.sequential_rpc','',true);
  UPDATE "KtvAssignments" SET status='CANCELLED',updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND booking_id=p_booking_id AND employee_id=p_ktv_id
      AND status IN ('ACTIVE','QUEUED','READY');
  DELETE FROM "TurnLedger" tl WHERE tl.employee_id=p_ktv_id AND tl.date=service_day AND tl.booking_id=family_id
    AND NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka JOIN "Bookings" b ON b.id=ka.booking_id
      WHERE COALESCE(b.parent_booking_id,b.id)=family_id AND ka.employee_id=p_ktv_id
        AND ka.business_date=service_day AND ka.status IN ('ACTIVE','QUEUED','READY','COMPLETED'));
  PERFORM promote_next_assignment(p_ktv_id,service_day);
  SELECT COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint,0) INTO p_expected_revision
    FROM "BookingItems" WHERE id=p_item_id;
  PERFORM set_config('app.dispatch_action','',true);
  PERFORM set_config('app.dispatch_actor','',true);
  RETURN jsonb_build_object('success',true,'revision',p_expected_revision);
END $$;

-- V1: A đã xong + form bỏ B → tự "Kết thúc sau A". Thân copy từ 20261001102000_running_a_remove_b_then_adjust.sql.
CREATE OR REPLACE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb;
  old_a jsonb; incoming_a jsonb; old_b jsonb; incoming_b jsonb; saved jsonb;
  a_minutes integer; b_minutes integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
  close_b boolean; done_a jsonb; item_found boolean;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
    item_found := FOUND;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old_a:=NULL; incoming_a:=NULL; old_b:=NULL; incoming_b:=NULL; close_b:=false;
    IF FOUND AND item.status::text IN ('IN_PROGRESS','PAUSED') THEN
      SELECT value INTO old_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
          AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')='';
      IF old_a IS NOT NULL THEN
        SELECT value INTO incoming_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
          WHERE value->>'id'=old_a->>'id' AND COALESCE(value->>'voided','false')<>'true';
        SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
          WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
        IF old_b IS NOT NULL THEN
          SELECT value INTO incoming_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
            WHERE value->>'id'=old_b->>'id' AND COALESCE(value->>'voided','false')<>'true';
        END IF;
      END IF;
    END IF;
    -- V1: A đã XONG (dịch vụ còn chờ B) mà form bỏ B chưa bắt đầu → hoàn tất dịch vụ theo A,
    -- đúng như thao tác "Kết thúc sau A". Trước đây chỉ void B: dịch vụ kẹt IN_PROGRESS mãi.
    IF item_found AND old_a IS NULL AND item.status::text='IN_PROGRESS' AND opts->>'sequentialSlots'='2' THEN
      done_a:=NULL; old_b:=NULL;
      SELECT value INTO done_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')<>'';
      SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
      IF done_a IS NOT NULL AND old_b IS NOT NULL AND COALESCE(old_b->>'actualStartTime','')=''
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]')) n
                        WHERE n->>'id'=old_b->>'id' AND COALESCE(n->>'voided','false')<>'true') THEN
        PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
        PERFORM dispatch_finish_sequential_after_a(p_booking_id, item.id);
        SELECT * INTO item FROM "BookingItems" WHERE id = item.id;
        edit := edit || jsonb_build_object('status', item.status::text,
          'segments', jsonb_unwrap_string(item.segments),
          'technicianCodes', to_jsonb(item."technicianCodes"),
          'options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}') || jsonb_build_object(
            'dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision',
            'finishedAfterA', true));
        changes := changes || jsonb_build_array(jsonb_build_object('itemId', item.id,
          'employeeId', old_b->>'ktvId', 'removedB', true, 'finishedAfterA', true));
      END IF;
      old_b := NULL;
    END IF;
    -- Quầy bỏ B chưa bắt đầu khi A đang làm (kèm hoặc không kèm đổi thời lượng A; quầy đã
    -- xác nhận popup). Thứ tự: (1) gỡ B — void, huỷ phân công, xoá lượt tua nếu B không còn
    -- phân công; (2) đổi thời lượng A nếu có; (3) đóng lượt 2 để dịch vụ hoàn tất theo A.
    -- Đóng lượt 2 SAU khi đổi A vì _a chặn giảm A dưới thời lượng dịch vụ khi B đã đóng.
    IF old_a IS NOT NULL AND old_b IS NOT NULL AND incoming_b IS NULL AND COALESCE(old_b->>'actualStartTime','')='' THEN
      PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
        COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
      SELECT * INTO item FROM "BookingItems" WHERE id = item.id;
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision'));
      changes := changes || jsonb_build_array(jsonb_build_object('itemId', item.id,
        'employeeId', old_b->>'ktvId', 'removedB', true));
      old_b := NULL; close_b := true;
    END IF;
    IF old_a IS NOT NULL AND incoming_a IS NOT NULL AND
      (incoming_a->'duration' IS DISTINCT FROM old_a->'duration' OR
       (old_b IS NOT NULL AND incoming_b IS NOT NULL AND
        (incoming_b->>'startTime' IS DISTINCT FROM old_b->>'startTime' OR
         incoming_b->'duration' IS DISTINCT FROM old_b->'duration'))) THEN
      a_minutes:=(incoming_a->>'duration')::integer;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
        WHERE COALESCE(incoming_a->>k,'') IS DISTINCT FROM COALESCE(old_a->>k,''))
        OR incoming_a->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(old_a->>'startTime')::time)+make_interval(mins=>a_minutes),'HH24:MI') THEN
        RAISE EXCEPTION 'Chỉ được đổi thời lượng A; giữ nguyên nhân viên, phòng và giờ bắt đầu';
      END IF;
      IF old_b IS NOT NULL THEN
        IF incoming_b IS NULL OR COALESCE(old_b->>'actualStartTime','')<>''
          OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) k
            WHERE COALESCE(incoming_b->>k,'') IS DISTINCT FROM COALESCE(old_b->>k,'')) THEN
          RAISE EXCEPTION 'Chỉ được đổi thời lượng A và giờ B chưa bắt đầu';
        END IF;
        b_minutes:=(incoming_b->>'duration')::integer;
        IF incoming_b->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(incoming_b->>'startTime')::time)+make_interval(mins=>b_minutes),'HH24:MI') THEN
          RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
        END IF;
        saved:=dispatch_adjust_running_sequential_pair(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),
          a_minutes,incoming_b->>'startTime',b_minutes,'{}'::jsonb,p_actor);
        saved:=saved->'savedItem';
        changes:=changes||jsonb_build_array(
          jsonb_build_object('itemId',item.id,'employeeId',old_a->>'ktvId','minutes',a_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id')),
          jsonb_build_object('itemId',item.id,'employeeId',old_b->>'ktvId','minutes',b_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id')));
      ELSE
        saved:=dispatch_adjust_running_sequential_a(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),a_minutes,p_actor);
        changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
          'minutes',a_minutes,'startTime',saved->>'startTime','endTime',saved->>'endTime','closedB',saved->'closedB'));
      END IF;
      edit:=edit||jsonb_build_object('segments',saved->'segments','options',
        COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object(
          'dispatchRevision',saved->'options'->'dispatchRevision')||
          CASE WHEN saved->'options' ? 'closedSequentialSlots'
            THEN jsonb_build_object('closedSequentialSlots',saved->'options'->'closedSequentialSlots')
            ELSE '{}'::jsonb END);
    END IF;
    IF close_b THEN
      PERFORM set_config('app.sequential_rpc','1',true);
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}')
        || jsonb_build_object('closedSequentialSlots',
             COALESCE(jsonb_unwrap_string(options)->'closedSequentialSlots','[]') || '[2]'::jsonb)
        WHERE id = item.id RETURNING * INTO item;
      PERFORM set_config('app.sequential_rpc','',true);
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision',
                              'closedSequentialSlots', jsonb_unwrap_string(item.options)->'closedSequentialSlots'));
    END IF;
    patched:=patched||jsonb_build_array(edit);
  END LOOP;
  result:=dispatch_commit_form_base(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',patched),p_actor);
  RETURN result||jsonb_build_object('durationChanges',changes);
END $$;

-- T3: rule thông báo đổi đơn cho KTV — chỉ người được nhắc tới nhận (trước đây không có rule
-- nên mọi KTV đều thấy thông báo đổi giờ/bỏ lượt của đồng nghiệp). Chỉ thêm khi chưa có.
UPDATE "SystemConfigs"
SET value = (CASE WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb ELSE value END)
  || jsonb_build_object('KTV_ORDER_CHANGED', jsonb_build_object(
       'icon', '🔁', 'label', 'Quầy đổi phân công của KTV', 'sound', 'ktv-don-hang-moi.wav',
       'enabled', true, 'allowed_roles', jsonb_build_array('ktv'),
       'require_on_shift', false, 'include_target_employee', true))
WHERE key = 'notification_rules'
  AND NOT ((CASE WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb ELSE value END) ? 'KTV_ORDER_CHANGED');

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001103000', 'remove_b_after_a_done_paused_and_notif_rule') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261002090000_reject_order_uses_unassign_rpc ─────────────────────────────
-- plans/plan_fix_reject_order_ket_don_20261002.md (02/10/2026)
-- KTV từ chối đơn dùng chung RPC bỏ phân công của quầy (void chặng, huỷ KtvAssignments,
-- đẩy phân công kế tiếp) thay vì route tự gỡ một nửa. p_reject=true: giữ tua (TurnLedger)
-- như hành vi cũ của từ chối và xoá mốc "đã nhận đơn" của chính KTV.
-- Thân copy nguyên từ bản đang chạy (= 20261001103000), chỉ thêm p_reject.
DROP FUNCTION IF EXISTS dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb);
CREATE OR REPLACE FUNCTION public.dispatch_unassign_unstarted_staff(p_booking_id text, p_item_id text, p_ktv_id text, p_expected_revision bigint, p_actor jsonb, p_reject boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  item "BookingItems"%ROWTYPE;
  opts jsonb;
  v_segments jsonb;
  target jsonb;
  remaining jsonb;
  service_day date;
  family_id text;
BEGIN
  SELECT "bookingDate"::date, COALESCE(parent_booking_id,id) INTO service_day,family_id
    FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND OR item.status NOT IN ('NEW','WAITING','PREPARING','READY','IN_PROGRESS','PAUSED') THEN
    RAISE EXCEPTION 'Ca đã chuyển trạng thái; tải lại đơn';
  END IF;
  opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
  v_segments := COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF p_expected_revision IS NULL OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã có bản lưu mới; bản đang sửa chưa được lưu';
  END IF;
  SELECT value INTO target FROM jsonb_array_elements(v_segments)
    WHERE value->>'ktvId'=p_ktv_id AND COALESCE(value->>'voided','false') <> 'true' LIMIT 1;
  IF target IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      AND (COALESCE(s->>'actualStartTime','') <> '' OR COALESCE(s->>'actualEndTime','') <> '')) THEN
    RAISE EXCEPTION 'Nhân viên đã bắt đầu hoặc đã đổi; dùng Dừng/Đổi để giữ giờ thực tế';
  END IF;
  IF target->>'sequenceSlot'='1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      AND COALESCE(s->>'actualStartTime','') <> '') THEN
    RAISE EXCEPTION 'B đã bắt đầu; không được bỏ kế hoạch A qua thao tác bỏ phân công';
  END IF;
  v_segments := (SELECT jsonb_agg(CASE
    WHEN s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || jsonb_build_object('voided',true,'voidedAt',clock_timestamp(),'note','UNASSIGNED','customCommissionDuration',0)
    WHEN target->>'sequenceSlot'='1' AND s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || '{"sequenceSlot":1}'::jsonb
    ELSE s END ORDER BY ord) FROM jsonb_array_elements(v_segments) WITH ORDINALITY r(s,ord));
  remaining := COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(v_segments) s WHERE COALESCE(s->>'voided','false') <> 'true'),'[]');
  PERFORM set_config('app.dispatch_action','UNASSIGN_STAFF',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  PERFORM set_config('app.sequential_rpc','1',true);
  IF COALESCE(p_reject,false) THEN
    -- KTV rejected: their own acceptance stamp must not survive a later re-dispatch to them.
    opts := (opts #- ARRAY['acceptedByStaff',p_ktv_id]) #- ARRAY['acceptedByStaff',upper(p_ktv_id)];
    IF lower(COALESCE(opts->>'acceptedBy',''))=lower(p_ktv_id) THEN opts := opts - 'acceptedBy' - 'acceptedAt'; END IF;
  END IF;
  UPDATE "BookingItems" SET segments=v_segments, options=opts,
    "technicianCodes"=ARRAY(SELECT DISTINCT s->>'ktvId' FROM jsonb_array_elements(remaining) s),
    status=CASE WHEN jsonb_array_length(remaining)=0 THEN 'WAITING' ELSE status END
    WHERE id=p_item_id;
  PERFORM set_config('app.sequential_rpc','',true);
  UPDATE "KtvAssignments" SET status='CANCELLED',updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND booking_id=p_booking_id AND employee_id=p_ktv_id
      AND status IN ('ACTIVE','QUEUED','READY');
  -- A reject still costs the KTV their turn (same as before 02/10/2026); only reception unassign refunds it.
  IF NOT COALESCE(p_reject,false) THEN
  DELETE FROM "TurnLedger" tl WHERE tl.employee_id=p_ktv_id AND tl.date=service_day AND tl.booking_id=family_id
    AND NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka JOIN "Bookings" b ON b.id=ka.booking_id
      WHERE COALESCE(b.parent_booking_id,b.id)=family_id AND ka.employee_id=p_ktv_id
        AND ka.business_date=service_day AND ka.status IN ('ACTIVE','QUEUED','READY','COMPLETED'));
  END IF;
  PERFORM promote_next_assignment(p_ktv_id,service_day);
  SELECT COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint,0) INTO p_expected_revision
    FROM "BookingItems" WHERE id=p_item_id;
  PERFORM set_config('app.dispatch_action','',true);
  PERFORM set_config('app.dispatch_actor','',true);
  RETURN jsonb_build_object('success',true,'revision',p_expected_revision);
END $fn$
;
REVOKE ALL ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb,boolean) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002090000', 'reject_order_uses_unassign_rpc') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261002100000_adjust_running_sequential_b ─────────────────────────────
-- plans/plan_fix_doi_gio_b_dang_lam_va_nut_tai_lai_20261002.md (H1, 02/10/2026)
-- A đã xong, B (lượt 2) đang làm: quầy đổi thời lượng B qua form điều phối.
-- (1) RPC mới dispatch_adjust_running_sequential_b — thân dẫn từ dispatch_adjust_running_sequential_a
--     đang chạy: chọn chặng lượt 2 đang chạy, A phải xong; mốc kết thúc mới phải sau hiện tại.
-- (2) dispatch_commit_form — thân copy nguyên bản đang chạy trên TEST, chỉ thêm nhánh H1.
CREATE OR REPLACE FUNCTION public.dispatch_adjust_running_sequential_b(p_booking_id text, p_item_id text, p_expected_revision bigint, p_minutes integer, p_actor jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE; opts jsonb; segs jsonb; a jsonb;
  service_minutes integer; service_day date; starts_at timestamptz; ends_at timestamptz;
  previous_rpc text; previous_action text; previous_actor text;
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 600 OR p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Thời lượng phải từ 1 đến 600 phút';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED')
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi sửa thời lượng';
  END IF;
  -- `a` here is the running slot-2 (B) segment; every other live segment (A) must be finished.
  SELECT value INTO a FROM jsonb_array_elements(segs)
    WHERE opts->>'sequentialSlots'='2' AND value->>'sequenceSlot'='2'
      AND COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'actualStartTime','')<>''
      AND COALESCE(value->>'actualEndTime','')='';
  IF a IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(segs) s WHERE s->>'id' IS DISTINCT FROM a->>'id'
      AND COALESCE(s->>'voided','false')<>'true' AND COALESCE(s->>'actualEndTime','')='') THEN
    RAISE EXCEPTION 'Chỉ được sửa thời lượng B đang làm sau khi A đã xong';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF ends_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Thời lượng mới phải lớn hơn số phút B đã làm (% phút)',
      floor(extract(epoch FROM clock_timestamp()-starts_at)/60)::integer;
  END IF;
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status='ACTIVE'
    AND (ka.employee_id=a->>'ktvId' OR (ka.room_id=a->>'roomId' AND ka.bed_id=a->>'bedId'))
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của B';
  END IF;
  segs:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  previous_rpc:=current_setting('app.sequential_rpc',true);
  previous_action:=current_setting('app.dispatch_action',true);
  previous_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_B_DURATION',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(previous_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(previous_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(previous_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=starts_at,planned_end_time=ends_at,updated_at=clock_timestamp()
    WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=a->>'ktvId'
      AND (segment_id=a->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id=a->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('employeeId',a->>'ktvId','minutes',p_minutes,
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'closedB',COALESCE(jsonb_unwrap_string(saved.options)->'closedSequentialSlots','[]') @> '[2]'::jsonb,
    'segments',jsonb_unwrap_string(saved.segments),'options',jsonb_unwrap_string(saved.options));
END $fn$
;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_b(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_b(text,text,bigint,integer,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_commit_form(p_booking_id text, p_action text, p_payload jsonb, p_actor jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb;
  old_a jsonb; incoming_a jsonb; old_b jsonb; incoming_b jsonb; saved jsonb;
  a_minutes integer; b_minutes integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
  close_b boolean; done_a jsonb; item_found boolean;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
    item_found := FOUND;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old_a:=NULL; incoming_a:=NULL; old_b:=NULL; incoming_b:=NULL; close_b:=false;
    IF FOUND AND item.status::text IN ('IN_PROGRESS','PAUSED') THEN
      SELECT value INTO old_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
          AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')='';
      IF old_a IS NOT NULL THEN
        SELECT value INTO incoming_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
          WHERE value->>'id'=old_a->>'id' AND COALESCE(value->>'voided','false')<>'true';
        SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
          WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
        IF old_b IS NOT NULL THEN
          SELECT value INTO incoming_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
            WHERE value->>'id'=old_b->>'id' AND COALESCE(value->>'voided','false')<>'true';
        END IF;
      END IF;
    END IF;
    -- V1: A đã XONG (dịch vụ còn chờ B) mà form bỏ B chưa bắt đầu → hoàn tất dịch vụ theo A,
    -- đúng như thao tác "Kết thúc sau A". Trước đây chỉ void B: dịch vụ kẹt IN_PROGRESS mãi.
    IF item_found AND old_a IS NULL AND item.status::text='IN_PROGRESS' AND opts->>'sequentialSlots'='2' THEN
      done_a:=NULL; old_b:=NULL;
      SELECT value INTO done_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')<>'';
      SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
      IF done_a IS NOT NULL AND old_b IS NOT NULL AND COALESCE(old_b->>'actualStartTime','')=''
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]')) n
                        WHERE n->>'id'=old_b->>'id' AND COALESCE(n->>'voided','false')<>'true') THEN
        PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
        PERFORM dispatch_finish_sequential_after_a(p_booking_id, item.id);
        SELECT * INTO item FROM "BookingItems" WHERE id = item.id;
        edit := edit || jsonb_build_object('status', item.status::text,
          'segments', jsonb_unwrap_string(item.segments),
          'technicianCodes', to_jsonb(item."technicianCodes"),
          'options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}') || jsonb_build_object(
            'dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision',
            'finishedAfterA', true));
        changes := changes || jsonb_build_array(jsonb_build_object('itemId', item.id,
          'employeeId', old_b->>'ktvId', 'removedB', true, 'finishedAfterA', true));
      END IF;
      old_b := NULL;
    END IF;
    -- H1 (02/10/2026): A đã xong, B (lượt 2) đang làm — quầy đổi thời lượng B (đã xác nhận popup).
    -- Trước đây không có nhánh này nên base chặn "Nhân viên đã bắt đầu".
    IF item_found AND old_a IS NULL AND item.status::text IN ('IN_PROGRESS','PAUSED') AND opts->>'sequentialSlots'='2' THEN
      old_b:=NULL; incoming_b:=NULL;
      SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')='';
      IF old_b IS NOT NULL THEN
        SELECT value INTO incoming_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
          WHERE value->>'id'=old_b->>'id' AND COALESCE(value->>'voided','false')<>'true';
        IF incoming_b IS NOT NULL AND incoming_b->'duration' IS DISTINCT FROM old_b->'duration' THEN
          b_minutes:=(incoming_b->>'duration')::integer;
          IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
            WHERE COALESCE(incoming_b->>k,'') IS DISTINCT FROM COALESCE(old_b->>k,'')) THEN
            RAISE EXCEPTION 'Chỉ được đổi thời lượng B đang làm; giữ nguyên nhân viên, phòng và giờ bắt đầu';
          END IF;
          saved:=dispatch_adjust_running_sequential_b(p_booking_id,item.id,
            COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),b_minutes,p_actor);
          changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
            'minutes',b_minutes,'startTime',saved->>'startTime','endTime',saved->>'endTime'));
          edit:=edit||jsonb_build_object('segments',saved->'segments','options',
            COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object('dispatchRevision',saved->'options'->'dispatchRevision'));
        END IF;
      END IF;
      old_b:=NULL; incoming_b:=NULL;
    END IF;
    -- Quầy bỏ B chưa bắt đầu khi A đang làm (kèm hoặc không kèm đổi thời lượng A; quầy đã
    -- xác nhận popup). Thứ tự: (1) gỡ B — void, huỷ phân công, xoá lượt tua nếu B không còn
    -- phân công; (2) đổi thời lượng A nếu có; (3) đóng lượt 2 để dịch vụ hoàn tất theo A.
    -- Đóng lượt 2 SAU khi đổi A vì _a chặn giảm A dưới thời lượng dịch vụ khi B đã đóng.
    IF old_a IS NOT NULL AND old_b IS NOT NULL AND incoming_b IS NULL AND COALESCE(old_b->>'actualStartTime','')='' THEN
      PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
        COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
      SELECT * INTO item FROM "BookingItems" WHERE id = item.id;
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision'));
      changes := changes || jsonb_build_array(jsonb_build_object('itemId', item.id,
        'employeeId', old_b->>'ktvId', 'removedB', true));
      old_b := NULL; close_b := true;
    END IF;
    IF old_a IS NOT NULL AND incoming_a IS NOT NULL AND
      (incoming_a->'duration' IS DISTINCT FROM old_a->'duration' OR
       (old_b IS NOT NULL AND incoming_b IS NOT NULL AND
        (incoming_b->>'startTime' IS DISTINCT FROM old_b->>'startTime' OR
         incoming_b->'duration' IS DISTINCT FROM old_b->'duration'))) THEN
      a_minutes:=(incoming_a->>'duration')::integer;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
        WHERE COALESCE(incoming_a->>k,'') IS DISTINCT FROM COALESCE(old_a->>k,''))
        OR incoming_a->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(old_a->>'startTime')::time)+make_interval(mins=>a_minutes),'HH24:MI') THEN
        RAISE EXCEPTION 'Chỉ được đổi thời lượng A; giữ nguyên nhân viên, phòng và giờ bắt đầu';
      END IF;
      IF old_b IS NOT NULL THEN
        IF incoming_b IS NULL OR COALESCE(old_b->>'actualStartTime','')<>''
          OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) k
            WHERE COALESCE(incoming_b->>k,'') IS DISTINCT FROM COALESCE(old_b->>k,'')) THEN
          RAISE EXCEPTION 'Chỉ được đổi thời lượng A và giờ B chưa bắt đầu';
        END IF;
        b_minutes:=(incoming_b->>'duration')::integer;
        IF incoming_b->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(incoming_b->>'startTime')::time)+make_interval(mins=>b_minutes),'HH24:MI') THEN
          RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
        END IF;
        saved:=dispatch_adjust_running_sequential_pair(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),
          a_minutes,incoming_b->>'startTime',b_minutes,'{}'::jsonb,p_actor);
        saved:=saved->'savedItem';
        changes:=changes||jsonb_build_array(
          jsonb_build_object('itemId',item.id,'employeeId',old_a->>'ktvId','minutes',a_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id')),
          jsonb_build_object('itemId',item.id,'employeeId',old_b->>'ktvId','minutes',b_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id')));
      ELSE
        saved:=dispatch_adjust_running_sequential_a(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),a_minutes,p_actor);
        changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
          'minutes',a_minutes,'startTime',saved->>'startTime','endTime',saved->>'endTime','closedB',saved->'closedB'));
      END IF;
      edit:=edit||jsonb_build_object('segments',saved->'segments','options',
        COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object(
          'dispatchRevision',saved->'options'->'dispatchRevision')||
          CASE WHEN saved->'options' ? 'closedSequentialSlots'
            THEN jsonb_build_object('closedSequentialSlots',saved->'options'->'closedSequentialSlots')
            ELSE '{}'::jsonb END);
    END IF;
    IF close_b THEN
      PERFORM set_config('app.sequential_rpc','1',true);
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}')
        || jsonb_build_object('closedSequentialSlots',
             COALESCE(jsonb_unwrap_string(options)->'closedSequentialSlots','[]') || '[2]'::jsonb)
        WHERE id = item.id RETURNING * INTO item;
      PERFORM set_config('app.sequential_rpc','',true);
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision',
                              'closedSequentialSlots', jsonb_unwrap_string(item.options)->'closedSequentialSlots'));
    END IF;
    patched:=patched||jsonb_build_array(edit);
  END LOOP;
  result:=dispatch_commit_form_base(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',patched),p_actor);
  RETURN result||jsonb_build_object('durationChanges',changes);
END $fn$
;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002100000', 'adjust_running_sequential_b') ON CONFLICT (version) DO NOTHING;

COMMIT;

-- =====================================================================================
-- [A] Nếu bước [0] báo chồng giờ: xem các cặp phân công ACTIVE/QUEUED/READY chồng giờ (chạy riêng)
-- SELECT a.employee_id, a.id AS a_id, a.status AS a_status, a.business_date AS a_day, a.booking_item_id AS a_item, a.planned_start_time AS a_start, a.planned_end_time AS a_end,
--        b.id AS b_id, b.status AS b_status, b.business_date AS b_day, b.booking_item_id AS b_item, b.planned_start_time AS b_start, b.planned_end_time AS b_end
--   FROM "KtvAssignments" a JOIN "KtvAssignments" b ON a.employee_id = b.employee_id AND a.id < b.id
--  WHERE a.status IN ('ACTIVE','QUEUED','READY') AND b.status IN ('ACTIVE','QUEUED','READY')
--    AND a.business_date >= DATE '2026-10-04' AND b.business_date >= DATE '2026-10-04'
--    AND a.planned_start_time IS NOT NULL AND a.planned_end_time IS NOT NULL
--    AND b.planned_start_time IS NOT NULL AND b.planned_end_time IS NOT NULL
--    AND tstzrange(a.planned_start_time, GREATEST(a.planned_start_time, a.planned_end_time), '[)')
--     && tstzrange(b.planned_start_time, GREATEST(b.planned_start_time, b.planned_end_time), '[)');
--
-- [B] Nếu bước [0] báo phân công thiếu giờ: xem (chạy riêng). Dòng của ngày đã qua và đơn đã xong/huỷ
--     → chuyển COMPLETED/CANCELLED; dòng còn chạy hôm nay → điền planned_end_time = start + số phút còn lại.
-- SELECT ka.id, ka.employee_id, ka.business_date, ka.status, ka.dispatch_source, ka.booking_id, ka.booking_item_id,
--        ka.planned_start_time, ka.planned_end_time, bi.status AS item_status
--   FROM "KtvAssignments" ka LEFT JOIN "BookingItems" bi ON bi.id = ka.booking_item_id
--  WHERE ka.status IN ('ACTIVE','QUEUED','READY') AND ka.business_date >= DATE '2026-10-04'
--    AND (ka.planned_start_time IS NULL OR ka.planned_end_time IS NULL OR ka.planned_end_time <= ka.planned_start_time)
--  ORDER BY ka.business_date, ka.employee_id;
--
-- [Kiểm tra sau khi chạy] (chạy riêng)
-- 1) Đủ 29 dòng lịch sử:
-- SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20260925120000' AND '20261002100000';  → 29
-- 2) Ràng buộc chống trùng giờ có mặt:
-- SELECT conname FROM pg_constraint WHERE conname = 'ktv_assignments_no_live_overlap';
-- 3) Trigger mới trên BookingItems / KtvAssignments:
-- SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('"BookingItems"'::regclass, '"KtvAssignments"'::regclass) ORDER BY 2, 1;
-- 4) Không còn technicianCodes bị lặp:
-- SELECT count(*) FROM "BookingItems" WHERE cardinality("technicianCodes") <> (SELECT count(DISTINCT c) FROM unnest("technicianCodes") c);  → 0


-- #####################################################################################
-- PHẦN 2/4 — THANG SAO 4/5 (4 migration) — chỉ chạy khi PHẦN 1 đã COMMIT thành công
-- #####################################################################################
-- =====================================================================================
-- PRODUCTION — Thang đánh giá 4/5 sao (admin + kiosk + journey WRB)
-- Ngày soạn: 04/10/2026 · Nguồn: nhánh test/sequential-two-slot-handoff-20260928
-- Gồm 4 migration (đã chạy trên TEST eknggruuiuadwldacpmb ngày 02–03/10):
--   20261002110000_rating_scale_columns          thêm cột rating_scale (mặc định 4) cho Bookings / BookingItems / BookingGuests
--   20261002120000_rating_notifications_by_scale  thông báo "Xuất sắc"/chê theo thang của đúng đánh giá đó
--   20261002130000_ktvd_ledger_rating_scale       sổ Loại D lưu rating_scale; ktvd_commit_recompute ghi cột này (thiếu → 4)
--   20261003091000_enable_feedback_notification_rule  bật luật thông báo FEEDBACK cho đúng KTV được chấm
--
-- AN TOÀN VỚI CODE PRODUCTION HIỆN TẠI: mọi dữ liệu cũ / mọi lần ghi không gửi thang đều = 4,
-- y như hôm nay. Thang 5 chỉ có hiệu lực khi code mới (admin + WRB) lên và admin chọn 5 sao.
--
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor của project PRODUCTION → dán cả file → Run.
-- Cả file chạy trong 1 transaction: lỗi ở đâu thì không có gì được ghi.
-- =====================================================================================

-- [0] Chặn chạy nhầm: phải là DB có bảng KTVDTurnLedger và hàm ktvd_commit_recompute (writer v2, 20260922090000).
DO $$
BEGIN
  IF to_regclass('public."KTVDTurnLedger"') IS NULL THEN
    RAISE EXCEPTION 'Thiếu bảng KTVDTurnLedger — DB này chưa có migration 20260922090000, dừng.';
  END IF;
  IF to_regprocedure('public.ktvd_commit_recompute(integer,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Thiếu hàm ktvd_commit_recompute — DB này chưa có migration 20260922090000, dừng.';
  END IF;
END $$;

BEGIN;


-- ───────────────────────────── 20261002110000_rating_scale_columns ─────────────────────────────
-- plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md (GĐ1, 02/10/2026)
-- Mỗi đánh giá lưu kèm thang lúc chấm (4 hoặc 5 sao). Mặc định 4 = toàn bộ đánh giá cũ,
-- nên đổi thang trong Cài đặt không làm đổi tiền / thưởng / báo cáo của đánh giá đã có.
-- ADD COLUMN ... DEFAULT hằng số chỉ ghi metadata (không viết lại bảng).
ALTER TABLE "Bookings"      ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
ALTER TABLE "BookingItems"  ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
ALTER TABLE "BookingGuests" ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;

DO $$ BEGIN
  ALTER TABLE "Bookings"      ADD CONSTRAINT bookings_rating_scale_check      CHECK (rating_scale IN (4,5));
  ALTER TABLE "BookingItems"  ADD CONSTRAINT bookingitems_rating_scale_check  CHECK (rating_scale IN (4,5));
  ALTER TABLE "BookingGuests" ADD CONSTRAINT bookingguests_rating_scale_check CHECK (rating_scale IN (4,5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN "Bookings".rating_scale      IS 'Thang sao lúc chấm rating (4|5). Diễn giải rating theo cột này.';
COMMENT ON COLUMN "BookingItems".rating_scale  IS 'Thang sao lúc chấm itemRating/ktvRatings (4|5).';
COMMENT ON COLUMN "BookingGuests".rating_scale IS 'Thang sao lúc chấm rating/ktv_ratings của khách (4|5).';

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002110000', 'rating_scale_columns') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261002120000_rating_notifications_by_scale ─────────────────────────────
-- plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md (GĐ4, 02/10/2026)
-- Thông báo đánh giá theo thang của ĐÚNG đánh giá đó (rating_scale 4|5): "XUẤT SẮC"/thưởng chỉ
-- khi đạt mức cao nhất của thang; nhãn lấy theo cấu hình admin `rating_labels` (nội bộ),
-- thiếu thì dùng chữ mặc định — cùng quy tắc với lib/services/RatingScaleService.ts.
-- Thân 2 trigger copy nguyên bản đang chạy, chỉ thay các chỗ viết cứng thang 4.
CREATE OR REPLACE FUNCTION rating_is_excellent(p_rating numeric, p_scale integer)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_rating, 0) >= CASE WHEN p_scale = 5 THEN 5 ELSE 4 END;
$$;

CREATE OR REPLACE FUNCTION rating_label_internal(p_rating numeric, p_scale integer)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scale integer := CASE WHEN p_scale = 5 THEN 5 ELSE 4 END;
  v_level integer := LEAST(GREATEST(round(COALESCE(p_rating, 0))::integer, 0), v_scale);
  v_custom text;
BEGIN
  IF v_level <= 0 THEN RETURN 'Không xác định'; END IF;
  SELECT NULLIF(btrim(jsonb_unwrap_string(value)->(v_scale::text)->(v_level::text)->>'internal'), '')
    INTO v_custom FROM "SystemConfigs" WHERE key = 'rating_labels';
  IF v_custom IS NOT NULL THEN RETURN upper(v_custom); END IF;
  RETURN CASE
    WHEN v_level >= v_scale THEN 'XUẤT SẮC'
    WHEN v_scale = 5 AND v_level = 4 THEN 'TUYỆT VỜI'
    WHEN v_scale = 5 AND v_level = 3 THEN 'CHƯA ỔN LẮM'
    WHEN v_scale = 5 AND v_level = 2 THEN 'THẤT VỌNG'
    WHEN v_scale = 5 THEN 'CỰC KỲ TỆ'
    WHEN v_level = 3 THEN 'TỐT'
    WHEN v_level = 2 THEN 'BÌNH THƯỜNG'
    ELSE 'TỆ' END;
END $$;
REVOKE ALL ON FUNCTION rating_label_internal(numeric, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_item_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $fn$
DECLARE
    v_booking RECORD;
    v_tech_code TEXT;
    v_ktv_ratings JSONB;
    v_old_ktv_ratings JSONB;
    v_rating_label TEXT;
    v_ktv_rating INTEGER;
  v_scale INTEGER := CASE WHEN NEW.rating_scale = 5 THEN 5 ELSE 4 END;
    v_old_ktv_rating INTEGER;
BEGIN
    -- Chỉ chạy nếu rating có thay đổi
    IF (OLD."itemRating" IS NOT DISTINCT FROM NEW."itemRating") 
       AND (OLD."ktvRatings" IS NOT DISTINCT FROM NEW."ktvRatings") THEN
        RETURN NEW;
    END IF;

    -- Lấy thông tin booking
    SELECT "billCode", "technicianCode" INTO v_booking
    FROM public."Bookings"
    WHERE id = NEW."bookingId"
    LIMIT 1;

    v_ktv_ratings := COALESCE(NEW."ktvRatings", '{}'::JSONB);
    v_old_ktv_ratings := COALESCE(OLD."ktvRatings", '{}'::JSONB);

    -- ─── 1. XỬ LÝ THEO MẢNG KTVRATINGS (Per-KTV) ────────────────────────
    IF v_ktv_ratings != '{}'::JSONB AND NEW."technicianCodes" IS NOT NULL THEN

        FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
        LOOP
            v_tech_code := trim(v_tech_code);
            IF v_tech_code = '' THEN CONTINUE; END IF;

            v_ktv_rating := COALESCE((v_ktv_ratings->>v_tech_code)::INTEGER, 0);
            v_old_ktv_rating := COALESCE((v_old_ktv_ratings->>v_tech_code)::INTEGER, 0);

            -- CHỈ XỬ LÝ NẾU RATING CỦA KTV NÀY MỚI ĐƯỢC CẬP NHẬT
            IF v_ktv_rating != v_old_ktv_rating AND v_ktv_rating > 0 THEN
                v_rating_label := rating_label_internal(v_ktv_rating, v_scale);

                IF rating_is_excellent(v_ktv_rating, v_scale) THEN
                    -- KTV xuất sắc → nhận thưởng
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", v_tech_code, 'REWARD',
                        'Bạn vừa nhận được đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                        false, now()
                    );
                    -- THÊM: Báo cho Quầy
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", NULL, 'FEEDBACK',
                        'KTV ' || v_tech_code || ' nhận đánh giá ' || v_rating_label || ' từ đơn #' || COALESCE(v_booking."billCode", '???'),
                        false, now()
                    );
                ELSIF v_ktv_rating = 1 THEN
                    -- KTV bị đánh giá tệ → cảnh báo
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", v_tech_code, 'COMPLAINT',
                        'Bạn nhận được đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false, now()
                    );
                    -- Cảnh báo Admin
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", NULL, 'COMPLAINT',
                        'Khách đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' cho NV ' || v_tech_code || ' trong đơn #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false, now()
                    );
                END IF;
            END IF;
        END LOOP;

        RETURN NEW;
    END IF;

    -- ─── 2. XỬ LÝ THEO ITEMRATING CHUNG (Fallback) ────────────────────────
    IF OLD."itemRating" IS DISTINCT FROM NEW."itemRating" AND NEW."itemRating" IS NOT NULL THEN
        v_rating_label := rating_label_internal(NEW."itemRating", v_scale);

        IF NEW."technicianCodes" IS NOT NULL AND array_length(NEW."technicianCodes", 1) > 0 THEN
            v_tech_code := trim(NEW."technicianCodes"[1]);
        ELSE
            v_tech_code := v_booking."technicianCode";
        END IF;

        IF v_tech_code IS NULL OR v_tech_code = '' THEN
            RETURN NEW;
        END IF;

        IF rating_is_excellent(NEW."itemRating", v_scale) THEN
            IF NEW."technicianCodes" IS NOT NULL THEN
                FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
                LOOP
                    v_tech_code := trim(v_tech_code);
                    IF v_tech_code != '' THEN
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW."bookingId", v_tech_code, 'REWARD',
                            'Bạn vừa nhận được đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                            false, now()
                        );
                        -- THÊM: Báo cho Quầy
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW."bookingId", NULL, 'FEEDBACK',
                            'KTV ' || v_tech_code || ' nhận đánh giá ' || v_rating_label || ' từ đơn #' || COALESCE(v_booking."billCode", '???'),
                            false, now()
                        );
                    END IF;
                END LOOP;
            ELSIF v_booking."technicianCode" IS NOT NULL THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", trim(v_booking."technicianCode"), 'REWARD',
                    'Bạn vừa nhận được đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
                -- THÊM: Báo cho Quầy
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", NULL, 'FEEDBACK',
                    'KTV ' || trim(v_booking."technicianCode") || ' nhận đánh giá ' || v_rating_label || ' từ đơn #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
            END IF;
        ELSIF NEW."itemRating" = 1 THEN
            INSERT INTO public."StaffNotifications" (
                "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
            ) VALUES (
                NEW."bookingId", NULL, 'COMPLAINT',
                'Khách đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' cho NV ' || COALESCE(v_tech_code, '?') || ' trong đơn #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                false, now()
            );
            IF NEW."technicianCodes" IS NOT NULL THEN
                FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
                LOOP
                    v_tech_code := trim(v_tech_code);
                    IF v_tech_code != '' THEN
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW."bookingId", v_tech_code, 'COMPLAINT',
                            'Bạn nhận được đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                            false, now()
                        );
                    END IF;
                END LOOP;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$
;

CREATE OR REPLACE FUNCTION public.fn_master_notification_handler()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $fn$
DECLARE
    tech_list TEXT[];
    tech_code TEXT;
    curr_customer_name TEXT;
    location_info TEXT;
BEGIN
    -- Lấy thông tin cơ bản
    curr_customer_name := COALESCE(NEW."customerName", 'Khách vãng lai');
    
    -- Lấy thông tin vị trí (Phòng/Giường) nếu có
    location_info := 'Phòng ' || COALESCE(NEW."roomName", '???');
    IF NEW."bedId" IS NOT NULL AND NEW."bedId" != '' THEN
        location_info := location_info || ' - Giường ' || split_part(NEW."bedId", '-', array_length(string_to_array(NEW."bedId", '-'), 1));
    END IF;

    -- THỨ NHẤT: KHI CÓ ĐƠN HÀNG MỚI (INSERT) -> THÔNG BÁO CHO QUẦY/ADMIN (CÓ Tên khách)
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public."StaffNotifications" (
            "bookingId", "type", "message", "isRead", "createdAt"
        ) VALUES (
            NEW.id, 'NEW_ORDER',
            'Có đơn hàng mới #' || NEW."billCode" || ' từ khách ' || curr_customer_name,
            false, now()
        );
        RETURN NEW;
    END IF;

    -- THỨ HAI: KHI CẬP NHẬT ĐƠN HÀNG (UPDATE)
    IF (TG_OP = 'UPDATE') THEN
        
        -- A. THÔNG BÁO GÁN KTV (KTV Nhận đơn) - BẮT BUỘC KHÔNG IN TÊN KHÁCH
        IF (NEW."technicianCode" IS NOT NULL AND NEW."technicianCode" != '') AND 
           (OLD."technicianCode" IS DISTINCT FROM NEW."technicianCode" OR (OLD.status::text != NEW.status::text AND NEW.status::text = 'PREPARING')) 
        THEN
            tech_list := string_to_array(NEW."technicianCode", ',');
            FOREACH tech_code IN ARRAY tech_list
            LOOP
                tech_code := trim(tech_code);
                IF (NEW.status::text = 'PREPARING') OR (OLD."technicianCode" IS NULL OR NOT (OLD."technicianCode" LIKE '%' || tech_code || '%')) THEN
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW.id, tech_code, 'KTV_NEW_ORDER',
                        'Bạn có đơn mới #' || NEW."billCode" || ' tại ' || location_info,
                        false, now()
                    );
                END IF;
            END LOOP;
        END IF;

        -- B. THÔNG BÁO ĐÁNH GIÁ (Thưởng/Khiếu nại)
        IF OLD.rating IS DISTINCT FROM NEW.rating THEN
            -- Thưởng KTV khi nhận 4-5 sao (Rating >= 4)
            IF rating_is_excellent(NEW.rating, NEW.rating_scale) THEN
                tech_list := string_to_array(NEW."technicianCode", ',');
                IF array_length(tech_list, 1) > 0 THEN
                    FOREACH tech_code IN ARRAY tech_list
                    LOOP
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW.id, trim(tech_code), 'REWARD',
                            'Bạn vừa nhận được đánh giá XUẤT SẮC từ đơn hàng #' || NEW."billCode",
                            false, now()
                        );
                    END LOOP;
                END IF;
                
                -- THÊM: Báo cho Quầy
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, 'FEEDBACK',
                    'Đơn hàng #' || NEW."billCode" || ' được đánh giá XUẤT SẮC (' || NEW.rating || ' sao)!',
                    false, now()
                );
            END IF;

            -- Cảnh báo Admin khi bị 1 sao (Complaints)
            IF NEW.rating = 1 THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, 'COMPLAINT',
                    'Khách ' || curr_customer_name || ' đánh giá TỆ cho đơn #' || NEW."billCode" || ': ' || COALESCE(NEW."feedbackNote", 'Không có ghi chú'),
                    false, now()
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$
;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002120000', 'rating_notifications_by_scale') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261002130000_ktvd_ledger_rating_scale ─────────────────────────────
-- plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md (GĐ4, 02/10/2026)
-- Sổ Loại D lưu thang của `rating_used` (4|5) để ví / lịch sử gọi đúng tên mức sao và truy vết
-- được trừ/thưởng. Mặc định 4 = mọi dòng cũ. Thân ktvd_commit_recompute copy nguyên bản đang
-- chạy, chỉ thêm cột rating_scale vào 4 danh sách cột.
ALTER TABLE "KTVDTurnLedger" ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
DO $$ BEGIN
  ALTER TABLE "KTVDTurnLedger" ADD CONSTRAINT ktvdturnledger_rating_scale_check CHECK (rating_scale IN (4,5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.ktvd_commit_recompute(p_formula_revision integer, p_writer_commit text, p_entries jsonb, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_expected INTEGER;
  v_matched INTEGER;
  v_rows_written INTEGER := 0;
  v_rows_voided INTEGER := 0;
  v_rows_locked INTEGER := 0;
BEGIN
  IF p_formula_revision <> 2 THEN
    RAISE EXCEPTION 'Unsupported KTV commission formula revision: %', p_formula_revision;
  END IF;
  IF COALESCE(BTRIM(p_writer_commit), '') = '' THEN
    RAISE EXCEPTION 'writer_commit is required';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'entries and rows must be JSON arrays';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT e.booking_item_id)
    INTO v_expected, v_matched
  FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT);
  IF v_expected = 0 OR v_expected <> v_matched THEN
    RAISE EXCEPTION 'entries must contain unique booking_item_id values';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    WHERE e.booking_item_id IS NULL OR e.generation IS NULL
  ) THEN
    RAISE EXCEPTION 'each entry requires booking_item_id and generation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(staff_id TEXT, booking_item_id TEXT)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
      WHERE e.booking_item_id = r.booking_item_id
    )
  ) THEN
    RAISE EXCEPTION 'result contains a booking item outside the claimed queue entries';
  END IF;

  -- Serialize against source-trigger enqueues for these exact queue rows.
  PERFORM q."booking_item_id"
  FROM public."KTVDRecomputeQueue" q
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = q."booking_item_id"
  FOR UPDATE OF q;

  SELECT COUNT(*) INTO v_matched
  FROM public."KTVDRecomputeQueue" q
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = q."booking_item_id"
   AND e.generation = q."generation";
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'KTV recompute source changed or queue entry is missing';
  END IF;

  PERFORM set_config('app.ktvd_formula_revision', p_formula_revision::TEXT, true);

  SELECT COUNT(*) INTO v_rows_locked
  FROM public."KTVDTurnLedger" l
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = l."booking_item_id"
  WHERE l."entry_status" = 'LOCKED';

  INSERT INTO public."KTVDTurnLedger" AS ledger (
    "staff_id", "booking_item_id", "booking_id", "guest_id", "group_id", "work_date",
    "bill_code", "bill_suffix", "service_id", "service_name", "rate_category", "booking_time_start",
    "assigned_minutes", "actual_minutes", "paid_minutes", "custom_minutes",
    "rate_per_60m", "rating_used", "rating_source", "rating_scale", "deduction_rate",
    "commission_gross", "commission_net", "bonus_amount", "tax_amount", "tip",
    "item_status", "is_provisional", "entry_status", "handover_status", "handover_comment",
    "co_workers", "has_other_type_coworker", "source", "computed_at", "formula_revision", "writer_commit"
  )
  SELECT
    r.staff_id, r.booking_item_id, r.booking_id, r.guest_id, r.group_id, r.work_date,
    r.bill_code, COALESCE(r.bill_suffix, ''), r.service_id, r.service_name, r.rate_category, r.booking_time_start,
    r.assigned_minutes, r.actual_minutes, r.paid_minutes, r.custom_minutes,
    r.rate_per_60m, r.rating_used, r.rating_source, COALESCE(r.rating_scale, 4), r.deduction_rate,
    r.commission_gross, r.commission_net, COALESCE(r.bonus_amount, 0), r.tax_amount, r.tip,
    r.item_status, r.is_provisional, r.entry_status, r.handover_status, r.handover_comment,
    COALESCE(r.co_workers, ARRAY[]::TEXT[]), COALESCE(r.has_other_type_coworker, FALSE),
    'EVENT', NOW(), p_formula_revision, p_writer_commit
  FROM jsonb_to_recordset(p_rows) AS r(
    staff_id TEXT, booking_item_id TEXT, booking_id TEXT, guest_id TEXT, group_id TEXT, work_date DATE,
    bill_code TEXT, bill_suffix TEXT, service_id TEXT, service_name TEXT, rate_category TEXT,
    booking_time_start TIMESTAMP, assigned_minutes NUMERIC, actual_minutes NUMERIC, paid_minutes NUMERIC,
    custom_minutes NUMERIC, rate_per_60m NUMERIC, rating_used INTEGER, rating_source TEXT, rating_scale SMALLINT,
    deduction_rate NUMERIC, commission_gross NUMERIC, commission_net NUMERIC, bonus_amount NUMERIC,
    tax_amount NUMERIC, tip NUMERIC, item_status TEXT, is_provisional BOOLEAN, entry_status TEXT,
    handover_status TEXT, handover_comment TEXT, co_workers TEXT[], has_other_type_coworker BOOLEAN
  )
  ON CONFLICT ("staff_id", "booking_item_id") DO UPDATE SET
    "booking_id" = EXCLUDED."booking_id", "guest_id" = EXCLUDED."guest_id",
    "group_id" = EXCLUDED."group_id", "work_date" = EXCLUDED."work_date",
    "bill_code" = EXCLUDED."bill_code", "bill_suffix" = EXCLUDED."bill_suffix",
    "service_id" = EXCLUDED."service_id", "service_name" = EXCLUDED."service_name",
    "rate_category" = EXCLUDED."rate_category", "booking_time_start" = EXCLUDED."booking_time_start",
    "assigned_minutes" = EXCLUDED."assigned_minutes", "actual_minutes" = EXCLUDED."actual_minutes",
    "paid_minutes" = EXCLUDED."paid_minutes", "custom_minutes" = EXCLUDED."custom_minutes",
    "rate_per_60m" = EXCLUDED."rate_per_60m", "rating_used" = EXCLUDED."rating_used", "rating_scale" = EXCLUDED."rating_scale",
    "rating_source" = EXCLUDED."rating_source", "deduction_rate" = EXCLUDED."deduction_rate",
    "commission_gross" = EXCLUDED."commission_gross", "commission_net" = EXCLUDED."commission_net",
    "bonus_amount" = EXCLUDED."bonus_amount", "tax_amount" = EXCLUDED."tax_amount", "tip" = EXCLUDED."tip",
    "item_status" = EXCLUDED."item_status", "is_provisional" = EXCLUDED."is_provisional",
    "entry_status" = EXCLUDED."entry_status", "handover_status" = EXCLUDED."handover_status",
    "handover_comment" = EXCLUDED."handover_comment", "co_workers" = EXCLUDED."co_workers",
    "has_other_type_coworker" = EXCLUDED."has_other_type_coworker", "source" = EXCLUDED."source",
    "computed_at" = EXCLUDED."computed_at", "formula_revision" = EXCLUDED."formula_revision",
    "writer_commit" = EXCLUDED."writer_commit"
  WHERE ledger."entry_status" <> 'LOCKED';
  GET DIAGNOSTICS v_rows_written = ROW_COUNT;

  UPDATE public."KTVDTurnLedger" l
  SET "entry_status" = 'VOID', "source" = 'EVENT', "computed_at" = NOW(),
      "formula_revision" = p_formula_revision, "writer_commit" = p_writer_commit
  WHERE l."entry_status" NOT IN ('LOCKED', 'VOID')
    AND EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
      WHERE e.booking_item_id = l."booking_item_id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(staff_id TEXT, booking_item_id TEXT)
      WHERE r.staff_id = l."staff_id" AND r.booking_item_id = l."booking_item_id"
    );
  GET DIAGNOSTICS v_rows_voided = ROW_COUNT;

  DELETE FROM public."KTVDRecomputeQueue" q
  USING jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
  WHERE q."booking_item_id" = e.booking_item_id
    AND q."generation" = e.generation;
  GET DIAGNOSTICS v_matched = ROW_COUNT;
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'KTV queue acknowledgement lost a source generation';
  END IF;

  RETURN jsonb_build_object(
    'itemsRequested', v_expected,
    'rowsWritten', v_rows_written,
    'rowsVoided', v_rows_voided,
    'rowsSkippedLocked', v_rows_locked
  );
END;
$fn$
;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002130000', 'ktvd_ledger_rating_scale') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261003091000_enable_feedback_notification_rule ─────────────────────────────
-- 03/10/2026: kiosk feedback now writes its FEEDBACK notification (column fix in
-- app/reception/feedback/_components/actions.ts). Turn the FEEDBACK rule on so the rated KTV
-- sees it — ONLY that KTV: no role broadcast (allowed_roles []) + include_target_employee.
UPDATE "SystemConfigs"
SET value = jsonb_set(
      COALESCE(jsonb_unwrap_string(value), '{}'::jsonb),
      '{FEEDBACK}',
      COALESCE(jsonb_unwrap_string(value)->'FEEDBACK', '{}'::jsonb)
        || '{"enabled": true, "label": "Khách đánh giá KTV", "allowed_roles": [], "include_target_employee": true, "require_on_shift": false}'::jsonb,
      true),
    updated_at = now()
WHERE key = 'notification_rules';

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261003091000', 'enable_feedback_notification_rule') ON CONFLICT (version) DO NOTHING;

COMMIT;

-- =====================================================================================
-- [Kiểm tra sau khi chạy] — chạy riêng, mọi dòng phải ra như ghi chú
-- =====================================================================================
-- 1) 4 bảng có cột rating_scale, mặc định 4:
-- SELECT table_name, column_default FROM information_schema.columns
--  WHERE column_name = 'rating_scale' AND table_schema = 'public' ORDER BY 1;
--   → Bookings, BookingGuests, BookingItems, KTVDTurnLedger · default 4
-- 2) Dữ liệu cũ đều là thang 4 (0 dòng khác 4):
-- SELECT count(*) FROM "BookingItems" WHERE rating_scale <> 4;
-- 3) Hàm mới có mặt:
-- SELECT proname FROM pg_proc WHERE proname IN ('rating_is_excellent','rating_label_internal','fn_notify_ktv_on_item_rating','fn_master_notification_handler','ktvd_commit_recompute');
-- 4) Luật FEEDBACK đã bật:
-- SELECT value->'FEEDBACK' FROM "SystemConfigs" WHERE key = 'notification_rules';
-- 5) Đã ghi lịch sử migration:
-- SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('20261002110000','20261002120000','20261002130000','20261003091000');


-- #####################################################################################
-- PHẦN 3/4 — THÔNG BÁO FEEDBACK CHO QUẦY + ADMIN (1 migration) — chạy SAU PHẦN 2
-- 20261003091000 (phần 2) đặt FEEDBACK chỉ gửi KTV được chấm; quyết định 04/10/2026: quầy/admin cũng nhận.
-- #####################################################################################
BEGIN;

-- ───────────────────────────── 20261004100000_feedback_notify_reception_admin ─────────────────────────────
-- 04/10/2026: reception (quầy) and admin must also receive FEEDBACK notifications.
-- 20261003091000 set FEEDBACK.allowed_roles = [] (only the rated KTV). Add 'admin' and
-- 'reception' to whatever roles are configured, keep include_target_employee for the KTV.
-- Role ids follow /admin/settings/notifications (ROLE_OPTIONS); lib/push-helper.ts maps
-- 'reception' to RECEPTIONIST / LEAD_RECEPTIONIST / legacy RECEPTION. Idempotent.
UPDATE "SystemConfigs" sc
SET value = jsonb_set(
      COALESCE(jsonb_unwrap_string(sc.value), '{}'::jsonb),
      '{FEEDBACK,allowed_roles}',
      (SELECT COALESCE(jsonb_agg(DISTINCT r ORDER BY r), '[]'::jsonb)
         FROM (
           SELECT jsonb_array_elements_text(COALESCE(jsonb_unwrap_string(sc.value)->'FEEDBACK'->'allowed_roles', '[]'::jsonb)) AS r
           UNION SELECT 'admin'
           UNION SELECT 'reception'
         ) roles),
      true),
    updated_at = now()
WHERE sc.key = 'notification_rules'
  AND jsonb_unwrap_string(sc.value) ? 'FEEDBACK';

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261004100000', 'feedback_notify_reception_admin') ON CONFLICT (version) DO NOTHING;

COMMIT;

-- #####################################################################################
-- PHẦN 4/4 — GIỮ NGUYÊN DỮ LIỆU QUÁ KHỨ: ràng buộc phân công chỉ áp từ ngày làm việc 04/10/2026
-- (đồng bộ với TEST; phần 1 ở bản production đã thêm sẵn cùng điều kiện nên phần này không đổi gì thêm)
-- #####################################################################################
BEGIN;

-- ───────────────────────────── 20261004110000_scope_ktv_assignment_guards_from_20261004 ─────────────────────────────
-- 04/10/2026: the live-assignment guards only apply from business date 2026-10-04 on.
-- Production holds ~320 assignments of earlier days still ACTIVE/QUEUED/READY (orders finished or
-- abandoned before the release/finish RPCs closed them), some overlapping or with an end before the
-- start (old cross-midnight bug). Decision: do not touch past data — leave those rows as they are
-- and enforce the rules for new work only. Same final state on TEST and production; idempotent.
-- Replaces the predicates of 20260928020000 / 20260929160000.

ALTER TABLE "KtvAssignments" DROP CONSTRAINT IF EXISTS ktv_assignments_no_live_overlap;
ALTER TABLE "KtvAssignments" ADD CONSTRAINT ktv_assignments_no_live_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(planned_start_time,GREATEST(planned_start_time,planned_end_time),'[)') WITH &&
  ) WHERE (status='ACTIVE' AND business_date >= DATE '2026-10-04'
    AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION validate_final_ktv_assignment_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KtvAssignments" WHERE id=NEW.id
    AND status IN ('ACTIVE','QUEUED','READY')
    AND business_date >= DATE '2026-10-04'
    AND (planned_start_time IS NULL OR planned_end_time IS NULL
      OR NOT isfinite(planned_start_time) OR NOT isfinite(planned_end_time)
      OR planned_end_time<=planned_start_time)) THEN
    RAISE EXCEPTION 'Giờ phân công không hợp lệ; tải lại và kiểm tra';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION validate_final_ktv_assignment_plan() FROM PUBLIC,anon,authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261004110000', 'scope_ktv_assignment_guards_from_20261004') ON CONFLICT (version) DO NOTHING;

COMMIT;

-- [KIỂM TRA SAU] phải ra 35 dòng
-- SELECT version, name FROM supabase_migrations.schema_migrations WHERE version >= '20260925120000' AND version <= '20261004110000' ORDER BY version;
-- FEEDBACK phải có admin + reception:
-- SELECT jsonb_unwrap_string(value)->'FEEDBACK' FROM "SystemConfigs" WHERE key = 'notification_rules';
