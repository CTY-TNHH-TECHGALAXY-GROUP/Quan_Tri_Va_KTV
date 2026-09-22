-- Prepare the Type D ledger writer v2. This migration is safe to apply before
-- the application rollout: it adds the transactional RPC but does not yet
-- reject the legacy direct writer. Apply the enforcement migration only after
-- every production writer uses these RPCs.

ALTER TABLE public."KTVDTurnLedger"
  ADD COLUMN IF NOT EXISTS "formula_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "writer_commit" TEXT;

ALTER TABLE public."KTVDRecomputeQueue"
  ADD COLUMN IF NOT EXISTS "generation" BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public."KTVDTurnLedger"."formula_revision" IS
  'Revision of the approved commission formula that produced this row. Revision 2 pays full assigned duration after normal completion.';
COMMENT ON COLUMN public."KTVDTurnLedger"."writer_commit" IS
  'Deployment git SHA (or explicit maintenance identifier) that wrote this row.';
COMMENT ON COLUMN public."KTVDRecomputeQueue"."generation" IS
  'Incremented on every source change. A worker may acknowledge only the generation it computed.';

CREATE OR REPLACE FUNCTION public.ktvd_enqueue_from_item() RETURNS TRIGGER AS $$
BEGIN
    PERFORM set_config('app.ktvd_enqueue', '1', true);
    INSERT INTO public."KTVDRecomputeQueue" ("booking_item_id", "booking_id", "reason")
    SELECT bi."id", bi."bookingId", 'ITEM'
    FROM public."BookingItems" bi
    WHERE bi."bookingId" = NEW."bookingId"
    ON CONFLICT ("booking_item_id") DO UPDATE
        SET "booking_id" = EXCLUDED."booking_id",
            "reason" = EXCLUDED."reason",
            "enqueued_at" = NOW(),
            "attempts" = 0,
            "last_error" = NULL,
            "generation" = public."KTVDRecomputeQueue"."generation" + 1;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.ktvd_enqueue_from_guest() RETURNS TRIGGER AS $$
BEGIN
    PERFORM set_config('app.ktvd_enqueue', '1', true);
    INSERT INTO public."KTVDRecomputeQueue" ("booking_item_id", "booking_id", "reason")
    SELECT bi."id", bi."bookingId", 'GUEST'
    FROM public."BookingItems" bi
    WHERE bi."guest_id" = NEW."id"
    ON CONFLICT ("booking_item_id") DO UPDATE
        SET "booking_id" = EXCLUDED."booking_id",
            "reason" = EXCLUDED."reason",
            "enqueued_at" = NOW(),
            "attempts" = 0,
            "last_error" = NULL,
            "generation" = public."KTVDRecomputeQueue"."generation" + 1;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.ktvd_enqueue_from_booking() RETURNS TRIGGER AS $$
