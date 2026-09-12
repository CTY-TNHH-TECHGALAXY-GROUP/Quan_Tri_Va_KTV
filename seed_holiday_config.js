const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedHolidayConfig() {
    console.log('--- Checking holiday config ---');
    
    const { data: existing, error: checkErr } = await supabase
        .from('SystemConfigs')
        .select('key')
        .eq('key', 'holiday_shift2_dates')
        .maybeSingle();

    if (checkErr) {
        console.error('Error checking config:', checkErr);
        return;
    }

    if (existing) {
        console.log('Config holiday_shift2_dates already exists.');
    } else {
        const { error: insertErr } = await supabase
            .from('SystemConfigs')
            .insert({
                key: 'holiday_shift2_dates',
                value: ["04-30", "09-02", "12-31"],
                description: 'Danh sách các ngày Lễ (Định dạng MM-DD) áp dụng Ca 2 tự động cho toàn bộ KTV.'
            });

        if (insertErr) {
            console.error('Error inserting config:', insertErr);
        } else {
            console.log('Successfully inserted holiday_shift2_dates config!');
        }
    }
}

seedHolidayConfig();
