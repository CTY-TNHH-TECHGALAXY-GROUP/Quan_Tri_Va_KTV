-- Bàn giao thất bại vì phân công cũ còn ACTIVE (ca T027, 04/10/2026 13:57).
-- Plan: plans/plan_fix_ban_giao_that_bai_assignment_cu_con_active.md
--
-- promote_next_assignment: bước 0.3 tự đóng phân công "mồ côi" (KTV không còn trên
-- technicianCodes của dịch vụ) trước khi kiểm "KTV đang có ACTIVE". Dựng từ bản ĐANG CHẠY
-- trên production (lưu nguyên văn ở plans/rollback_20261004_orphan_assignment/).
--
-- ⚠️ KHÔNG định nghĩa lại dispatch_confirm_booking ở đây: production sắp nhận bản
-- "sequential" của hàm đó qua plans/sql_production_migrate_test_vao_phase1_20261004.sql.
-- Phần sửa gốc (dọn phân công theo DỊCH VỤ, mọi mã đơn) làm thành migration riêng
-- trên nền bản sequential — xem plan mục 3.2.
--
-- Migration không ghi dữ liệu; chỉ đổi 1 hàm.

CREATE OR REPLACE FUNCTION public.promote_next_assignment(p_employee_id text, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_next_assignment RECORD;
    v_turn_id UUID;
BEGIN
    -- 0. Self-Healing / Reconciliation Guard
    -- Clean up stale ACTIVE assignments if the booking is already DONE/COMPLETED/CANCELLED
    UPDATE "KtvAssignments" ka
    SET "status" = 'COMPLETED', "updated_at" = now()
    FROM "Bookings" b
    WHERE ka."booking_id" = b."id"
      AND ka."employee_id" = p_employee_id
      AND ka."business_date" = p_business_date
      AND ka."status" = 'ACTIVE'
      AND b."status" IN ('DONE', 'COMPLETED', 'CANCELLED');

    -- Clean up ACTIVE assignments if the KTV's TurnQueue says they are 'waiting'
    -- (meaning the legacy system already released them)
    IF EXISTS (
        SELECT 1 FROM "TurnQueue"
        WHERE "employee_id" = p_employee_id
          AND "date" = p_business_date
          AND "status" = 'waiting'
    ) THEN
        UPDATE "KtvAssignments"
        SET "status" = 'COMPLETED', "updated_at" = now()
        WHERE "employee_id" = p_employee_id
          AND "business_date" = p_business_date
          AND "status" = 'ACTIVE';
    END IF;
    -- 0.3 Đóng phân công "mồ côi": KTV không còn có tên trên dịch vụ đó
  -- (dịch vụ đã chuyển sang đơn con khác / KTV khác sau khi tách đơn, hoặc là
  -- dịch vụ con đã gộp có technicianCodes rỗng). Dòng này không còn việc thật
  -- nhưng vẫn làm bước 1 bên dưới coi KTV "đang bận" → bàn giao thất bại
  -- (ca T027, 04/10/2026, plans/plan_fix_ban_giao_that_bai_assignment_cu_con_active.md).
  UPDATE "KtvAssignments" ka
  SET "status" = 'COMPLETED', "updated_at" = now()
  FROM "BookingItems" bi
  WHERE bi."id" = ka."booking_item_id"
    AND ka."employee_id" = p_employee_id
    AND ka."business_date" = p_business_date
    AND ka."status" IN ('ACTIVE', 'QUEUED', 'READY')
    AND NOT (lower(p_employee_id) = ANY(
      SELECT lower(x) FROM unnest(COALESCE(bi."technicianCodes", ARRAY[]::text[])) x));

  -- 1. Check if there is already an ACTIVE assignment
    IF EXISTS (
        SELECT 1 FROM "KtvAssignments"
        WHERE "employee_id" = p_employee_id
          AND "business_date" = p_business_date
          AND "status" = 'ACTIVE'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'KTV already has an ACTIVE assignment');
    END IF;

    -- 2. Find the next QUEUED or READY assignment deterministically
    -- Rule: priority ASC, then planned_start_time ASC, then sequence_no ASC, then created_at ASC
    SELECT * INTO v_next_assignment
    FROM "KtvAssignments"
    WHERE "employee_id" = p_employee_id
      AND "business_date" = p_business_date
      AND "status" IN ('QUEUED', 'READY')
    ORDER BY
        "priority" ASC,
        "planned_start_time" ASC NULLS LAST,
        "sequence_no" ASC,
        "created_at" ASC
    LIMIT 1;

    IF NOT FOUND THEN
        -- No more assignments. Clear the TurnQueue.
        -- Find max queue position
        DECLARE
            v_max_pos INTEGER;
        BEGIN
            SELECT COALESCE(MAX("queue_position"), 0) INTO v_max_pos
            FROM "TurnQueue"
            WHERE "date" = p_business_date;

            UPDATE "TurnQueue"
            SET 
                "status" = 'waiting',
                "current_order_id" = NULL,
                "booking_item_id" = NULL,
                "booking_item_ids" = ARRAY[]::text[],
                "room_id" = NULL,
                "bed_id" = NULL,
                "start_time" = NULL,
                "estimated_end_time" = NULL,
                "queue_position" = v_max_pos + 1
            WHERE "employee_id" = p_employee_id AND "date" = p_business_date;
        END;

        RETURN jsonb_build_object('success', true, 'message', 'No next assignment, KTV set to waiting');
    END IF;

    -- 3. Promote to ACTIVE
    UPDATE "KtvAssignments"
    SET "status" = 'ACTIVE', "updated_at" = now()
    WHERE "id" = v_next_assignment.id;

    -- 4. Sync to TurnQueue
    UPDATE "TurnQueue"
    SET
        "status" = 'assigned',
        "current_order_id" = v_next_assignment.booking_id,
        "booking_item_id" = v_next_assignment.booking_item_id,
        "booking_item_ids" = ARRAY[v_next_assignment.booking_item_id]::text[],
        "room_id" = v_next_assignment.room_id,
        "bed_id" = v_next_assignment.bed_id,
        "start_time" = NULL,
        "estimated_end_time" = NULL
    WHERE "employee_id" = p_employee_id AND "date" = p_business_date;

    IF NOT FOUND THEN
        -- Fallback: Insert if TurnQueue row for this KTV/date doesn't exist
        DECLARE
            v_max_pos INTEGER;
        BEGIN
            SELECT COALESCE(MAX("queue_position"), 0) INTO v_max_pos
            FROM "TurnQueue"
            WHERE "date" = p_business_date;

            INSERT INTO "TurnQueue" (
                "employee_id", "date", "status", "current_order_id",
                "booking_item_id", "booking_item_ids", "room_id", "bed_id", "queue_position"
            ) VALUES (
                p_employee_id, p_business_date, 'assigned', v_next_assignment.booking_id,
                v_next_assignment.booking_item_id, ARRAY[v_next_assignment.booking_item_id]::text[],
                v_next_assignment.room_id, v_next_assignment.bed_id, v_max_pos + 1
            );
        END;
    END IF;

    RETURN jsonb_build_object('success', true, 'promoted_booking_id', v_next_assignment.booking_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$

;
