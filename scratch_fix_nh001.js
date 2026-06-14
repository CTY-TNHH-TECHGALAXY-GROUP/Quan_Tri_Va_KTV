// Script sửa NH001 từ Ca tự do (FREE) về lại Ca 1 (SHIFT_1) — KTV chọn nhầm lúc điểm danh
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf-8');
envContent.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
});
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixNH001() {
    const SHIFT_ID = '6bbe6def-aea9-4726-9a34-6f0dc5132e57'; // Record FREE ACTIVE hôm nay
    
    // 1. Cập nhật record hiện tại: đổi từ FREE -> SHIFT_1
    const { data, error } = await supabase
        .from('KTVShifts')
        .update({
            shiftType: 'SHIFT_1',
            reason: 'Admin sửa: KTV chọn nhầm Ca tự do, khôi phục về Ca 1',
        })
        .eq('id', SHIFT_ID)
        .select()
        .single();

    if (error) {
        console.error('❌ Lỗi khi sửa:', error);
        return;
    }

    console.log('✅ Đã sửa NH001 từ Ca tự do -> Ca 1 (SHIFT_1)');
    console.log('Record:', JSON.stringify(data, null, 2));
}

fixNH001().catch(console.error);