BEGIN
    PERFORM set_config('app.ktvd_enqueue', '1', true);
    INSERT INTO public."KTVDRecomputeQueue" ("booking_item_id", "booking_id", "reason")
    SELECT bi."id", bi."bookingId", 'BOOKING'
    FROM public."BookingItems" bi
    WHERE bi."bookingId" = NEW."id"
    ON CONFLICT ("booking_item_id") DO UPDATE
        SET "booking_id" = EXCLUDED."booking_id",
            "reason" = EXCLUDED."reason",
            "enqueued_at" = NOW(),
            "attempts" = 0,
            "last_error" = NULL,
            "generation" = public."KTVDRecomputeQueue"."generation" + 1;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.ktvd_commit_recompute(
  p_formula_revision INTEGER,
  p_writer_commit TEXT,
  p_entries JSONB,
  p_rows JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected INTEGER;
  v_matched INTEGER;
  v_rows_written INTEGER := 0;
  v_rows_voided INTEGER := 0;
  v_rows_locked INTEGER := 0;
BEGIN
  IF p_formula_revision <> 2 THEN
    RAISE EXCEPTION 'Unsupported KTV commission formula revision: %', p_formula_revision;
  END IF;
  IF COALESCE(BTRIM(p_writer_commit), '') = '' THEN
    RAISE EXCEPTION 'writer_commit is required';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'entries and rows must be JSON arrays';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT e.booking_item_id)
    INTO v_expected, v_matched
  FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT);
  IF v_expected = 0 OR v_expected <> v_matched THEN
    RAISE EXCEPTION 'entries must contain unique booking_item_id values';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    WHERE e.booking_item_id IS NULL OR e.generation IS NULL
  ) THEN
    RAISE EXCEPTION 'each entry requires booking_item_id and generation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(staff_id TEXT, booking_item_id TEXT)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
      WHERE e.booking_item_id = r.booking_item_id
    )
  ) THEN
    RAISE EXCEPTION 'result contains a booking item outside the claimed queue entries';
  END IF;

  -- Serialize against source-trigger enqueues for these exact queue rows.
  PERFORM q."booking_item_id"
  FROM public."KTVDRecomputeQueue" q
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = q."booking_item_id"
  FOR UPDATE OF q;

  SELECT COUNT(*) INTO v_matched
  FROM public."KTVDRecomputeQueue" q
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = q."booking_item_id"
   AND e.generation = q."generation";
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'KTV recompute source changed or queue entry is missing';
  END IF;

  PERFORM set_config('app.ktvd_formula_revision', p_formula_revision::TEXT, true);

  SELECT COUNT(*) INTO v_rows_locked
  FROM public."KTVDTurnLedger" l
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = l."booking_item_id"
  WHERE l."entry_status" = 'LOCKED';

  INSERT INTO public."KTVDTurnLedger" AS ledger (
    "staff_id", "booking_item_id", "booking_id", "guest_id", "group_id", "work_date",
    "bill_code", "bill_suffix", "service_id", "service_name", "rate_category", "booking_time_start",
    "assigned_minutes", "actual_minutes", "paid_minutes", "custom_minutes",
    "rate_per_60m", "rating_used", "rating_source", "deduction_rate",
    "commission_gross", "commission_net", "bonus_amount", "tax_amount", "tip",
    "item_status", "is_provisional", "entry_status", "handover_status", "handover_comment",
    "co_workers", "has_other_type_coworker", "source", "computed_at", "formula_revision", "writer_commit"
  )
  SELECT
    r.staff_id, r.booking_item_id, r.booking_id, r.guest_id, r.group_id, r.work_date,
    r.bill_code, COALESCE(r.bill_suffix, ''), r.service_id, r.service_name, r.rate_category, r.booking_time_start,
    r.assigned_minutes, r.actual_minutes, r.paid_minutes, r.custom_minutes,
    r.rate_per_60m, r.rating_used, r.rating_source, r.deduction_rate,
    r.commission_gross, r.commission_net, COALESCE(r.bonus_amount, 0), r.tax_amount, r.tip,
    r.item_status, r.is_provisional, r.entry_status, r.handover_status, r.handover_comment,
    COALESCE(r.co_workers, ARRAY[]::TEXT[]), COALESCE(r.has_other_type_coworker, FALSE),
    'EVENT', NOW(), p_formula_revision, p_writer_commit
  FROM jsonb_to_recordset(p_rows) AS r(
    staff_id TEXT, booking_item_id TEXT, booking_id TEXT, guest_id TEXT, group_id TEXT, work_date DATE,
    bill_code TEXT, bill_suffix TEXT, service_id TEXT, service_name TEXT, rate_category TEXT,
    booking_time_start TIMESTAMP, assigned_minutes NUMERIC, actual_minutes NUMERIC, paid_minutes NUMERIC,
    custom_minutes NUMERIC, rate_per_60m NUMERIC, rating_used INTEGER, rating_source TEXT,
    deduction_rate NUMERIC, commission_gross NUMERIC, commission_net NUMERIC, bonus_amount NUMERIC,
    tax_amount NUMERIC, tip NUMERIC, item_status TEXT, is_provisional BOOLEAN, entry_status TEXT,
    handover_status TEXT, handover_comment TEXT, co_workers TEXT[], has_other_type_coworker BOOLEAN
  )
  ON CONFLICT ("staff_id", "booking_item_id") DO UPDATE SET
    "booking_id" = EXCLUDED."booking_id", "guest_id" = EXCLUDED."guest_id",
    "group_id" = EXCLUDED."group_id", "work_date" = EXCLUDED."work_date",
    "bill_code" = EXCLUDED."bill_code", "bill_suffix" = EXCLUDED."bill_suffix",
    "service_id" = EXCLUDED."service_id", "service_name" = EXCLUDED."service_name",
    "rate_category" = EXCLUDED."rate_category", "booking_time_start" = EXCLUDED."booking_time_start",
    "assigned_minutes" = EXCLUDED."assigned_minutes", "actual_minutes" = EXCLUDED."actual_minutes",
    "paid_minutes" = EXCLUDED."paid_minutes", "custom_minutes" = EXCLUDED."custom_minutes",
    "rate_per_60m" = EXCLUDED."rate_per_60m", "rating_used" = EXCLUDED."rating_used",
    "rating_source" = EXCLUDED."rating_source", "deduction_rate" = EXCLUDED."deduction_rate",
    "commission_gross" = EXCLUDED."commission_gross", "commission_net" = EXCLUDED."commission_net",
    "bonus_amount" = EXCLUDED."bonus_amount", "tax_amount" = EXCLUDED."tax_amount", "tip" = EXCLUDED."tip",
    "item_status" = EXCLUDED."item_status", "is_provisional" = EXCLUDED."is_provisional",
    "entry_status" = EXCLUDED."entry_status", "handover_status" = EXCLUDED."handover_status",
    "handover_comment" = EXCLUDED."handover_comment", "co_workers" = EXCLUDED."co_workers",
    "has_other_type_coworker" = EXCLUDED."has_other_type_coworker", "source" = EXCLUDED."source",
    "computed_at" = EXCLUDED."computed_at", "formula_revision" = EXCLUDED."formula_revision",
    "writer_commit" = EXCLUDED."writer_commit"
  WHERE ledger."entry_status" <> 'LOCKED';
  GET DIAGNOSTICS v_rows_written = ROW_COUNT;

  UPDATE public."KTVDTurnLedger" l
  SET "entry_status" = 'VOID', "source" = 'EVENT', "computed_at" = NOW(),
      "formula_revision" = p_formula_revision, "writer_commit" = p_writer_commit
  WHERE l."entry_status" NOT IN ('LOCKED', 'VOID')
    AND EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
      WHERE e.booking_item_id = l."booking_item_id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(staff_id TEXT, booking_item_id TEXT)
      WHERE r.staff_id = l."staff_id" AND r.booking_item_id = l."booking_item_id"
    );
  GET DIAGNOSTICS v_rows_voided = ROW_COUNT;

  DELETE FROM public."KTVDRecomputeQueue" q
  USING jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
  WHERE q."booking_item_id" = e.booking_item_id
    AND q."generation" = e.generation;
  GET DIAGNOSTICS v_matched = ROW_COUNT;
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'KTV queue acknowledgement lost a source generation';
  END IF;

  RETURN jsonb_build_object(
    'itemsRequested', v_expected,
    'rowsWritten', v_rows_written,
    'rowsVoided', v_rows_voided,
    'rowsSkippedLocked', v_rows_locked
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ktvd_mark_recompute_failed(
  p_formula_revision INTEGER,
  p_entries JSONB,
  p_error TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_formula_revision <> 2 THEN
    RAISE EXCEPTION 'Unsupported KTV commission formula revision: %', p_formula_revision;
  END IF;
  PERFORM set_config('app.ktvd_formula_revision', p_formula_revision::TEXT, true);
  UPDATE public."KTVDRecomputeQueue" q
  SET "attempts" = q."attempts" + 1,
      "last_error" = LEFT(COALESCE(p_error, 'Unknown recompute error'), 500)
  FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
  WHERE q."booking_item_id" = e.booking_item_id
    AND q."generation" = e.generation;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.ktvd_enqueue_recompute(
  p_item_ids TEXT[],
  p_reason TEXT DEFAULT 'MANUAL'
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enqueued INTEGER;
BEGIN
  PERFORM set_config('app.ktvd_enqueue', '1', true);
  INSERT INTO public."KTVDRecomputeQueue" ("booking_item_id", "booking_id", "reason")
  SELECT bi."id", bi."bookingId", LEFT(COALESCE(p_reason, 'MANUAL'), 50)
  FROM public."BookingItems" bi
  WHERE bi."id" = ANY(p_item_ids)
  ON CONFLICT ("booking_item_id") DO UPDATE
    SET "booking_id" = EXCLUDED."booking_id",
        "reason" = EXCLUDED."reason",
        "enqueued_at" = NOW(),
        "attempts" = 0,
        "last_error" = NULL,
        "generation" = public."KTVDRecomputeQueue"."generation" + 1;
  GET DIAGNOSTICS v_enqueued = ROW_COUNT;
  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION public.ktvd_commit_recompute(INTEGER, TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ktvd_mark_recompute_failed(INTEGER, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ktvd_enqueue_recompute(TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ktvd_commit_recompute(INTEGER, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.ktvd_mark_recompute_failed(INTEGER, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ktvd_enqueue_recompute(TEXT[], TEXT) TO service_role;
