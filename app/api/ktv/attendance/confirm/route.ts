import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';

// 🔧 CONFIG
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * PATCH /api/ktv/attendance/confirm
 * Body: { attendanceId: string, action: 'CONFIRM' | 'REJECT', adminId?: string }
 * 
 * Admin confirms or rejects a PENDING attendance record.
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { attendanceId, action, adminId } = body;

        if (!attendanceId || !action) {
            return NextResponse.json({ success: false, error: 'Missing attendanceId or action' }, { status: 400 });
        }
        if (!['CONFIRM', 'REJECT'].includes(action)) {
            return NextResponse.json({ success: false, error: 'action must be CONFIRM or REJECT' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Fetch the attendance record
        const { data: attendance, error: fetchError } = await supabase
            .from('KTVAttendance')
            .select('*')
            .eq('id', attendanceId)
            .maybeSingle();

        if (fetchError || !attendance) {
            return NextResponse.json({ success: false, error: 'Attendance record not found' }, { status: 404 });
        }

        // Lấy staffCode từ Users table vì TurnQueue.employee_id lưu staffCode (vd: NH014)
        const { data: userRow } = await supabase
            .from('Users')
            .select('code, role')
            .eq('id', attendance.employeeId)
            .maybeSingle();
        const staffCode = userRow?.code || attendance.employeeId;
        const userRole = userRow?.role;

        const newStatus = action === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED';

        // ─── Update KTVAttendance status ────────────────────────────────
        const { error: updateError } = await supabase
            .from('KTVAttendance')
            .update({
                status: newStatus,
                confirmedBy: adminId || null,
                confirmedAt: new Date().toISOString(),
            })
            .eq('id', attendanceId);

        if (updateError) {
            console.error('❌ [Attendance CONFIRM] Update error:', updateError);
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }

        // ─── Lấy cấu hình Day Cut-off để tính ngày Business Day ────────────
        const { data: configData } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'spa_day_cutoff_hours')
            .maybeSingle();
        const cutoffHours = (configData?.value != null) ? Number(configData.value) : 6;

        // Tính ngày làm việc (Business Date) dựa trên thời điểm KTV bấm điểm danh (checkedAt)
        const checkTimeVn = new Date(new Date(attendance.checkedAt).getTime() + VN_OFFSET_MS);
        const businessDateObj = new Date(checkTimeVn.getTime() - cutoffHours * 60 * 60 * 1000);
        const businessDateStr = businessDateObj.toISOString().split('T')[0];

        // ─── If CONFIRMED CHECK_IN: upsert TurnQueue ────────────────────
        if (action === 'CONFIRM' && (attendance.checkType === 'CHECK_IN' || attendance.checkType === 'LATE_CHECKIN') && userRole === 'TECHNICIAN') {
            const today = businessDateStr;

            const { data: existingTurn } = await supabase
                .from('TurnQueue')
                .select('id')
                .eq('employee_id', staffCode)
                .eq('date', today)
                .maybeSingle();

            if (!existingTurn) {
                const { data: maxPosRow } = await supabase
                    .from('TurnQueue')
                    .select('queue_position')
                    .eq('date', today)
                    .order('queue_position', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const nextPosition = (maxPosRow?.queue_position ?? 0) + 1;

                const { error: turnError } = await supabase
                    .from('TurnQueue')
                    .insert({
                        employee_id: staffCode,
                        date: today,
                        queue_position: nextPosition,
                        status: 'waiting',
                        turns_completed: 0,
                    });

                if (turnError) {
                    console.warn('⚠️ [Attendance CONFIRM] TurnQueue insert failed:', turnError.message);
                }
            }
        }

        // ─── If CONFIRMED CHECK_OUT or SUDDEN_OFF: set status = off (hiển thị mờ cuối danh sách) ──────
        if (action === 'CONFIRM' && (attendance.checkType === 'CHECK_OUT' || attendance.checkType === 'SUDDEN_OFF')) {
            const today = businessDateStr;

            if (userRole === 'TECHNICIAN') {
                await supabase
                    .from('TurnQueue')
                    .update({ status: 'off' })
                    .eq('employee_id', staffCode)
                    .eq('date', today);
            }
                
            await supabase
                .from('Users')
                .update({ isOnShift: false })
                .eq('id', attendance.employeeId);
        }

        // ─── Notify KTV via StaffNotifications ──────────────────────────
        const isCheckIn = attendance.checkType === 'CHECK_IN' || attendance.checkType === 'LATE_CHECKIN';
        const isSuddenOff = attendance.checkType === 'SUDDEN_OFF';
        
        let ktvMessage = '';
        if (action === 'CONFIRM') {
            if (isCheckIn) ktvMessage = '✅ Admin đã xác nhận điểm danh của bạn!';
            else if (isSuddenOff) ktvMessage = '✅ Admin đã xác nhận yêu cầu nghỉ đột xuất của bạn!';
            else ktvMessage = '✅ Admin đã xác nhận tan ca!';
        } else {
            if (isCheckIn) ktvMessage = '❌ Admin từ chối điểm danh. Vui lòng liên hệ quản lý.';
            else if (isSuddenOff) ktvMessage = '❌ Admin từ chối yêu cầu nghỉ đột xuất.';
            else ktvMessage = '❌ Admin từ chối tan ca.';
        }

        await createNotification({
            type: 'ATTENDANCE_RESPONSE',
            message: ktvMessage,
            employeeId: attendance.employeeId,  // gán riêng cho KTV
        });

        console.log(`✅ [Attendance CONFIRM] ${attendance.employeeName}: ${action} ${attendance.checkType}`);

        return NextResponse.json({ success: true, status: newStatus });

    } catch (error: any) {
        console.error('❌ [Attendance CONFIRM] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
