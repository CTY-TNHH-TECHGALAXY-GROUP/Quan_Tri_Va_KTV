-- Cập nhật hàm undo_split_booking để xóa luôn customerGroupId trong options

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
    v_guest record;
    v_new_index integer;
BEGIN
    -- 1. Xác định ID của đơn cha
    SELECT parent_booking_id INTO v_parent_id 
    FROM Bookings 
    WHERE id = p_booking_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Không tìm thấy Booking');
    END IF;

    IF v_parent_id IS NULL THEN
        v_parent_id := p_booking_id;
    END IF;

    -- 2. Kiểm tra trạng thái đơn cha
    SELECT status::text INTO v_parent_status 
    FROM Bookings 
    WHERE id = v_parent_id;

    IF v_parent_status != 'SPLIT' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Đơn gốc không ở trạng thái SPLIT, không thể hủy tách.');
    END IF;

    -- 3. Kiểm tra trạng thái các đơn con
    FOR v_sub_booking IN SELECT id, status::text AS sub_status FROM Bookings WHERE parent_booking_id = v_parent_id
    LOOP
        IF v_sub_booking.sub_status != 'NEW' THEN
            v_has_invalid_status := true;
            EXIT;
        END IF;
    END LOOP;

    IF v_has_invalid_status THEN
        RETURN jsonb_build_object('success', false, 'error', 'Không thể hủy tách vì có đơn con đã điều phối KTV hoặc xử lý.');
    END IF;

    -- 4. Chuyển BookingItems về lại đơn cha
    UPDATE BookingItems
    SET bookingId = v_parent_id,
        options = CASE 
            WHEN options IS NOT NULL THEN
                options - 'mergedIntoId' - 'mergedServiceIds' - 'displayName' - 'customerGroupId'
            ELSE options
        END
    WHERE bookingId IN (SELECT id FROM Bookings WHERE parent_booking_id = v_parent_id);

    -- 4.5. Chuyển BookingGuests về lại đơn cha
    -- Khôi phục lại guest_index để tránh trùng UNIQUE(booking_id, guest_index)
    v_new_index := 1;
    FOR v_guest IN SELECT id FROM BookingGuests WHERE booking_id IN (SELECT id FROM Bookings WHERE parent_booking_id = v_parent_id) ORDER BY guest_index
    LOOP
        WHILE EXISTS (SELECT 1 FROM BookingGuests WHERE booking_id = v_parent_id AND guest_index = v_new_index) LOOP
            v_new_index := v_new_index + 1;
        END LOOP;

        UPDATE BookingGuests
        SET booking_id = v_parent_id,
            guest_index = v_new_index
        WHERE id = v_guest.id;
        
        v_new_index := v_new_index + 1;
    END LOOP;

    -- 5. Cập nhật lại đơn cha
    UPDATE Bookings b
    SET status = 'NEW',
        updatedAt = now(),
        totalAmount = (SELECT COALESCE(SUM(price * quantity), 0) FROM BookingItems WHERE bookingId = v_parent_id)
    WHERE id = v_parent_id;

    -- 6. Xóa bỏ các đơn con
    DELETE FROM Bookings WHERE parent_booking_id = v_parent_id;

    RETURN jsonb_build_object('success', true, 'message', 'Đã gộp đơn thành công', 'parentBookingId', v_parent_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$
