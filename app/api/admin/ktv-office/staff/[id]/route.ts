import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOfficeScoreService, HOURS_PENALTY_VI, currentMonthVn } from '@/lib/services/KtvOfficeScoreService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requirePermission('ktv_office_scoring');

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const monthParam = searchParams.get('month');
        const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam! : currentMonthVn();

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const { data: staff, error: staffError } = await supabase
            .from('Staff')
            .select('id, full_name, status, avatar_url, work_type')
            .eq('id', id)
            .maybeSingle();
        if (staffError) throw staffError;
        if (!staff) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy KTV' }, { status: 404 });
        }

        const [scores, ledger] = await Promise.all([
            KtvOfficeScoreService.computeMonth(supabase, [id], month),
            KtvOfficeScoreService.hoursLedger(supabase, id, month),
        ]);
        const m = scores.get(id)!;

        // Mã phạt sang tiếng Việt để lễ tân đọc được, giữ lại mã gốc cho việc truy vết.
        // orderCode: booking_id đôi khi là UUID nội bộ (đơn cũ), đôi khi là mã đơn
        // đọc được kiểu 'WB-002-03092026'. UUID thì rút gọn cho đỡ chiếm chỗ,
        // vẫn giữ bookingId đầy đủ để tra ngược.
        const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
        const hoursRows = ledger.rows.map(r => ({
            ...r,
            penaltyLabel: r.penaltyType ? (HOURS_PENALTY_VI[r.penaltyType] || r.penaltyType) : null,
            orderCode: r.bookingId
                ? (isUuid(r.bookingId) ? `#${r.bookingId.slice(0, 8)}` : r.bookingId)
                : null,
        }));

        return NextResponse.json({
            success: true,
            month,
            staff: {
                id: staff.id,
                code: staff.id,
                name: staff.full_name || staff.id,
                avatarUrl: staff.avatar_url,
                workType: staff.work_type,
                locked: staff.status === 'KHÓA_TÀI_KHOẢN',
            },
            office: {
                /** false = chưa có ngày công nào trong tháng → chưa có dữ liệu. */
                hasData: m.hasData,
                workDays: m.workDays,
                cleanDays: m.cleanDays,
                avg: m.avg,
                repeats: m.repeats,
                repeatPenalty: m.repeatPenalty,
                score: m.final,
                exemptPct: m.exemptPct,
                fundDue: m.fundDue,
                days: m.days,
            },
            hours: {
                total: ledger.total,
                rows: hoursRows,
            },
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi lấy chi tiết KTV Office:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
