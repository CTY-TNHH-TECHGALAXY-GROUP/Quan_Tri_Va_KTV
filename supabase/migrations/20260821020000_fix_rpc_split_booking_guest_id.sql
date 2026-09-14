-- Fix: split_booking_into_sub_bookings must create NEW BookingGuest per sub-booking
-- and update BookingItems.guest_id accordingly.
-- Previous versions only moved existing guests, causing all items to share the same guest_id.

CREATE OR REPLACE FUNCTION split_booking_into_sub_bookings(
    p_booking_id text,
    p_split_plan jsonb
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
    v_sub_guest_count integer;
    v_new_guest_id text;
    v_old_guest record;
    v_plan_index integer := 0;
BEGIN
    -- 1. Get parent booking
    SELECT * INTO v_parent_booking FROM "Bookings" WHERE "id" = p_booking_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
    END IF;

    -- 2. Loop through split plan
    FOR v_plan_item IN SELECT * FROM jsonb_array_elements(p_split_plan)
    LOOP
        v_plan_index := v_plan_index + 1;
        v_suffix := v_plan_item->>'suffix';
        v_new_booking_id := p_booking_id || '-' || v_suffix;
        v_new_bill_code := v_parent_booking."billCode" || '-' || v_suffix;
        
        SELECT array_agg(elem::text) INTO v_item_ids 
        FROM jsonb_array_elements_text(v_plan_item->'itemIds') elem;

        IF array_length(v_item_ids, 1) > 0 THEN
            
            -- Count unique guests for this sub-booking
            SELECT COUNT(DISTINCT guest_id) INTO v_sub_guest_count
            FROM "BookingItems"
            WHERE id = ANY(v_item_ids) AND guest_id IS NOT NULL;
            
            IF v_sub_guest_count = 0 THEN
                v_sub_guest_count := 1;
            END IF;

            -- Create sub-booking if not exists
            IF NOT EXISTS (SELECT 1 FROM "Bookings" WHERE "id" = v_new_booking_id) THEN
                INSERT INTO "Bookings" (
                    "id", "billCode", "branchName", "bookingDate", "timeBooking", "timeStart", "timeEnd",
                    "customerId", "customerName", "customerPhone", "customerEmail", "customerLang", "nationality",
                    "focusAreaNote", "notes", "guestCount", "customerGender", "reception_feedback",
                    "totalAmount", "paymentMethod", "status", "source", "rating", "tipAmount", "violations",
                    "feedbackNote", "tip", "createdAt", "updatedAt", "idLegacy",
                    "parent_booking_id", "sub_suffix", "accessToken"
                ) VALUES (
                    v_new_booking_id, v_new_bill_code, v_parent_booking."branchName", v_parent_booking."bookingDate", v_parent_booking."timeBooking", v_parent_booking."timeStart", v_parent_booking."timeEnd",
                    v_parent_booking."customerId", 
                    v_parent_booking."customerName" || ' - Khách ' || v_suffix, 
                    v_parent_booking."customerPhone", v_parent_booking."customerEmail", v_parent_booking."customerLang", v_parent_booking."nationality",
                    v_parent_booking."focusAreaNote", v_parent_booking."notes", v_sub_guest_count, v_parent_booking."customerGender", v_parent_booking."reception_feedback",
                    0, v_parent_booking."paymentMethod", 'NEW', v_parent_booking."source", v_parent_booking."rating", v_parent_booking."tipAmount", v_parent_booking."violations",
                    v_parent_booking."feedbackNote", v_parent_booking."tip", v_parent_booking."createdAt", now(), v_parent_booking."idLegacy",
                    p_booking_id, v_suffix,
                    replace(gen_random_uuid()::text, '-', '')
                ) ON CONFLICT ("id") DO NOTHING;
            END IF;

            -- Move BookingItems to sub-booking
            UPDATE "BookingItems"
            SET "bookingId" = v_new_booking_id
            WHERE "id" = ANY(v_item_ids);
            
            -- ============================================================
            -- KEY FIX: Create a NEW BookingGuest for this sub-booking
            -- and point all its items to the new guest_id
            -- ============================================================
            v_new_guest_id := v_new_booking_id || '_guest_1';
            
            -- Try to find the OLD guest to copy metadata from
            SELECT * INTO v_old_guest
            FROM "BookingGuests"
            WHERE "id" = (
                SELECT guest_id FROM "BookingItems" 
                WHERE "id" = ANY(v_item_ids) AND guest_id IS NOT NULL 
                LIMIT 1
            );
            
            -- Create new guest for sub-booking (skip if already exists)
            IF NOT EXISTS (SELECT 1 FROM "BookingGuests" WHERE "id" = v_new_guest_id) THEN
                INSERT INTO "BookingGuests" (
                    "id", "booking_id", "guest_index", "guest_label",
                    "customer_name", "gender", "nationality", "bed_id", "room_id",
                    "notes", "focus_area", "status"
                ) VALUES (
                    v_new_guest_id,
                    v_new_booking_id,
                    1,
                    'Khách ' || v_suffix,
                    COALESCE(v_old_guest.customer_name, v_parent_booking."customerName"),
                    COALESCE(v_old_guest.gender, v_parent_booking."customerGender"),
                    COALESCE(v_old_guest.nationality, v_parent_booking."nationality"),
                    v_old_guest.bed_id,
                    v_old_guest.room_id,
                    v_old_guest.notes,
                    v_old_guest.focus_area,
                    'WAITING'
                ) ON CONFLICT ("id") DO NOTHING;
            END IF;
            
            -- Point all items in this sub-booking to the NEW guest
            UPDATE "BookingItems"
            SET "guest_id" = v_new_guest_id
            WHERE "bookingId" = v_new_booking_id;
            
            -- Recalculate totalAmount for sub-booking
            UPDATE "Bookings" b
            SET "totalAmount" = (SELECT COALESCE(SUM("price" * "quantity"), 0) FROM "BookingItems" WHERE "bookingId" = b."id")
            WHERE b."id" = v_new_booking_id;
        END IF;
    END LOOP;

    -- Recalculate parent totalAmount (for items still remaining on parent)
    UPDATE "Bookings" b
    SET "totalAmount" = (SELECT COALESCE(SUM("price" * "quantity"), 0) FROM "BookingItems" WHERE "bookingId" = b."id")
    WHERE b."id" = p_booking_id;

    -- Update parent status to SPLIT
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
