-- Chặn đặt BookingItems.status = 'DONE' khi còn chặng KTV đang làm dở.
--
-- Ca T027 10/10/2026 (đơn 11NDK-005-10102026): khách chấm 5 sao trên WRB lúc 18:19 khi KTV chưa bấm
-- Kết thúc → WRB ghi item DONE → app KTV nhảy sang Đánh giá → bàn giao gọi ktv_release_work_atomic
-- bị "No completed live work to release" (chặng không có actualEndTime) → T027 kẹt phân công ACTIVE
-- + sổ tua `working` hơn 1 giờ, 12 lần bấm bàn giao 409, quầy auto-handoff cũng thất bại.
--
-- Quy tắc (CLAUDE.md mục 9.6): item chỉ DONE khi mọi chặng đã bắt đầu đều có actualEndTime.
-- Mọi đường ghi hợp lệ (handleFinishService, ktv_release_work_atomic, quầy kéo thẻ Kanban
-- `updateBookingItemStatus`, cron auto-approve, auto_complete_unrated_feedback) đều đóng chặng trước
-- khi DONE nên không bị ảnh hưởng. Chỉ đường ghi "lạ" (WRB cũ, script tay) mới rơi vào đây.
--
-- Hành vi: KHÔNG văng lỗi (để không làm mất điểm khách vừa chấm trong cùng câu UPDATE) — giữ nguyên
-- status cũ và RAISE WARNING để tra trong Postgres logs. Chặng voided (đổi KTV, huỷ không công) bỏ qua.

CREATE OR REPLACE FUNCTION guard_item_done_requires_segments_ended()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_segments jsonb;
BEGIN
  IF NEW.status::text <> 'DONE' OR OLD.status::text = 'DONE' THEN RETURN NEW; END IF;
  v_segments := jsonb_unwrap_string(NEW.segments);
  IF jsonb_typeof(v_segments) IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE COALESCE(s->>'ktvId','') <> ''
      AND COALESCE(s->>'voided','false') <> 'true'
      AND COALESCE(s->>'actualStartTime','') <> ''
      AND COALESCE(s->>'actualEndTime','') = ''
  ) THEN
    RAISE WARNING 'guard_item_done_requires_segments_ended: item % giu status % (chang KTV chua co actualEndTime, khong cho DONE)', NEW.id, OLD.status;
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aa_guard_item_done_requires_segments_ended ON "BookingItems";
-- Tên bắt đầu bằng `aa_` để chạy trước các trigger khác cùng sự kiện (Postgres chạy theo thứ tự tên),
-- đặc biệt trước trigger enqueue ktvd-recompute, để ledger đọc đúng status cuối cùng.
CREATE TRIGGER aa_guard_item_done_requires_segments_ended
  BEFORE UPDATE OF status ON "BookingItems"
  FOR EACH ROW EXECUTE FUNCTION guard_item_done_requires_segments_ended();
