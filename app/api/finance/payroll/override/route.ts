import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/finance/payroll/override
 * Cập nhật thủ công trạng thái điểm danh (Vắng mặt, Nghỉ phép, Nghỉ đột xuất)
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { employeeId, employeeName, date, newStatus, reviewedBy } = body;

        if (!employeeId || !date || !newStatus) {
            return NextResponse.json({ success: false, error: 'Thiếu dữ liệu bắt buộc' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ success: false, error: 'Lỗi khởi tạo DB' }, { status: 500 });

        // 1. Luôn xoá KTVLeaveRequests của ngày hôm đó trước (nếu có)
        await supabase
            .from('KTVLeaveRequests')
            .delete()
            .match({ employeeId, date });

        // 2. Xoá toàn bộ KTVAttendance của ngày đó để tránh xung đột
        await supabase
            .from('KTVAttendance')
            .delete()
            .match({ employeeId, date });

        // 3. Xử lý theo newStatus
        if (newStatus === 'off' || newStatus === 'suddenOff' || newStatus === 'free' || newStatus === 'request') {
            const isSudden = newStatus === 'suddenOff';
            let reason = 'Chỉnh sửa thủ công từ Bảng lương';
            if (newStatus === 'free') reason = 'OVERRIDE:FREE';
            if (newStatus === 'request') reason = 'OVERRIDE:REQUEST';

            const { error: insertError } = await supabase
                .from('KTVLeaveRequests')
                .insert({
                    employeeId,
                    employeeName: employeeName || employeeId,
                    date,
                    reason,
                    status: 'APPROVED',
                    is_sudden_off: isSudden,
                    reviewedBy: reviewedBy || 'Admin',
                    reviewedAt: new Date().toISOString()
                });

            if (insertError) throw insertError;
        }
        // Nếu newStatus === 'absent', không cần insert gì thêm (coi như Vắng Mặc định)

        return NextResponse.json({ success: true, message: 'Cập nhật thành công' });

    } catch (err: any) {
        console.error('❌ [Payroll Override API]', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
