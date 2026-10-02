require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanGarbage() {
    console.log('Cleaning garbage Ledger entries...');
    const { error: delError } = await supabase
        .from('TurnLedger')
        .delete()
        .eq('date', '2026-04-30')
        .eq('employee_id', 'Tom, NH027');
    
    if (delError) console.error(delError);
    else console.log('✅ Deleted "Tom, NH027" from Ledger.');

    // Đồng thời xóa các KTV không có mã chuẩn (không bắt đầu bằng NH hoặc mã số hợp lệ)
    // Nhưng cẩn thận với Lisa, Tom, T Tiên (có vẻ là tên thay cho mã)
    // Tôi sẽ chỉ xóa cái gộp dấu phẩy.
}

cleanGarbage();
