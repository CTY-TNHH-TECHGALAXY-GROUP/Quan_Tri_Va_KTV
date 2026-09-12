-- Staff.is_active_therapy_menu — cong tac "Hien thi Menu Dieu tri".
--
-- TableInSupabase.md da liet ke cot nay tu lau nhung DB that CHUA CO: script don
-- placeholder loai C ngay 12/09/2026 ghi vao la PGRST204. Them cung dot "loai C
-- thanh tai khoan that" (plans/plan_ktv_loai_c_tai_khoan_that.md, muc B2),
-- dung canh is_active_vip_menu / is_home_spa, do Admin -> Nhan vien bat/tat.
-- Mac dinh false: khong ai tu nhien xuat hien tren Menu Dieu tri.

ALTER TABLE public."Staff"
    ADD COLUMN IF NOT EXISTS is_active_therapy_menu boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."Staff".is_active_therapy_menu IS
    'Hien thi len Therapy Menu (Admin -> Nhan vien bat/tat). Them 12/09/2026.';
