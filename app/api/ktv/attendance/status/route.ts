import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOnlineService } from '@/lib/services/KtvOnlineService';
import { resolveAttendanceStatus } from '@/lib/attendance/resolveAttendanceStatus';
import { WalletAccessService } from '@/lib/services/WalletAccessService';

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

        // Ô "Yêu cầu rút tiền" CHỈ hiện ở lần điểm danh ĐẦU TIÊN trong ngày.
        // Lần thứ hai trở đi thì ẩn hẳn, không quan tâm lần đầu có tích hay không.
        const daDiemDanhHomNay = (records || []).some((r: any) =>
            r.checkType === 'CHECK_IN' || r.checkType === 'LATE_CHECKIN');

        // ─── Fetch Work Type & Available Until ───
        let workType = 'TYPE_A';
        let availableUntil = null;
        let lockInfo: any = null;
        // TUA wallet switched off → the check-in form shows the maintenance
        // notice instead of the "Yêu cầu rút tiền" box (the POST refuses the
        // intent anyway; this only keeps the form honest).
        let withdrawWalletOff = false;
        const { data: userRow } = await supabase
            .from('Users')
            .select('code')
            .eq('id', employeeId)
            .maybeSingle();

        if (userRow?.code) {
             const { data: staffRow } = await supabase
                 .from('Staff')
                 .select('work_type, available_until, status, lock_source')
                 .eq('id', userRow.code)
                 .maybeSingle();
             
             if (staffRow?.status === 'KHÓA_TÀI_KHOẢN' && staffRow?.lock_source === 'MANUAL') {
                // Admin switched "Hoạt động" off → no reason, no discipline wording:
                // the client renders the maintenance notice for kind MANUAL.
                lockInfo = { kind: 'MANUAL' };
             } else if (staffRow?.status === 'KHÓA_TÀI_KHOẢN') {
                const { data: auditLog } = await supabase
                    .from('SecurityAuditLogs')
                    .select('created_at, details, employee_name')
                    .eq('event_type', 'AUTO_LOCK_ABSENCE')
                    .eq('employee_id', userRow.code)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (auditLog) {
                    lockInfo = {
                        kind: 'DISCIPLINE',
                        lockedAt: auditLog.created_at,
                        reason: auditLog.details?.reason || 'Vắng mặt không phép (Cron)',
                        adminContact: 'Hotline/Zalo Quản lý: 0987654321', 
                    };
                } else {
                    lockInfo = { kind: 'DISCIPLINE', lockedAt: new Date().toISOString(), reason: 'Bị khóa kỷ luật', adminContact: 'Quản lý' };
                }
             }

             if (staffRow?.work_type) {
                 workType = staffRow.work_type;
             }
             if (staffRow) {
                 const { ok } = await WalletAccessService.isEnabled(supabase, userRow.code, 'TUA');
                 withdrawWalletOff = !ok;
             }
             if (staffRow?.available_until) {
                 availableUntil = staffRow.available_until;
             }
        }

        // ─── Fetch Today Registration (Only for TYPE_D) ───
        let todayRegistration = null;
        if (workType === 'TYPE_D' && userRow?.code) {
            const { vnToday } = await import('@/lib/vn-time');
            const todayStr = vnToday();

            const { data: regData } = await supabase
                .from('KTVTypeDDailyRegistration')
                .select('status, expected_time, check_in_at, penalty_applied')
                .eq('staff_id', userRow.code)
                .eq('work_date', todayStr)
                .maybeSingle();

            if (regData) {
                todayRegistration = regData;
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

        // ─── Nợ phòng: chưa trả xong thì không cho tan ca ───
        //
        // Trong ca thì cứ nợ thoải mái — chỉ chặn ở bước TAN CA.
        //
        //  · Nợ bàn giao : item KTV đã bấm "Bỏ qua" hoặc bị quầy trả lại. Không
        //                  giới hạn ngày — nợ là nợ, còn thì phải trả.
        //  · Nợ dọn phòng: item còn ở CLEANING của CHÍNH NGÀY LÀM VIỆC này. Giới
        //                  hạn theo ngày vì trong DB còn nhiều dòng CLEANING cũ
        //                  hàng tháng trời, chặn theo chúng là khoá người ta vĩnh
        //                  viễn vì rác dữ liệu chứ không phải vì lỗi hôm nay.
        let roomDebt = { handover: 0, cleaning: 0, total: 0, items: [] as any[] };
        if (userRow?.code) {
            const { getBusinessDate } = await import('@/app/api/ktv/booking/_shared/utils');
            const bizDate = getBusinessDate();

            const { data: debtRows, error: debtErr } = await supabase
                .from('BookingItems')
                .select('id, roomName, status, handover_status, timeStart')
                .contains('technicianCodes', [userRow.code])
                .or(`handover_status.in.(SKIPPED,REJECTED),status.eq.CLEANING`);

            if (debtErr) {
                console.error('[Attendance] Không đọc được nợ phòng:', debtErr);
            } else {
                for (const it of (debtRows || [])) {
                    const owesHandover = ['SKIPPED', 'REJECTED'].includes(String(it.handover_status || '').toUpperCase());
                    const owesCleaning = it.status === 'CLEANING'
                        && String(it.timeStart || '').slice(0, 10) === bizDate;
                    if (!owesHandover && !owesCleaning) continue;

                    if (owesHandover) roomDebt.handover++;
                    else roomDebt.cleaning++;

                    roomDebt.items.push({
                        id: it.id,
                        roomName: it.roomName,
                        kind: owesHandover ? 'HANDOVER' : 'CLEANING',
                    });
                }
                roomDebt.total = roomDebt.handover + roomDebt.cleaning;
            }
        }

        // ─── Fetch Guest Arrival Lock (Only for TYPE_D) ───
        let guestArrivalLock = { active: false, lockedBy: '', lockedAt: '', message: '' };
        if (workType === 'TYPE_D') {
            const { isGuestArrivalEnabled } = await import('@/lib/guest-arrival.logic');
            const isEnabled = await isGuestArrivalEnabled(supabase);

            if (isEnabled) {
                const { data: activeLock } = await supabase
                    .from('GuestArrivalEvents')
                    .select('created_by_name, created_at, note')
                    .is('released_at', null)
                    .maybeSingle();

                if (activeLock) {
                    guestArrivalLock = {
                        active: true,
                        lockedBy: activeLock.created_by_name,
                        lockedAt: activeLock.created_at,
                        message: activeLock.note || 'Quầy vừa báo có khách. Vui lòng giữ máy.'
                    };
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
            return NextResponse.json({ success: true, checkStatus: 'IDLE', record: null, workType, availableUntil, incompleteTasksCount, roomDebt, guestArrivalLock, lockInfo, todayRegistration, canRequestWithdraw: !daDiemDanhHomNay, withdrawWalletOff });
        }

        const { checkStatus, record } = resolveAttendanceStatus(records, workType);
        return NextResponse.json({ success: true, checkStatus, record, workType, availableUntil, incompleteTasksCount, roomDebt, guestArrivalLock, lockInfo, todayRegistration, canRequestWithdraw: !daDiemDanhHomNay, withdrawWalletOff });

    } catch (error: any) {
        console.error('❌ [Attendance Status] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
