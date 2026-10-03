import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET /api/ktv/attendance/pending
 * Trả về danh sách KTVAttendance đang PENDING để admin/reception xác nhận
 */
export async function GET() {
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });

    const { data, error } = await supabase
        .from('KTVAttendance')
        .select('id, employeeId, employeeName, checkType, latitude, longitude, locationText, checkedAt, status, photoUrl, reason, is_live_capture')
        .eq('status', 'PENDING')
        .order('checkedAt', { ascending: false });

    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data ?? [] });
}
