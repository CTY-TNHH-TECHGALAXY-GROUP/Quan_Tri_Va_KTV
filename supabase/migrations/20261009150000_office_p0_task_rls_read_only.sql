-- ============================================================
-- Office P0 bước 7 — bảng việc: trình duyệt CHỈ ĐỌC (plans/plan_office_p0_nen_tang_checklist.md mục 17)
--
-- Trước: "Allow all access" cho public (anon + authenticated) → ai có khoá anon (nằm trong trang web)
-- cũng INSERT/UPDATE/DELETE được việc, ảnh, kết quả duyệt, routine.
-- Sau: anon/authenticated chỉ SELECT (màn hình + realtime vẫn đọc được); mọi ghi đi qua
-- /api/support/* bằng service role (bỏ qua RLS) — đã chuyển hết ở bước 3–7.
--
-- Không đổi: Office*/TaskEvents/CheckoutOverrides (RLS bật, không policy → client không đọc/ghi).
-- Không đụng: Storage bucket task-photos (để P1).
-- Idempotent: chạy lại an toàn.
--
-- LÙI (nếu có màn hình cũ còn ghi thẳng bị gãy):
--   DROP POLICY IF EXISTS "office_client_read_only" ON public."<Bảng>";
--   CREATE POLICY "Allow all access" ON public."<Bảng>" FOR ALL TO public USING (true) WITH CHECK (true);
--   (RoomTaskTemplates: "Enable all for authenticated users" FOR ALL TO authenticated USING (true))
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Tasks','TaskPhotos','TaskReviews','TaskNotifications','TaskTemplates','TaskCategories','EmployeeRoutines','RoomTaskTemplates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all access" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "office_client_read_only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "office_client_read_only" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
  END LOOP;
END $$;
