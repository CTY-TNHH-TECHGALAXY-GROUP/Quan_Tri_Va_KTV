import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const SUPABASE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixNH002() {
    // Xóa record đổi ca từ ngày mai (do không cần thiết nữa nếu hôm nay đã là Ca 2)
    const { error: delErr } = await supabase
        .from('KTVShifts')
        .delete()
        .eq('id', '680b9b4f-1295-4fbc-b2bf-21c6dfcbf6d9');
    
    if (delErr) console.error("Delete Error:", delErr);
    else console.log("Deleted unnecessary future shift change.");

    // Sửa record Ca tự do hôm nay thành Ca 2 và ACTIVE
    const { error: updErr } = await supabase
        .from('KTVShifts')
        .update({
            shiftType: 'SHIFT_2',
            status: 'ACTIVE',
            reason: 'Admin điều chỉnh từ Ca tự do về lại Ca 2',
            previousShift: null
        })
        .eq('id', '096a9b3d-228b-4d49-8e71-7c3bed8afb56');
    
    if (updErr) console.error("Update Error:", updErr);
    else console.log("Updated today's FREE shift to SHIFT_2 and ACTIVE.");
    
    // Cập nhật record điểm danh để xóa estimatedEndTime (vì Ca 2 không dùng)
    const { error: attErr } = await supabase
        .from('KTVAttendance')
        .update({ estimatedEndTime: null })
        .eq('employeeId', 'NH002')
        .eq('date', '2026-06-08');
        
    if (attErr) console.error("Attendance Update Error:", attErr);
    else console.log("Cleared estimatedEndTime on attendance record.");
}

fixNH002();
