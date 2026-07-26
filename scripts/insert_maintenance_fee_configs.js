const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const configs = [
        {
            key: 'enable_maintenance_fee',
            value: false,
            description: 'Bật/tắt tính năng tự động trừ phí bảo trì hệ thống hàng tháng cho KTV'
        },
        {
            key: 'maintenance_fee_amount',
            value: '"50000"',
            description: 'Số tiền phí bảo trì hệ thống trừ hàng tháng (VND)'
        },
        {
            key: 'maintenance_fee_deduct_deposit',
            value: false,
            description: 'Cho phép trừ phí bảo trì vào tiền cọc nếu ví không đủ'
        }
    ];

    for (const c of configs) {
        const { error } = await supabase
            .from('SystemConfigs')
            .upsert(
                { key: c.key, value: c.value, description: c.description },
                { onConflict: 'key', ignoreDuplicates: true }
            );
        if (error) {
            console.error('Error:', c.key, error.message);
        } else {
            console.log('OK:', c.key);
        }
    }
}

run();
