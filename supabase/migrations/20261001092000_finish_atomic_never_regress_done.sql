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
