import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOfficeScoreService, monthRange, currentMonthVn, attendedStaffOfMonth, assignRanks } from '@/lib/services/KtvOfficeScoreService';

export const dynamic = 'force-dynamic';

/**
 * Bảng xếp hạng GIỜ TÍCH LŨY của KTV Loại D.
 *
 * Nguồn: KTVDTurnLedger (giờ làm mỗi tua) + KTVDPenaltyLedger (giờ phạt) — đúng hai
 * bảng mà thứ tự nhận tua ở màn điều phối đang đọc, nên bảng này, trang Chấm điểm và
 * ô "Thời gian" trên dashboard KTV luôn ra cùng một con số.
 *
 *   ?scope=month (mặc định) + ?month=YYYY-MM  → 1 tháng
 *   ?scope=all                                → lũy kế toàn bộ lịch sử
 *
 * Server KHÔNG gán hạng: trả cả `earned` lẫn `net` rồi để client xếp theo tiêu chí
 * người dùng chọn, đổi tiêu chí không phải gọi lại API.
 */
export async function GET(request: Request) {
    try {
        await requirePermission('ktv_office_hours');

        const { searchParams } = new URL(request.url);
        const scope = searchParams.get('scope') === 'all' ? 'all' : 'month';
        const monthParam = searchParams.get('month');
        const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam! : currentMonthVn();

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        // Chỉ KTV Loại D — quy chế giờ tích lũy chỉ áp dụng cho nhóm này.
        const { data: staff, error: staffError } = await supabase
            .from('Staff')
            .select('id, full_name, status, avatar_url')
            .eq('work_type', 'TYPE_D')
            .neq('status', 'ĐÃ NGHỈ');
        if (staffError) throw staffError;

        const staffList = staff || [];
        const staffIds = staffList.map((s: any) => s.id);
        const range = scope === 'all' ? {} : monthRange(month);

        if (staffIds.length === 0) {
            return NextResponse.json({ success: true, scope, month, range, data: [] });
        }

        // Tua vừa xong còn nằm trong hàng đợi cho tới khi cron chạy (5 phút/lần).
        // Rút ngay phần của nhóm loại D để bảng xếp hạng không trễ một nhịp so với
        // màn điều phối. Cron vẫn là lưới an toàn.
        const { drainQueueForStaff } = await import('@/lib/services/KtvDLedgerWriter');
        await drainQueueForStaff(supabase, staffIds);

        const hours = await KtvOfficeScoreService.hoursBreakdown(supabase, staffIds, range);

        const data = staffList.map((s: any) => {
            const h = hours.get(s.id)!;
            return {
                id: s.id,
                code: s.id,
                name: s.full_name || s.id,
                avatarUrl: s.avatar_url,
                locked: s.status === 'KHÓA_TÀI_KHOẢN',
                earned: h.earned,
                penalty: h.penalty,
                net: h.net,
                turns: h.turns,
                days: h.days,
                lastDate: h.lastDate,
                // Giờ trung bình mỗi ngày có đi làm — người làm ít ngày mà giờ cao
                // vẫn nhìn ra được, thay vì chỉ thấy tổng.
                avgPerDay: h.days > 0 ? Math.round((h.earned / h.days) * 100) / 100 : 0,
            };
        });

        // Thứ tự mặc định = CHUẨN của bảng điều phối: giờ ròng giảm dần, hoà thì
        // mã nhân viên tăng dần. Người chưa điểm danh trong tháng thì CHƯA CÓ
        // HẠNG (`rank = null`) và nằm cuối — giống hệt màn KTV.
        const attended = await attendedStaffOfMonth(supabase, staffIds, month);
        const ranked = assignRanks(data as any, attended);
        data.length = 0;
        (data as any[]).push(...ranked);

        return NextResponse.json({
            success: true, scope, month, range,
            rankedCount: (data as any[]).filter(r => r.ranked).length,
            data,
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi lấy bảng xếp hạng giờ tích lũy:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
