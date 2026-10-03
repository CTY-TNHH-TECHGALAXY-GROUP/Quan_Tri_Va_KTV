import { NextResponse } from 'next/server';
import { requirePermission, requireBusinessUser } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getBusinessToday } from '@/lib/business-date';
import { KtvOfficeScoreService, isOfficeManager } from '@/lib/services/KtvOfficeScoreService';
import { workdayEvidenceForMonth, evidenceLabel } from '@/lib/services/KtvOfficeWorkdayService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/ktv-office/calendar?staffId=T069&month=2026-09
 *
 * Dữ liệu cho LỊCH chọn "Ngày vi phạm" trên sheet trừ điểm — làm giống lịch KTV
 * xem ở modal Điểm Office: mỗi ngày một ô, xanh = đi làm không lỗi, đỏ = có lỗi
 * (kèm điểm ngày), xám = không đi làm.
 *
 * Khác lịch của KTV ở chỗ lịch này còn quyết định ngày nào BẤM ĐƯỢC. Nên trả kèm:
 *   · `canDeduct` từng ngày — cùng luật với cửa chặn của POST /deduct;
 *   · `canPickOld` — người đang xem có được chọn ngày cũ hơn hôm qua không. Lấy
 *     từ `isOfficeManager` phía SERVER, đúng hàm POST /deduct dùng để chặn, chứ
 *     không để client tự đoán theo tên vai trò (client và server từng gọi tên
 *     vai trò khác nhau: `branch_manager` vs `MANAGER`).
 */
export async function GET(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');
        const bUser = await requireBusinessUser();

        const { searchParams } = new URL(request.url);
        const staffId = searchParams.get('staffId');
        const monthParam = searchParams.get('month') || '';
        if (!staffId) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV.' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const today = await getBusinessToday(supabase);
        const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : today.slice(0, 7);

        const [evidence, scores] = await Promise.all([
            workdayEvidenceForMonth(supabase, staffId, month),
            KtvOfficeScoreService.computeMonth(supabase, [staffId], month),
        ]);
        const dayOf = new Map((scores.get(staffId)?.days || []).map(d => [d.workDate, d]));

        const days = [...evidence.entries()].map(([date, e]) => {
            const d = dayOf.get(date);
            return {
                date,
                canDeduct: e.canDeduct,
                label: evidenceLabel(e),
                dayScore: d ? d.dayScore : null,
                hitCount: d ? d.hits.length : 0,
            };
        });

        return NextResponse.json({
            success: true,
            month,
            today,
            // Compatibility Phase: không có JWT thì `bUser` null — coi như lễ tân,
            // tức là CHẶT hơn. Server vẫn là cửa chặn thật khi gửi phiếu.
            canPickOld: isOfficeManager(bUser?.role),
            days,
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi lấy lịch trừ điểm:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
