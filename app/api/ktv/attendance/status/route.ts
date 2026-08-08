import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOnlineService } from '@/lib/services/KtvOnlineService';

// 🔧 CONFIG
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * GET /api/ktv/attendance/status?employeeId=xxx
 * Returns the current attendance status for today (VN timezone).
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const employeeId = searchParams.get('employeeId');

        if (!employeeId) {
            return NextResponse.json({ success: false, error: 'Missing employeeId' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // ─── Fetch Cut-off Time Config ───
        const { data: configData } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'spa_day_cutoff_hours')
            .single();
            
        // Default to 6:00 AM if not set
        const cutoffHours = (configData?.value != null) ? Number(configData.value) : 6;

        // ─── Calculate Business Day date range (UTC+7) ───
        const nowUtc = new Date();
        const vnNow = new Date(nowUtc.getTime() + VN_OFFSET_MS);
        
        // Subtract cutoff hours to determine the "Business Date"
        // E.g., if cutoff is 6, 03:00 AM May 2 becomes 21:00 PM May 1 -> Business Date is May 1
        const businessNow = new Date(vnNow.getTime() - cutoffHours * 60 * 60 * 1000);
        const businessDateStr = businessNow.toISOString().slice(0, 10);
        
        // Business Day starts at cutoff hours of the business date
        const startOfBusinessDayUtc = new Date(`${businessDateStr}T${String(cutoffHours).padStart(2, '0')}:00:00+07:00`).toISOString();
        
        // Business Day ends 24 hours later (minus 1 ms for safety, but we can just add 24 hours)
        const endOfBusinessDayUtc = new Date(new Date(`${businessDateStr}T${String(cutoffHours).padStart(2, '0')}:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();

        // ─── Query today's attendance records, most recent first ───
        const { data: records, error } = await supabase
            .from('KTVAttendance')
            .select('*')
            .eq('employeeId', employeeId)
            .gte('checkedAt', startOfBusinessDayUtc)
            .lte('checkedAt', endOfBusinessDayUtc)
            .order('checkedAt', { ascending: false });

        if (error) {
            console.error('❌ [Attendance Status] Query error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        // ─── Fetch Work Type & Available Until ───
        let workType = 'TYPE_A';
        let availableUntil = null;
        const { data: userRow } = await supabase
            .from('Users')
            .select('code')
            .eq('id', employeeId)
            .maybeSingle();

        if (userRow?.code) {
             const { data: staffRow } = await supabase
                 .from('Staff')
                 .select('work_type, available_until')
                 .eq('id', userRow.code)
                 .maybeSingle();
             if (staffRow?.work_type) {
                 workType = staffRow.work_type;
             }
             if (staffRow?.available_until) {
                 availableUntil = staffRow.available_until;
             }
        }

        // ─── Fetch Incomplete Tasks ───
        let incompleteTasksCount = 0;
        if (userRow?.code) {
             const { data: staffRow } = await supabase
                 .from('Staff')
                 .select('work_type')
                 .eq('id', userRow.code)
                 .maybeSingle();

             let shouldBlock = false;
             if (staffRow?.work_type) {
                 const { data: config } = await supabase
                     .from('SystemConfigs')
                     .select('value')
                     .eq('key', `block_checkout_incomplete_tasks_${staffRow.work_type}`)
                     .maybeSingle();
                 shouldBlock = !!config?.value;
             }

             if (shouldBlock) {
                 const vnDateStr = vnNow.toISOString().slice(0, 10);
                 const todayStartIso = new Date(`${vnDateStr}T00:00:00+07:00`).toISOString();

                 const { data: incompleteTasks } = await supabase
                     .from('Tasks')
                     .select('id')
                     .eq('assignee_id', userRow.code)
                     .gte('created_at', todayStartIso)
                     .neq('inspection_status', 'PASSED');
                     
                 if (incompleteTasks) {
                     incompleteTasksCount = incompleteTasks.length;
                 }
             }
        }

        // ─── Determine status from records ───
        if (!records || records.length === 0) {
            // CƠ CHẾ BẢO VỆ: Nếu KTV chưa điểm danh hôm nay nhưng bị kẹt AT_VENUE ở bảng Staff (do quên tan ca hôm trước) -> Auto reset về OFFLINE
            if (userRow?.code) {
                const { data: staffStatus } = await supabase.from('Staff').select('online_status').eq('id', userRow.code).maybeSingle();
                if (staffStatus?.online_status === 'AT_VENUE') {
                    console.log(`[Auto-Protect] KTV ${userRow.code} stuck AT_VENUE from previous day. Resetting to OFFLINE.`);
                    await KtvOnlineService.goOffline(supabase, userRow.code);
                }
            }
            return NextResponse.json({ success: true, checkStatus: 'IDLE', record: null, workType, availableUntil, incompleteTasksCount });
        }

        // Find the most relevant record (most recent non-rejected, or fallback)
        
        // 1. Kiểm tra xin nghỉ đột xuất
        const confirmedOff = records.find(
            (r) => r.checkType === 'SUDDEN_OFF' && r.status === 'CONFIRMED'
        );
        if (confirmedOff) {
            return NextResponse.json({ success: true, checkStatus: 'CONFIRMED', record: confirmedOff, workType, availableUntil, incompleteTasksCount });
        }

        const pendingOff = records.find(
            (r) => r.checkType === 'SUDDEN_OFF' && r.status === 'PENDING'
        );
        if (pendingOff) {
            return NextResponse.json({ success: true, checkStatus: 'PENDING', record: pendingOff, workType, availableUntil, incompleteTasksCount });
        }

        // 2. Kiểm tra Tan ca
        const confirmedCheckOut = records.find(
            (r) => r.checkType === 'CHECK_OUT' && r.status === 'CONFIRMED'
        );
        if (confirmedCheckOut) {
            return NextResponse.json({ success: true, checkStatus: 'CHECKED_OUT', record: confirmedCheckOut, workType, availableUntil, incompleteTasksCount });
        }

        const pendingCheckOut = records.find(
            (r) => r.checkType === 'CHECK_OUT' && r.status === 'PENDING'
        );
        if (pendingCheckOut) {
            return NextResponse.json({ success: true, checkStatus: 'PENDING', record: pendingCheckOut, workType, availableUntil, incompleteTasksCount });
        }

        // 3. Kiểm tra Vào ca
        const confirmedCheckIn = records.find(
            (r) => (r.checkType === 'CHECK_IN' || r.checkType === 'LATE_CHECKIN' || r.checkType === 'OVERTIME') && r.status === 'CONFIRMED'
        );
        if (confirmedCheckIn) {
            return NextResponse.json({ success: true, checkStatus: 'CONFIRMED', record: confirmedCheckIn, workType, availableUntil, incompleteTasksCount });
        }

        const pendingCheckIn = records.find(
            (r) => (r.checkType === 'CHECK_IN' || r.checkType === 'LATE_CHECKIN' || r.checkType === 'OVERTIME') && r.status === 'PENDING'
        );
        if (pendingCheckIn) {
            return NextResponse.json({ success: true, checkStatus: 'PENDING', record: pendingCheckIn, workType, availableUntil, incompleteTasksCount });
        }

        // All records are REJECTED → allow retry
        return NextResponse.json({ success: true, checkStatus: 'IDLE', record: null, workType, availableUntil, incompleteTasksCount });

    } catch (error: any) {
        console.error('❌ [Attendance Status] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
