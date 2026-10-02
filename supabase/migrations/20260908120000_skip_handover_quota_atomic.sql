-- ================================================================
-- Hạn mức "bỏ qua bàn giao" phải được chốt trong MỘT giao dịch
-- ================================================================
-- VÌ SAO
--
-- `HandoverService.skipHandover` đang làm hai bước rời nhau:
--     1. SELECT count(*) số phòng đang nợ  → so với max_handover_skip
--     2. UPDATE BookingItems đặt cờ bỏ qua
--
-- Giữa hai bước không có gì giữ chỗ. Hai lần bấm gần nhau — KTV bấm đúp vì
-- mạng chậm, hoặc mở app trên hai máy — cùng đọc ra "còn 1 lượt" rồi cùng ghi.
-- Kết quả: hạn mức 2 mà nợ 3 phòng. Test QA #5 dựng lại được 100%:
--
--     [FAIL] Bam cung luc chi mot lan lot qua — 2/2 lot, sau do dang no 3/2
--
-- Ba lần bấm cùng lúc thì nợ 4. Không có đường nào tự sửa: `getSkipQuota` chỉ
-- đếm, không có ai ép về đúng hạn mức, nên KTV giữ luôn phần vượt.
--
-- LÀM GÌ Ở ĐÂY
--
-- Gói cả đếm lẫn ghi vào một hàm, mở đầu bằng `pg_advisory_xact_lock` khoá
-- theo MÃ KTV. Hai lời gọi cùng lúc của cùng một người bị xếp hàng: người sau
-- đọc ra con số đã bao gồm phần người trước vừa ghi. Khoá theo mã nên KTV khác
-- không phải chờ nhau.
--
-- Hàm cũng idempotent: bấm lại đúng phòng đã bỏ qua thì trả về ok mà KHÔNG
-- tiêu thêm một lượt — nếu không, mỗi lần thử lại vì mất mạng là mất một lượt.
-- ================================================================

CREATE OR REPLACE FUNCTION skip_handover_with_quota(
    p_item_id  text,
    p_ktv_code text,
    p_max      integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_used      integer;
    v_already   boolean;
    v_assigned  boolean;
BEGIN
    -- Xếp hàng theo KTV cho tới hết giao dịch.
    PERFORM pg_advisory_xact_lock(hashtext('handover_skip:' || lower(p_ktv_code)));

    SELECT
        EXISTS (
            SELECT 1 FROM "BookingItems"
             WHERE id = p_item_id
               AND "handover_skipped" = true
               AND "handover_status" = 'SKIPPED'
        ),
        EXISTS (
            SELECT 1 FROM "BookingItems"
             WHERE id = p_item_id
               AND "technicianCodes" @> ARRAY[p_ktv_code]::text[]
        )
      INTO v_already, v_assigned;

    IF NOT v_assigned THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ASSIGNED', 'used', 0);
    END IF;

    -- Bấm lại phòng đã bỏ qua: không tiêu thêm lượt.
    IF v_already THEN
        SELECT count(*) INTO v_used FROM "BookingItems"
         WHERE "handover_skipped" = true
           AND "handover_status" = 'SKIPPED'
           AND "technicianCodes" @> ARRAY[p_ktv_code]::text[];
        RETURN jsonb_build_object('ok', true, 'reason', 'ALREADY_SKIPPED', 'used', v_used);
    END IF;

    SELECT count(*) INTO v_used FROM "BookingItems"
     WHERE "handover_skipped" = true
       AND "handover_status" = 'SKIPPED'
       AND "technicianCodes" @> ARRAY[p_ktv_code]::text[];

    IF v_used >= p_max THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'QUOTA_EXCEEDED', 'used', v_used);
    END IF;

    UPDATE "BookingItems"
       SET "handover_skipped" = true,
           "handover_status"  = 'SKIPPED'
     WHERE id = p_item_id;

    RETURN jsonb_build_object('ok', true, 'reason', 'SKIPPED', 'used', v_used + 1);
END;
$$;

COMMENT ON FUNCTION skip_handover_with_quota(text, text, integer) IS
  'Đếm nợ bàn giao và đặt cờ bỏ qua trong CÙNG một giao dịch, khoá theo mã KTV. Thay cho cặp SELECT-rồi-UPDATE ở tầng ứng dụng, vốn cho hai lần bấm cùng lúc vượt hạn mức.';
