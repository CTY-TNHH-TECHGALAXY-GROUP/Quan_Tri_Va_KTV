-- Cập nhật kiểu enum BookingStatus
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'SPLIT';

-- Thêm các cột cần thiết cho việc tách đơn
ALTER TABLE "Bookings" ADD COLUMN IF NOT EXISTS "parent_booking_id" text;
ALTER TABLE "Bookings" ADD COLUMN IF NOT EXISTS "sub_suffix" text;

-- Tạo RPC chia một Booking thành nhiều Sub-bookings
CREATE OR REPLACE FUNCTION split_booking_into_sub_bookings(
    p_booking_id text,
    p_split_plan jsonb -- Mảng các object: [{"suffix": "A", "itemIds": ["item1", "item2"]}, {"suffix": "B", "itemIds": ["item3"]}]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_parent_booking record;
    v_plan_item jsonb;
    v_new_booking_id text;
    v_new_bill_code text;
    v_suffix text;
    v_item_ids text[];
BEGIN
    -- 1. Lấy thông tin đơn cha
    SELECT * INTO v_parent_booking FROM "Bookings" WHERE "id" = p_booking_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Không tìm thấy Booking gốc');
    END IF;

    IF v_parent_booking."status"::text = 'SPLIT' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Đơn đã được tách từ trước');
    END IF;

    -- 2. Lặp qua kế hoạch tách để tạo đơn con
    FOR v_plan_item IN SELECT * FROM jsonb_array_elements(p_split_plan)
    LOOP
        v_suffix := v_plan_item->>'suffix';
        v_new_booking_id := p_booking_id || '-' || v_suffix;
        v_new_bill_code := v_parent_booking."billCode" || '-' || v_suffix;
        
        SELECT array_agg(elem::text) INTO v_item_ids 
        FROM jsonb_array_elements_text(v_plan_item->'itemIds') elem;

        IF array_length(v_item_ids, 1) > 0 THEN
            -- Tạo đơn con
            INSERT INTO "Bookings" (
                "id", "billCode", "branchName", "bookingDate", "timeBooking", "timeStart", "timeEnd",
                "customerId", "customerName", "customerPhone", "customerEmail", "customerLang", "nationality",
                "focusAreaNote", "notes", "guestCount", "customerGender", "reception_feedback",
                "totalAmount", "paymentMethod", "status", "source", "rating", "tipAmount", "violations",
                "feedbackNote", "tip", "createdAt", "updatedAt", "idLegacy",
                "parent_booking_id", "sub_suffix"
            ) VALUES (
                v_new_booking_id, v_new_bill_code, v_parent_booking."branchName", v_parent_booking."bookingDate", v_parent_booking."timeBooking", v_parent_booking."timeStart", v_parent_booking."timeEnd",
                v_parent_booking."customerId", 
                v_parent_booking."customerName" || ' - Khách ' || v_suffix, 
                v_parent_booking."customerPhone", v_parent_booking."customerEmail", v_parent_booking."customerLang", v_parent_booking."nationality",
                v_parent_booking."focusAreaNote", v_parent_booking."notes", 1, v_parent_booking."customerGender", v_parent_booking."reception_feedback",
                0, v_parent_booking."paymentMethod", 'NEW', v_parent_booking."source", v_parent_booking."rating", v_parent_booking."tipAmount", v_parent_booking."violations",
                v_parent_booking."feedbackNote", v_parent_booking."tip", v_parent_booking."createdAt", now(), v_parent_booking."idLegacy",
                p_booking_id, v_suffix
            ) ON CONFLICT ("id") DO NOTHING;

            -- Cập nhật BookingItems trỏ về đơn con
            UPDATE "BookingItems"
            SET "bookingId" = v_new_booking_id
            WHERE "id" = ANY(v_item_ids);
            
            -- Tính toán lại tổng tiền cho đơn con
            UPDATE "Bookings" b
            SET "totalAmount" = (SELECT COALESCE(SUM("price" * "quantity"), 0) FROM "BookingItems" WHERE "bookingId" = b."id")
            WHERE b."id" = v_new_booking_id;
        END IF;
    END LOOP;

    -- 3. Cập nhật trạng thái và số lượng khách của đơn cha
    UPDATE "Bookings"
    SET "status" = 'SPLIT', 
        "updatedAt" = now(),
        "guestCount" = GREATEST(1, jsonb_array_length(p_split_plan))
    WHERE "id" = p_booking_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
