INSERT INTO public."SystemConfigs" (id, key, value, description)
VALUES (
    gen_random_uuid(),
    'ktv_type_d_tax_effective_from',
    '"2026-09-01"'::jsonb,  -- cot value la JSONB: chuoi phai boc nhay kep ben trong,
                             -- neu de '2026-09-01' tran se loi 22P02 invalid input syntax for type json
    'Ngày bắt đầu áp dụng thuế 10% đối với KTV Type D'
) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;