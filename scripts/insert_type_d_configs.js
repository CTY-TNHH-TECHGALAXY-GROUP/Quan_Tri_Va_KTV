const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const configs = [
        {
            key: 'ktv_type_d_vip_rate_per_60m',
            value: 180000,
            description: 'Rate VIP (đ/60 phút) cho KTV TYPE_D'
        },
        {
            key: 'ktv_type_d_pt_rate_per_60m',
            value: 100000,
            description: 'Rate Phổ thông (đ/60 phút) cho KTV TYPE_D'
        },
        {
            key: 'ktv_deposit_amount_TYPE_D',
            value: 1000000,
            description: 'Tiền cọc ví KTV TYPE_D'
        },
        {
            key: 'enable_ktv_bonus_TYPE_D',
            value: true,
            description: 'Bật/tắt bonus cho KTV TYPE_D'
        },
        {
            key: 'ktv_type_d_bonus_points',
            value: 20,
            description: 'Điểm bonus mỗi tua rating >= 4★ cho TYPE_D'
        },
        {
            key: 'ktv_type_d_rating_deduction',
            value: JSON.stringify({ "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 }),
            description: 'Bảng khấu trừ tiền tua theo sao (thang 4★) cho TYPE_D'
        },
        {
            key: 'ktv_bonus_rate_TYPE_D',
            value: 1000,
            description: 'Quy đổi 1 điểm bonus -> VNĐ cho TYPE_D'
        },
        {
            key: 'ktv_type_d_discipline_rules',
            value: JSON.stringify({
                "ABSENT_NO_NOTICE": 10,
                "ABSENT_EARLY_NOTICE": 5,
                "LATE_NO_UPDATE": 5,
                "ORDER_REJECT_MULTIPLIER": 3
            }),
            description: 'Mức trừ giờ kỷ luật TYPE_D'
        },
        {
            key: 'ktv_type_d_internal_fund',
            value: 250000,
            description: 'Quỹ nội bộ/tháng TYPE_D'
        },
        {
            key: 'ktv_type_d_internal_fund_enabled',
            value: true,
            description: 'Toggle quỹ nội bộ TYPE_D'
        },
        {
            key: 'ktv_type_d_reactivation_fee',
            value: 1000000,
            description: 'Phí kích hoạt lại tài khoản TYPE_D'
        }
    ];

    for (const c of configs) {
        const { error } = await supabase
            .from('SystemConfigs')
            .upsert(
                { key: c.key, value: c.value, description: c.description },
                { onConflict: 'key' } // overwrite values in case they already exist to be safe
            );
        if (error) {
            console.error('Error:', c.key, error.message);
        } else {
            console.log('OK:', c.key);
        }
    }
}

run();
