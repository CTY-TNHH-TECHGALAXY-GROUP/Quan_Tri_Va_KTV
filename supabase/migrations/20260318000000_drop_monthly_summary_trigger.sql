-- Fix: Drop orphaned trigger & function that reference dropped table "MonthlyAttendanceSummary"
-- The table was removed in 20260317000004_drop_unused_tables.sql but the trigger was left behind.

-- 1. Drop all triggers on DailyAttendance that may reference MonthlyAttendanceSummary
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'DailyAttendance'
      AND NOT t.tgisinternal
  LOOP
    -- Check if the trigger function body references MonthlyAttendanceSummary
    IF EXISTS (
      SELECT 1
      FROM pg_trigger t2
      JOIN pg_proc p ON t2.tgfoid = p.oid
      WHERE t2.tgname = rec.trigger_name
        AND p.prosrc ILIKE '%MonthlyAttendanceSummary%'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public."DailyAttendance"', rec.trigger_name);
      RAISE NOTICE 'Dropped trigger: %', rec.trigger_name;
    END IF;
  END LOOP;
END $$;

-- 2. Drop orphaned functions that reference MonthlyAttendanceSummary
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT p.proname AS func_name, n.nspname AS func_schema
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosrc ILIKE '%MonthlyAttendanceSummary%'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I() CASCADE', rec.func_schema, rec.func_name);
    RAISE NOTICE 'Dropped function: %.%', rec.func_schema, rec.func_name;
  END LOOP;
END $$;
