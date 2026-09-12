-- Tạo RPC gộp các Sub-bookings về lại Booking gốc (Hủy tách đơn)
CREATE OR REPLACE FUNCTION undo_split_booking(
    p_booking_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_parent_id text;
    v_parent_status text;
    v_sub_booking record;
    v_has_invalid_status boolean := false;
BEGIN
    -- 1. Xác định ID của đơn cha
    -- Kiểm tra xem p_booking_id là đơn cha hay đơn con
    SELECT "parent_booking_id" INTO v_parent_id 
    FROM "Bookings" 
    WHERE "id" = p_booking_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Không tìm thấy Booking');
    END IF;

    -- Nếu v_parent_id là null, nghĩa là p_booking_id chính là đơn cha.
    IF v_parent_id IS NULL THEN
        v_parent_id := p_booking_id;
    END IF;

    -- 2. Lấy thông tin đơn cha để kiểm tra trạng thái
    SELECT "status"::text INTO v_parent_status 
    FROM "Bookings" 
    WHERE "id" = v_parent_id;

    IF v_parent_status != 'SPLIT' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Đơn gốc không ở trạng thái SPLIT, không thể hủy tách.');
    END IF;

    -- 3. Kiểm tra trạng thái của TẤT CẢ các đơn con
    -- Bắt buộc tất cả các đơn con phải đang ở trạng thái 'NEW' thì mới cho phép gộp
    FOR v_sub_booking IN SELECT "id", "status"::text AS sub_status FROM "Bookings" WHERE "parent_booking_id" = v_parent_id
    LOOP
        IF v_sub_booking.sub_status != 'NEW' THEN
            v_has_invalid_status := true;
            EXIT;
        END IF;
    END LOOP;

    IF v_has_invalid_status THEN
        RETURN jsonb_build_object('success', false, 'error', 'Không thể hủy tách vì có đơn con đã được điều phối KTV hoặc xử lý.');
    END IF;

    -- 4. Chuyển tất cả BookingItems từ các đơn con về lại đơn cha và dọn dẹp các trường gộp/tách
    UPDATE "BookingItems"
    SET "bookingId" = v_parent_id,
        "options" = CASE 
            WHEN "options" IS NOT NULL THEN
                "options" - 'mergedIntoId' - 'mergedServiceIds' - 'displayName'
            ELSE "options"
        END
    WHERE "bookingId" IN (SELECT "id" FROM "Bookings" WHERE "parent_booking_id" = v_parent_id);

    -- 5. Cập nhật lại thông tin đơn cha (đổi trạng thái về NEW, tính lại tổng tiền)
    -- Về phần guestCount, chúng ta sẽ để lại guestCount cũ (hoặc giao diện sẽ tự set lại khi open).
    UPDATE "Bookings" b
    SET "status" = 'NEW',
        "updatedAt" = now(),
        "totalAmount" = (SELECT COALESCE(SUM("price" * "quantity"), 0) FROM "BookingItems" WHERE "bookingId" = v_parent_id)
    WHERE "id" = v_parent_id;

    -- 6. Xóa bỏ các đơn con
    DELETE FROM "Bookings" WHERE "parent_booking_id" = v_parent_id;

    RETURN jsonb_build_object('success', true, 'message', 'Đã gộp đơn thành công', 'parentBookingId', v_parent_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
