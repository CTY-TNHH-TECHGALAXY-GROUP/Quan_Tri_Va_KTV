-- Script Migration Data cũ: Tạo 1 BookingGuest cho mỗi Booking hiện tại (trừ SPLIT nếu không có items)
-- và gán guest_id cho các BookingItems.

DO $$
DECLARE
    r RECORD;
    v_guest_id TEXT;
    v_gender TEXT;
    v_bed TEXT;
    v_customer_name TEXT;
    v_nationality TEXT;
    v_status TEXT;
BEGIN
    FOR r IN (SELECT DISTINCT "bookingId" FROM "BookingItems" WHERE "bookingId" IS NOT NULL)
    LOOP
        v_guest_id := r."bookingId" || '_G1';
        
        -- Lấy thông tin từ Booking cha
        SELECT "customerGender", "bedId", "customerName", "nationality", "status"
        INTO v_gender, v_bed, v_customer_name, v_nationality, v_status
        FROM "Bookings"
        WHERE id = r."bookingId";
        
        -- Bỏ qua nếu không tìm thấy booking cha (data mồ côi)
        IF v_status IS NULL THEN
            CONTINUE;
        END IF;

        -- Map status từ Booking sang Guest
        IF v_status IN ('NEW', 'PREPARING', 'READY') THEN
            v_status := 'WAITING';
        ELSIF v_status = 'IN_PROGRESS' THEN
            v_status := 'IN_PROGRESS';
        ELSIF v_status = 'CLEANING' THEN
            v_status := 'CLEANING';
        ELSIF v_status IN ('COMPLETED', 'FEEDBACK') THEN
            v_status := 'FEEDBACK';
        ELSE
            v_status := 'DONE';
        END IF;
        
        -- Tạo Guest record nếu chưa có
        INSERT INTO "BookingGuests" (
            id, booking_id, guest_index, guest_label, 
            customer_name, gender, nationality, bed_id, status
        )
        VALUES (
            v_guest_id, r."bookingId", 1, 'Khách 1', 
            v_customer_name, v_gender, v_nationality, v_bed, v_status
        )
        ON CONFLICT (id) DO NOTHING;
        
        -- Gán guest_id cho BookingItems
        UPDATE "BookingItems"
        SET guest_id = v_guest_id
        WHERE "bookingId" = r."bookingId" AND guest_id IS NULL;
    END LOOP;
END $$;
