import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOfficeScoreService, currentMonthVn, attendedStaffOfMonth } from '@/lib/services/KtvOfficeScoreService';
import { getBusinessToday } from '@/lib/business-date';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');

        const { searchParams } = new URL(request.url);
        const monthParam = searchParams.get('month');
        const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam! : currentMonthVn();

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        // Chỉ KTV Loại D. Không có ai thì trả mảng rỗng — KHÔNG fallback sang toàn bộ
        // nhân viên, vì trang này chấm điểm theo quy chế riêng của Loại D.
        const { data: staff, error: staffError } = await supabase
            .from('Staff')
            .select('id, full_name, status, avatar_url')
            .eq('work_type', 'TYPE_D')
            .neq('status', 'ĐÃ NGHỈ');
        if (staffError) throw staffError;

        const staffList = staff || [];
        const staffIds = staffList.map((s: any) => s.id);

        // NGÀY LÀM VIỆC hôm nay (mốc cắt 06:00), không phải ngày lịch của trình
        // duyệt. Sheet chấm điểm lấy con số này cho nút "Hôm nay"/"Hôm qua" nên
        // ca đêm sau nửa đêm vẫn trừ đúng vào ngày làm việc đang chạy — cùng hệ
        // ngày với chấm công và sổ cái tua.
        const today = await getBusinessToday(supabase);

        if (staffIds.length === 0) {
            return NextResponse.json({ success: true, month, today, data: [] });
        }

        const [scores, hours, lockLogs] = await Promise.all([
            KtvOfficeScoreService.computeMonth(supabase, staffIds, month),
            KtvOfficeScoreService.hoursTotals(supabase, staffIds, month),
            supabase
                .from('SecurityAuditLogs')
                .select('employee_id, created_at, details')
                .in('employee_id', staffIds)
                .eq('event_type', 'AUTO_LOCK_ABSENCE')
                .order('created_at', { ascending: false }),
        ]);

        // Lý do khóa gần nhất của mỗi KTV, để hiển thị trên thẻ đang bị khóa.
        const lockInfo = new Map<string, { reason: string; at: string }>();
        (lockLogs.data || []).forEach((l: any) => {
            if (!lockInfo.has(l.employee_id)) {
                lockInfo.set(l.employee_id, {
                    reason: l.details?.reason || 'Vi phạm kỷ luật',
                    at: l.created_at,
                });
            }
        });

        const data = staffList.map((s: any) => {
            const m = scores.get(s.id)!;
            const locked = s.status === 'KHÓA_TÀI_KHOẢN';
            return {
                id: s.id,
                code: s.id,
                name: s.full_name || s.id,
                avatarUrl: s.avatar_url,
                locked,
                lockReason: locked ? lockInfo.get(s.id)?.reason ?? null : null,
                lockedAt: locked ? lockInfo.get(s.id)?.at ?? null : null,
                score: m.final,
                /** false = chưa có ngày công nào trong tháng → chưa có dữ liệu. */
                hasData: m.hasData,
                workDays: m.workDays,
                avg: m.avg,
                repeats: m.repeats,
                repeatPenalty: m.repeatPenalty,
                exemptPct: m.exemptPct,
                fundDue: m.fundDue,
                hours: hours.get(s.id) ?? 0,
            };
        });

        // Xếp hạng theo giờ tích lũy — quy chế: giờ cao hơn được ưu tiên xếp tua trước.
        // KTV bị khóa không tham gia xếp hạng vì không nhận tua được.
        //
        // Hoà giờ thì chốt bằng MÃ NHÂN VIÊN tăng dần, đúng nút chặn cuối của
        // `KtvTypeDTurnService.getTurnQueue` (net DESC → check_in_order ASC →
        // employee_id ASC). Không có nút này thì thứ tự rơi về thứ tự PostgREST
        // trả về: đầu tháng khi cả đội cùng 0h, danh sách đảo lung tung mỗi lần
        // tải trang và quầy không tin được thứ hạng nào là thật.
        const byHours = (a: any, b: any) => (b.hours - a.hours) || String(a.id).localeCompare(String(b.id));

        // Chưa điểm danh trong tháng thì chưa có hạng — cùng luật với bảng Giờ
        // tích lũy và màn KTV, để ba nơi không bao giờ nói ba con số.
        const attended = await attendedStaffOfMonth(supabase, staffIds, month);
        const ranked = data.filter(d => !d.locked && attended.has(d.id)).sort(byHours);
        ranked.forEach((d: any, i) => { d.rank = i + 1; });
        data.forEach((d: any) => { if (d.locked || !attended.has(d.id)) d.rank = null; });

        // Bị khóa lên đầu để không bị bỏ sót, còn lại theo thứ hạng.
        data.sort((a: any, b: any) => (Number(b.locked) - Number(a.locked)) || byHours(a, b));

        return NextResponse.json({ success: true, month, today, data });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi lấy summary KTV Office:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
