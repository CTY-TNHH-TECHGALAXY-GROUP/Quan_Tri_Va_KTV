-- Ép đăng xuất khi đổi cấu hình + công tắc ví theo từng loại KTV
--
-- 1. Staff.session_epoch: mốc làm hết hiệu lực session của RIÊNG người đó.
--    Admin đổi cờ tính năng của ai thì đẩy mốc người đó, chỉ họ phải đăng nhập lại.
-- 2. SystemConfigs.auth_session_epoch: mốc theo phạm vi
--    { "ALL": iso, "TYPE_A": iso, ... } — đổi cấu hình chung / cấu hình một loại.
-- 3. ktv_wallet_<ví>_enabled_<loại>: công tắc ví cho CẢ LOẠI.
--    Mặc định true để giữ nguyên hành vi cũ (trước đây không có tầng chặn này).

ALTER TABLE public."Staff"
    ADD COLUMN IF NOT EXISTS session_epoch timestamptz;

COMMENT ON COLUMN public."Staff".session_epoch IS
    'Session cấp trước mốc này bị coi là hết hiệu lực -> ép đăng nhập lại. Đẩy khi admin đổi feature_flags/work_type của nhân viên này.';

INSERT INTO public."SystemConfigs" (key, value, updated_at)
VALUES ('auth_session_epoch', '{}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- Cần gạt tổng, mặc định TẮT: bật giữa ca đang chạy là cả tiệm văng ra màn hình
-- đăng nhập cùng lúc. Quản lý tự bật khi rảnh tay.
INSERT INTO public."SystemConfigs" (key, value, updated_at)
VALUES ('auth_force_logout_enabled', 'false'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public."SystemConfigs" (key, value, updated_at)
SELECT k, 'true'::jsonb, now()
FROM unnest(ARRAY[
    'ktv_wallet_tua_enabled_TYPE_A',
    'ktv_wallet_tua_enabled_TYPE_B',
    'ktv_wallet_tua_enabled_TYPE_C',
    'ktv_wallet_tua_enabled_TYPE_D',
    'ktv_wallet_bonus_enabled_TYPE_A',
    'ktv_wallet_bonus_enabled_TYPE_B',
    'ktv_wallet_bonus_enabled_TYPE_C',
    'ktv_wallet_bonus_enabled_TYPE_D',
    'ktv_wallet_savings_enabled_TYPE_A',
    'ktv_wallet_savings_enabled_TYPE_B',
    'ktv_wallet_savings_enabled_TYPE_C',
    'ktv_wallet_savings_enabled_TYPE_D'
]) AS k
ON CONFLICT (key) DO NOTHING;

-- Realtime cho đường ép đăng xuất TỨC THÌ.
-- auth-context đã subscribe public."Staff" từ lâu (khoá tài khoản, đổi mật khẩu)
-- nhưng không migration nào thêm bảng này vào publication — nên đường realtime
-- đó nhiều khả năng chưa từng chạy. Thêm ở đây, kèm SystemConfigs cho mốc phạm vi.
-- Client vẫn có đường hỏi định kỳ nên không phụ thuộc hoàn toàn vào realtime.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'Staff'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public."Staff";
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'SystemConfigs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public."SystemConfigs";
    END IF;
END $$;
