-- Baseline: live definition of public.webbooking_commit_booking(jsonb, jsonb) dumped from PRODUCTION on 2026-10-08 (read-only).
-- Reference only, NOT a migration. Source of truth until now: NganHa-WebBooking/supabase/GO_LIVE_WEBSITE_ATOMIC_WRITER_READY_TO_PASTE.sql (body identical).
-- Grants on prod: EXECUTE to postgres, service_role only.

CREATE OR REPLACE FUNCTION public.webbooking_commit_booking(p_booking jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id TEXT;
  v_key TEXT;
  v_item JSONB;
  v_item_id TEXT;
  v_service_id TEXT;
  v_qty INTEGER;
  v_price NUMERIC;
  v_total NUMERIC := 0;
  v_index INTEGER := 0;
  v_existing_id TEXT;
  v_existing_bill TEXT;
  v_existing_total NUMERIC;
  v_existing_items INTEGER;
  v_item_count INTEGER;
  v_in_parent JSONB;
  v_in_items JSONB := '[]'::JSONB;
  v_sorted_items JSONB := '[]'::JSONB;
  v_existing_parent JSONB;
  v_existing_items_json JSONB;
BEGIN
  IF jsonb_typeof(p_booking) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BOOKING_PAYLOAD_INVALID';
  END IF;

  -- Reject caller-controlled fields outside the route-to-writer contract.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_booking) k
    WHERE k NOT IN ('id','billCode','guestCount','branchName','bookingDate',
      'timeBooking','customerName','customerPhone','customerEmail',
      'customerGender','customerLang','customerId','roomName','notes',
      'focusAreaNote','totalAmount','idLegacy','source','status','tip','createdAt','updatedAt')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BOOKING_FIELD_NOT_ALLOWED';
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BOOKING_ITEMS_INVALID';
  END IF;

  v_id := NULLIF(p_booking->>'id', '');
  v_key := NULLIF(p_booking->>'idLegacy', '');
  IF v_id IS NULL OR p_booking->>'billCode' IS DISTINCT FROM v_id
     OR v_id !~ '^WB-[0-9]{8}-[0-9]+$'
     OR substring(v_id FROM 4 FOR 8) IS DISTINCT FROM
       to_char(((p_booking->>'bookingDate')::TIMESTAMP)::DATE, 'DDMMYYYY')
     OR (p_booking ? 'source' AND p_booking->>'source' IS DISTINCT FROM 'WebBooking')
     OR (p_booking ? 'status' AND p_booking->>'status' IS DISTINCT FROM 'NEW')
     OR v_key IS NULL OR v_key !~ '^idemp:.+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BOOKING_SERVER_FIELDS_INVALID';
  END IF;

  -- Same-key requests serialize without creating a global booking lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('webbooking:idlegacy:' || v_key, 0));

  SELECT b.id, b."billCode", b."totalAmount", count(i.id)
    INTO v_existing_id, v_existing_bill, v_existing_total, v_existing_items
    FROM public."Bookings" b
    LEFT JOIN public."BookingItems" i ON i."bookingId" = b.id
    WHERE b."idLegacy" = v_key
    GROUP BY b.id, b."billCode", b."totalAmount";
  IF v_existing_id IS NOT NULL THEN
    SELECT count(*) INTO v_item_count FROM public."BookingItems" WHERE "bookingId" = v_existing_id;
    IF v_item_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'idempotent', false,
        'code', 'BOOKING_IN_PROGRESS', 'bookingId', v_existing_id);
    END IF;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_index := v_index + 1;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k
         WHERE k NOT IN ('id','bookingId','serviceId','quantity','price','options','tip','status')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ITEM_FIELD_NOT_ALLOWED';
    END IF;
    v_service_id := NULLIF(v_item->>'serviceId', '');
    IF v_item->>'quantity' IS NULL OR v_item->>'quantity' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ITEM_QUANTITY_INVALID';
    END IF;
    v_qty := (v_item->>'quantity')::INTEGER;
    IF v_service_id IS NULL OR v_qty IS NULL OR v_qty < 1 OR v_qty > 20
       OR (v_item ? 'status' AND v_item->>'status' IS DISTINCT FROM 'WAITING')
       OR (v_item ? 'bookingId' AND v_item->>'bookingId' IS DISTINCT FROM v_id)
       OR jsonb_typeof(v_item->'options') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ITEM_INVALID';
    END IF;
    IF v_existing_id IS NOT NULL THEN
      -- A replay is compared with persisted intent, even if the catalog has
      -- since changed or the service was deactivated.
      IF v_item->>'price' IS NULL OR v_item->>'price' !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ITEM_PRICE_INVALID';
      END IF;
      v_price := (v_item->>'price')::NUMERIC;
    ELSE
      -- Lock every catalog row before reading price; this snapshot is used for
      -- both validation and insertion, including private-room addon rows.
      SELECT s."priceVND" INTO v_price FROM public."Services" s
        WHERE s.id = v_service_id AND s."isActive" = true
        FOR SHARE;
      IF NOT FOUND OR v_price IS NULL OR v_price < 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SERVICE_NOT_BOOKABLE';
      END IF;
      IF v_item ? 'price' AND (v_item->>'price')::NUMERIC IS DISTINCT FROM v_price THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SERVICE_PRICE_CONFLICT';
      END IF;
    END IF;
    v_total := v_total + v_price * v_qty;
    v_in_items := v_in_items || jsonb_build_array(jsonb_build_object(
      'serviceId', v_service_id, 'quantity', v_qty, 'price', v_price,
      'options', v_item->'options'));
  END LOOP;
  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'serviceId', (value->>'quantity')::INTEGER,
    (value->>'price')::NUMERIC, value->>'options'), '[]'::JSONB)
    INTO v_sorted_items FROM jsonb_array_elements(v_in_items);
  IF v_existing_id IS NULL AND (p_booking->>'totalAmount')::NUMERIC IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BOOKING_TOTAL_CONFLICT';
  END IF;

  v_in_parent := jsonb_build_object(
    'guestCount', COALESCE((p_booking->>'guestCount')::INTEGER, 1),
    'branchName', p_booking->>'branchName', 'bookingDate',
      (p_booking->>'bookingDate')::TIMESTAMP,
    'timeBooking', p_booking->>'timeBooking', 'customerName', p_booking->>'customerName',
    'customerPhone', p_booking->>'customerPhone', 'customerEmail', p_booking->>'customerEmail',
    'customerGender', p_booking->>'customerGender', 'customerLang', p_booking->>'customerLang',
    'customerId', p_booking->>'customerId', 'roomName', p_booking->>'roomName',
    'totalAmount', v_total);

  IF v_existing_id IS NOT NULL THEN
    SELECT jsonb_build_object(
    'guestCount', b."guestCount", 'branchName', b."branchName", 'bookingDate',
        b."bookingDate", 'timeBooking', b."timeBooking",
      'customerName', b."customerName", 'customerPhone', b."customerPhone",
      'customerEmail', b."customerEmail", 'customerGender', b."customerGender",
      'customerLang', b."customerLang", 'customerId', b."customerId", 'roomName', b."roomName",
      'totalAmount', b."totalAmount")
      INTO v_existing_parent FROM public."Bookings" b WHERE b.id = v_existing_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'serviceId', i."serviceId", 'quantity', i.quantity, 'price', i.price,
      'options', i.options) ORDER BY i."serviceId", i.quantity, i.price, i.options::TEXT), '[]'::JSONB)
      INTO v_existing_items_json FROM public."BookingItems" i WHERE i."bookingId" = v_existing_id;
    IF v_existing_parent = v_in_parent AND v_existing_items_json = v_sorted_items THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true,
        'bookingId', v_existing_id, 'billCode', v_existing_bill);
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'IDEMPOTENCY_KEY_REUSED';
  END IF;

  INSERT INTO public."Bookings" (
    id, "billCode", source, "guestCount", "branchName", "bookingDate", "timeBooking",
    "customerName", "customerPhone", "customerEmail", "customerGender", "customerLang",
    "customerId", "roomName", notes, "focusAreaNote", "totalAmount", status, tip,
    "idLegacy", "createdAt", "updatedAt"
  ) VALUES (
    v_id, v_id, 'WebBooking', COALESCE((p_booking->>'guestCount')::INTEGER, 1),
    p_booking->>'branchName', (p_booking->>'bookingDate')::TIMESTAMP,
    p_booking->>'timeBooking', p_booking->>'customerName', p_booking->>'customerPhone',
    p_booking->>'customerEmail', p_booking->>'customerGender', p_booking->>'customerLang',
    p_booking->>'customerId', p_booking->>'roomName', p_booking->>'notes',
    p_booking->>'focusAreaNote', v_total, 'NEW', 0, v_key,
    COALESCE(((p_booking->>'createdAt')::TIMESTAMPTZ AT TIME ZONE 'UTC'), now() AT TIME ZONE 'UTC'),
    COALESCE(((p_booking->>'updatedAt')::TIMESTAMPTZ AT TIME ZONE 'UTC'), now() AT TIME ZONE 'UTC')
  );

  v_index := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_index := v_index + 1;
    v_service_id := v_item->>'serviceId';
    v_qty := (v_item->>'quantity')::INTEGER;
    -- Use the locked validation snapshot, never a second catalog read.
    v_price := (v_in_items->(v_index - 1)->>'price')::NUMERIC;
    v_item_id := NULLIF(v_item->>'id', '');
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ITEM_ID_REQUIRED';
    END IF;
    INSERT INTO public."BookingItems" (id, "bookingId", "serviceId", quantity, price, status, options, tip)
      VALUES (v_item_id, v_id, v_service_id, v_qty, v_price, 'WAITING', v_item->'options', 0);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'idempotent', false, 'bookingId', v_id, 'billCode', v_id);
END;
$function$
;
