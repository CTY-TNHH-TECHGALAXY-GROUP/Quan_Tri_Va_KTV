// Script kiểm tra dữ liệu ca làm việc của NH001
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

async function checkNH001() {
    // 1. Lấy tất cả record KTVShifts của NH001
    const { data: shifts, error } = await supabase
        .from('KTVShifts')
        .select('id, employeeId, shiftType, effectiveFrom, status, reason, previousShift, createdAt, estimatedEndTime')
        .eq('employeeId', 'NH001')
        .order('createdAt', { ascending: false })
        .limit(15);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('=== TẤT CẢ RECORD CA CỦA NH001 (mới nhất -> cũ nhất) ===');
    console.log(`Tổng: ${shifts.length} records\n`);
    
    shifts.forEach((s, i) => {
        console.log(`[${i + 1}] ID: ${s.id}`);
        console.log(`    Ca: ${s.shiftType} | Status: ${s.status}`);
        console.log(`    effectiveFrom: ${s.effectiveFrom}`);
        console.log(`    reason: ${s.reason}`);
        console.log(`    previousShift: ${s.previousShift}`);
        console.log(`    createdAt: ${s.createdAt}`);
        console.log('');
    });

    // 2. Tính toán businessDate giống API
    const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
    const vnNow = new Date(Date.now() + VN_OFFSET_MS);
    const cutoffHours = 6;
    const businessNow = new Date(vnNow.getTime() - cutoffHours * 60 * 60 * 1000);
    const businessDateStr = businessNow.toISOString().slice(0, 10);
    
    console.log(`=== BUSINESS DATE: ${businessDateStr} ===`);
    console.log(`=== VN NOW: ${vnNow.toISOString()} ===\n`);

    // 3. Lọc giống API: lấy records có effectiveFrom <= fetchDate
    const fetchDate = businessDateStr; // Tương đương khi không truyền ?date=
    const applicableShifts = shifts.filter(s => 
        s.effectiveFrom <= fetchDate && 
        (s.status === 'ACTIVE' || s.status === 'REPLACED')
    );

    console.log(`=== RECORDS ÁP DỤNG CHO NGÀY ${fetchDate} (effectiveFrom <= fetchDate & ACTIVE/REPLACED) ===`);
    applicableShifts.forEach((s, i) => {
        const isTempShift = s.reason === 'Tự chọn ca lúc điểm danh' || s.shiftType === 'FREE' || s.shiftType === 'REQUEST';
        console.log(`[${i + 1}] Ca: ${s.shiftType} | Status: ${s.status} | effectiveFrom: ${s.effectiveFrom} | isTempShift: ${isTempShift}`);
        console.log(`    reason: ${s.reason}`);
    });

    // 4. Mô phỏng logic dedupMap giống API
    const sortedData = applicableShifts.sort((a, b) => {
        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
        if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    let result = null;
    for (const shift of sortedData) {
        const isTempShift = shift.reason === 'Tự chọn ca lúc điểm danh' || shift.shiftType === 'FREE' || shift.shiftType === 'REQUEST';
        const isExpiredForTarget = isTempShift && shift.effectiveFrom < fetchDate;

        if (!result) {
            if (isExpiredForTarget) {
                result = { ...shift, shiftType: shift.previousShift || 'SHIFT_1', reason: 'Khôi phục ca gốc' };
                console.log(`\n>>> PICK (revert expired temp): shiftType sẽ trả về: ${result.shiftType} (originalType: ${shift.shiftType}, previousShift: ${shift.previousShift})`);
            } else {
                result = shift;
                console.log(`\n>>> PICK (direct): shiftType sẽ trả về: ${result.shiftType}`);
            }
        }
    }

    if (result) {
        console.log(`\n=== KẾT QUẢ CUỐI: NH001 hiển thị là "${result.shiftType}" ===`);
    } else {
        console.log('\n=== KHÔNG TÌM THẤY CA NÀO ===');
    }
}

checkNH001().catch(console.error);
