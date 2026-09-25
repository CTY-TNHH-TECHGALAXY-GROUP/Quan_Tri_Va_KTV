-- SQL script to insert VIP services into Services table with Correct Prices from SystemConfigs

INSERT INTO "Services" ("id", "code", "nameVN", "nameEN", "nameCN", "nameJP", "nameKR", "description", "priceVND", "priceUSD", "duration", "category")
VALUES 
    -- 1 KTV
    ('VIP_1K_60', 'V1-60', 'VIP 1 KTV (60 phút)', 'VIP 1 Staff (60 mins)', 'VIP 1 员工 (60 分钟)', 'VIP 1 スタッフ (60 分)', 'VIP 1 직원 (60 분)', '{"en": "Premium VIP service with 1 therapist for 60 minutes.", "vn": "Dịch vụ VIP cao cấp với 1 KTV trong 60 phút."}', 720000, 29, 60, 'VIP_MENU'),
    ('VIP_1K_70', 'V1-70', 'VIP 1 KTV (70 phút)', 'VIP 1 Staff (70 mins)', 'VIP 1 员工 (70 分钟)', 'VIP 1 スタッフ (70 分)', 'VIP 1 직원 (70 분)', '{"en": "Premium VIP service with 1 therapist for 70 minutes.", "vn": "Dịch vụ VIP cao cấp với 1 KTV trong 70 phút."}', 840000, 34, 70, 'VIP_MENU'),
    ('VIP_1K_90', 'V1-90', 'VIP 1 KTV (90 phút)', 'VIP 1 Staff (90 mins)', 'VIP 1 员工 (90 分钟)', 'VIP 1 スタッフ (90 分)', 'VIP 1 직원 (90 분)', '{"en": "Premium VIP service with 1 therapist for 90 minutes.", "vn": "Dịch vụ VIP cao cấp với 1 KTV trong 90 phút."}', 1080000, 43, 90, 'VIP_MENU'),
    ('VIP_1K_120', 'V1-120', 'VIP 1 KTV (120 phút)', 'VIP 1 Staff (120 mins)', 'VIP 1 员工 (120 分钟)', 'VIP 1 スタッフ (120 分)', 'VIP 1 직원 (120 분)', '{"en": "Premium VIP service with 1 therapist for 120 minutes.", "vn": "Dịch vụ VIP cao cấp với 1 KTV trong 120 phút."}', 1440000, 58, 120, 'VIP_MENU'),
    ('VIP_1K_150', 'V1-150', 'VIP 1 KTV (150 phút)', 'VIP 1 Staff (150 mins)', 'VIP 1 员工 (150 分钟)', 'VIP 1 スタッフ (150 分)', 'VIP 1 직원 (150 분)', '{"en": "Premium VIP service with 1 therapist for 150 minutes.", "vn": "Dịch vụ VIP cao cấp với 1 KTV trong 150 phút."}', 1800000, 72, 150, 'VIP_MENU'),
    ('VIP_1K_180', 'V1-180', 'VIP 1 KTV (180 phút)', 'VIP 1 Staff (180 mins)', 'VIP 1 员工 (180 分钟)', 'VIP 1 スタッフ (180 分)', 'VIP 1 직원 (180 분)', '{"en": "Premium VIP service with 1 therapist for 180 minutes.", "vn": "Dịch vụ VIP cao cấp với 1 KTV trong 180 phút."}', 2160000, 86, 180, 'VIP_MENU'),
    ('VIP_1K_240', 'V1-240', 'VIP 1 KTV (240 phút)', 'VIP 1 Staff (240 mins)', 'VIP 1 员工 (240 分钟)', 'VIP 1 スタッフ (240 分)', 'VIP 1 직원 (240 분)', '{"en": "Premium VIP service with 1 therapist for 240 minutes.", "vn": "Dịch vụ VIP cao cấp với 1 KTV trong 240 phút."}', 2880000, 115, 240, 'VIP_MENU'),

    -- 2 KTV
    ('VIP_2K_60', 'V2-60', 'VIP 2 KTV (60 phút)', 'VIP 2 Staff (60 mins)', 'VIP 2 员工 (60 分钟)', 'VIP 2 スタッフ (60 分)', 'VIP 2 직원 (60 분)', '{"en": "Premium VIP service with 2 therapists for 60 minutes.", "vn": "Dịch vụ VIP cao cấp với 2 KTV trong 60 phút."}', 1080000, 43, 60, 'VIP_MENU'),
    ('VIP_2K_70', 'V2-70', 'VIP 2 KTV (70 phút)', 'VIP 2 Staff (70 mins)', 'VIP 2 员工 (70 分钟)', 'VIP 2 スタッフ (70 分)', 'VIP 2 직원 (70 분)', '{"en": "Premium VIP service with 2 therapists for 70 minutes.", "vn": "Dịch vụ VIP cao cấp với 2 KTV trong 70 phút."}', 1260000, 50, 70, 'VIP_MENU'),
    ('VIP_2K_90', 'V2-90', 'VIP 2 KTV (90 phút)', 'VIP 2 Staff (90 mins)', 'VIP 2 员工 (90 分钟)', 'VIP 2 スタッフ (90 分)', 'VIP 2 직원 (90 분)', '{"en": "Premium VIP service with 2 therapists for 90 minutes.", "vn": "Dịch vụ VIP cao cấp với 2 KTV trong 90 phút."}', 1620000, 65, 90, 'VIP_MENU'),
    ('VIP_2K_120', 'V2-120', 'VIP 2 KTV (120 phút)', 'VIP 2 Staff (120 mins)', 'VIP 2 员工 (120 分钟)', 'VIP 2 スタッフ (120 分)', 'VIP 2 직원 (120 분)', '{"en": "Premium VIP service with 2 therapists for 120 minutes.", "vn": "Dịch vụ VIP cao cấp với 2 KTV trong 120 phút."}', 2160000, 86, 120, 'VIP_MENU'),
    ('VIP_2K_150', 'V2-150', 'VIP 2 KTV (150 phút)', 'VIP 2 Staff (150 mins)', 'VIP 2 员工 (150 分钟)', 'VIP 2 スタッフ (150 分)', 'VIP 2 직원 (150 분)', '{"en": "Premium VIP service with 2 therapists for 150 minutes.", "vn": "Dịch vụ VIP cao cấp với 2 KTV trong 150 phút."}', 2700000, 108, 150, 'VIP_MENU'),
    ('VIP_2K_180', 'V2-180', 'VIP 2 KTV (180 phút)', 'VIP 2 Staff (180 mins)', 'VIP 2 员工 (180 分钟)', 'VIP 2 スタッフ (180 分)', 'VIP 2 직원 (180 분)', '{"en": "Premium VIP service with 2 therapists for 180 minutes.", "vn": "Dịch vụ VIP cao cấp với 2 KTV trong 180 phút."}', 3240000, 130, 180, 'VIP_MENU'),
    ('VIP_2K_240', 'V2-240', 'VIP 2 KTV (240 phút)', 'VIP 2 Staff (240 mins)', 'VIP 2 员工 (240 分钟)', 'VIP 2 スタッフ (240 分)', 'VIP 2 직원 (240 분)', '{"en": "Premium VIP service with 2 therapists for 240 minutes.", "vn": "Dịch vụ VIP cao cấp với 2 KTV trong 240 phút."}', 4320000, 173, 240, 'VIP_MENU')
ON CONFLICT ("id") DO UPDATE SET 
    "priceVND" = EXCLUDED."priceVND",
    "priceUSD" = EXCLUDED."priceUSD",
    "nameVN" = EXCLUDED."nameVN",
    "nameEN" = EXCLUDED."nameEN";
