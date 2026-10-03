import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOfficeScoreService, HOURS_PENALTY_VI, currentMonthVn } from '@/lib/services/KtvOfficeScoreService';

export const dynamic = 'force-dynamic';

/**
 * Sổ giờ chi tiết của 1 KTV trong tháng — mở từ bảng xếp hạng giờ tích lũy.
 *
 * Tách khỏi /api/admin/ktv-office/staff/[id] (route đó gắn với quyền chấm điểm và
 * kèm cả điểm Office): ở đây chỉ cần sổ giờ, và người chỉ có quyền xem giờ vẫn phải
 * mở được chi tiết.
 */
export async function GET(request: Request) {
    try {
        await requirePermission('ktv_office_hours');

        const { searchParams } = new URL(request.url);
        const staffId = searchParams.get('staffId');
        if (!staffId) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
        }
        const monthParam = searchParams.get('month');
        const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam! : currentMonthVn();

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const { data: staff, error: staffError } = await supabase
            .from('Staff')
            .select('id, full_name, status, avatar_url')
            .eq('id', staffId)
            .maybeSingle();
        if (staffError) throw staffError;
        if (!staff) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy KTV' }, { status: 404 });
        }

        // Rút hàng đợi trước khi đọc, giống hours-ranking: nếu không, tua vừa xong
        // đã hiện ở bảng xếp hạng nhưng chưa có trong chi tiết — hai số lệch nhau
        // ngay trong cùng một lần bấm.
        const { drainQueueForStaff } = await import('@/lib/services/KtvDLedgerWriter');
        await drainQueueForStaff(supabase, [staffId]);

        const ledger = await KtvOfficeScoreService.hoursLedger(supabase, staffId, month);

        // hoursLedger đã ưu tiên bill_code làm mã đơn; chỉ còn đơn cũ mới rơi về
        // UUID nội bộ — rút gọn cho đỡ chiếm chỗ, vẫn đủ để tra ngược.
        const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
        const rows = ledger.rows.map(r => ({
            ...r,
            penaltyLabel: r.penaltyType ? (HOURS_PENALTY_VI[r.penaltyType] || r.penaltyType) : null,
            orderCode: r.bookingId
                ? (isUuid(r.bookingId) ? `#${r.bookingId.slice(0, 8)}` : r.bookingId)
                : null,
        }));

        // Lấy tổng đã cộng từ số gốc trong hoursLedger, KHÔNG tự cộng lại các dòng
        // đã làm tròn — nếu không, ô "Thực nhận" lệch số dư dòng mới nhất 0.01h.
        const { earnedTotal, penaltyTotal, total } = ledger;

        return NextResponse.json({
            success: true,
            month,
            staff: {
                id: staff.id,
                code: staff.id,
                name: staff.full_name || staff.id,
                avatarUrl: staff.avatar_url,
                locked: staff.status === 'KHÓA_TÀI_KHOẢN',
            },
            hours: {
                earned: earnedTotal,
                penalty: penaltyTotal,
                net: total,
                turns: rows.filter(r => r.earned > 0).length,
                days: new Set(rows.filter(r => r.earned > 0).map(r => r.date)).size,
                rows,
            },
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi lấy sổ giờ chi tiết:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
