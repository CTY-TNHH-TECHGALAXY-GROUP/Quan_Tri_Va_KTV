-- Activate only after all production deployments use ktvd_commit_recompute().
-- Old builds can still enqueue source changes, but cannot consume queue work or
-- overwrite money in KTVDTurnLedger.

CREATE OR REPLACE FUNCTION public.ktvd_require_writer_v2() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.ktvd_formula_revision', true), '') <> '2' THEN
    RAISE EXCEPTION 'Outdated KTV commission writer: formula revision 2 required';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ktvd_require_queue_writer_v2() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.ktvd_formula_revision', true), '') <> '2'
     AND COALESCE(current_setting('app.ktvd_enqueue', true), '') <> '1' THEN
    RAISE EXCEPTION 'Direct KTV recompute queue mutation is not allowed';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_ktvd_require_writer_v2" ON public."KTVDTurnLedger";
CREATE TRIGGER "trg_ktvd_require_writer_v2"
BEFORE INSERT OR UPDATE OR DELETE ON public."KTVDTurnLedger"
FOR EACH ROW EXECUTE FUNCTION public.ktvd_require_writer_v2();

DROP TRIGGER IF EXISTS "trg_ktvd_require_queue_writer_v2" ON public."KTVDRecomputeQueue";
CREATE TRIGGER "trg_ktvd_require_queue_writer_v2"
BEFORE INSERT OR UPDATE OR DELETE ON public."KTVDRecomputeQueue"
FOR EACH ROW EXECUTE FUNCTION public.ktvd_require_queue_writer_v2();
