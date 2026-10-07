-- Server-only edits: a batch commits entirely or rolls back; concurrent +/- use a locked SQL delta.
CREATE OR REPLACE FUNCTION public.turn_queue_apply_edits(p_date date, p_action text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target record;
  entry jsonb;
  new_order integer;
  delta integer;
  affected integer := 0;
BEGIN
  IF p_date IS NULL OR p_action NOT IN ('ORDER','RESET','DELTA') THEN
    RAISE EXCEPTION 'Dữ liệu chỉnh lượt không hợp lệ.';
  END IF;
  -- All queue editors acquire locks in the same order (also protects mixed reset/order batches).
  PERFORM 1 FROM "TurnQueue" WHERE date=p_date ORDER BY id FOR UPDATE;
  IF p_action='DELTA' THEN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR COALESCE(p_payload->>'delta','') NOT IN ('-1','1') THEN
      RAISE EXCEPTION 'Mỗi lần chỉ được tăng hoặc giảm một tua.';
    END IF;
    delta := (p_payload->>'delta')::integer;
    SELECT * INTO target FROM "TurnQueue" WHERE date=p_date AND employee_id=p_payload->>'employeeId';
    IF NOT FOUND THEN RAISE EXCEPTION 'KTV không có trong lượt của ngày này.'; END IF;
    UPDATE "TurnQueue" SET manual_adjustment=COALESCE(manual_adjustment,0)+delta,
      turns_completed=GREATEST(0,(SELECT count(*) FROM "TurnLedger" l
        WHERE l.date=p_date AND l.employee_id=target.employee_id AND COALESCE(l.is_punished,false)=false)
        +COALESCE(manual_adjustment,0)+delta)
      WHERE id=target.id;
    RETURN jsonb_build_object('success',true,'employeeId',target.employee_id);
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload)=0 THEN
    RAISE EXCEPTION 'Không có thứ tự để lưu.';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload)) <>
     (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_payload)) THEN
    RAISE EXCEPTION 'Danh sách có hàng bị trùng.';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
    SELECT * INTO target FROM "TurnQueue" WHERE date=p_date AND id::text=entry->>'id';
    IF NOT FOUND THEN RAISE EXCEPTION 'Hàng đợi đã thay đổi. Tải lại dữ liệu trước khi lưu.'; END IF;
    IF entry->>'expectedOrder' IS NULL OR entry->>'expectedPosition' IS NULL OR
       target.check_in_order IS DISTINCT FROM (entry->>'expectedOrder')::integer OR
       target.queue_position IS DISTINCT FROM (entry->>'expectedPosition')::integer THEN
      RAISE EXCEPTION 'Thứ tự đã được cập nhật ở nơi khác. Bản nháp vẫn được giữ.';
    END IF;
    new_order := (entry->>'order')::integer;
    IF new_order IS NULL OR new_order < 1 OR new_order > 100000 THEN
      RAISE EXCEPTION 'Thứ tự phải là số nguyên từ 1 đến 100000.';
    END IF;
    UPDATE "TurnQueue" SET queue_position=new_order,
      check_in_order=CASE WHEN p_action='ORDER' THEN new_order ELSE check_in_order END
      WHERE id=target.id;
    affected := affected+1;
  END LOOP;
  RETURN jsonb_build_object('success',true,'updated',affected);
END;
$$;
REVOKE ALL ON FUNCTION public.turn_queue_apply_edits(date,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.turn_queue_apply_edits(date,text,jsonb) TO service_role;
