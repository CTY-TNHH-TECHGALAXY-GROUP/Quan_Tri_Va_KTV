import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("--- Kiểm tra các bảng Ledger ---");
    const { data: mData, error: mError } = await supabase.from('KTVMonthlyLedger').select('count').limit(1);
    if (mError) {
        console.error("Lỗi khi truy vấn KTVMonthlyLedger:", mError.message);
    } else {
        console.log("Bảng KTVMonthlyLedger: TỒN TẠI");
    }

    const { data: yData, error: yError } = await supabase.from('KTVYearlyLedger').select('count').limit(1);
    if (yError) {
        console.error("Lỗi khi truy vấn KTVYearlyLedger:", yError.message);
    } else {
        console.log("Bảng KTVYearlyLedger: TỒN TẠI");
    }

    console.log("\n--- Kiểm tra cấu hình milestones KTV Loại B ---");
    const { data: configData, error: configError } = await supabase
        .from('SystemConfigs')
        .select('*')
        .eq('key', 'ktv_commission_milestones_type_b')
        .single();
    if (configError) {
        console.error("Lỗi khi truy vấn key ktv_commission_milestones_type_b:", configError.message);
    } else {
        console.log("Cấu hình ktv_commission_milestones_type_b:", configData);
    }
}

run();
