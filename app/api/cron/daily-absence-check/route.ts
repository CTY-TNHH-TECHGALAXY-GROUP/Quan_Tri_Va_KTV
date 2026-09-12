import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvTypeDDisciplineService } from '@/lib/services/KtvTypeDDisciplineService';
import type { TypeDDisciplineCaseKey } from '@/lib/constants/staff.constants';
import { createNotification } from '@/lib/notification-helper';
import { vnDate } from '@/lib/vn-time';

export const dynamic = 'force-dynamic';

/**
 * ================================================================
 * CHỐT SỔ KỶ LUẬT CUỐI NGÀY — LOẠI D
 * ================================================================
 * MỘT lượt duy nhất, chạy lúc 00:00 giờ VN. Quy chế Phase 5.5
 * (plans/plan_type_d_bao_vang_bao_tre.md mục 14) chốt sổ lúc 23:59 — tức là
 * đúng thời khắc này. Trước đây việc bị xé làm hai lượt (00:00 và 06:30/07:00)
 * nên KTV phải nhớ hai mốc giờ, còn người đã lặn cả ngày thì tới sáng hôm sau
 * mới biết.
 *
 * Bốn tình huống, CHẾ TÀI DO QUẢN LÝ ĐẶT ở Cài đặt → Loại D (không còn viết
 * cứng ở đây):
 *
 *   NO_REGISTRATION          — hôm qua không đăng ký gì và cũng không đi làm
 *   NO_SHOW_NO_NOTICE        — đăng ký làm, không báo, không đến
 *   LATE_REPORTED_NO_SHOW    — đã báo trễ nhưng vẫn không đến
 *   ABSENT_REPORTED_NO_SHOW  — báo vắng trước 07:00 rồi không đến
 *
 * Mỗi tình huống chọn được: chỉ trừ giờ · khoá thẳng · trừ giờ, quỹ không đủ
 * thì khoá. Xem `KtvTypeDDisciplineService.applyCasePenalty`.
 *
 * ⚠️ Dùng NGÀY LỊCH VN, không phải ngày làm việc theo cutoff 06:00. Bảng
 * `KTVTypeDDailyRegistration.work_date` và `KTVAttendance.date` đều được ghi
 * bằng ngày lịch; tra bằng business date sẽ lệch một ngày và phạt nhầm.
 *
 * ⚠️ Ngày làm việc của spa đóng lúc 06:00 chứ không phải 00:00, nên trên lý
 * thuyết ai điểm danh trong khoảng 00:00–06:00 cho ngày hôm qua sẽ bị chấm oan.
 * Đã cân nhắc và chấp nhận (12/09): spa đóng cửa trước nửa đêm.
 */

/** Một dòng kết quả để trả về và in log — đủ để đối chiếu khi có khiếu nại. */
interface KetQuaXuLy {
    staff: string;
    ten: string | null;
    caseKey: TypeDDisciplineCaseKey;
    lyDo: string;
    ketQua: 'LOCK' | 'DEDUCT' | 'NONE';
    hours: number;
    /** Quỹ giờ tại thời điểm xử — chỉ có khi chế tài là "không đủ thì khoá". */
    netHours: number | null;
}

/** Ngày lịch VN hôm nay, 'YYYY-MM-DD'. */
function ngayVnHomNay(): string {
    return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function luiMotNgay(ngay: string): string {
    return new Date(new Date(ngay + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
}

async function run(dry = false) {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase admin not configured' }, { status: 500 });
    }

    // ⚠️ CÔNG TẮC AN TOÀN. Tắt thì vẫn chạy và vẫn liệt kê, chỉ không ghi gì —
    // để quản lý soi trước xem luật sẽ quét ai. Bật/tắt ở Cài đặt → Loại D,
    // không cần deploy.
    const enabled = !dry && await KtvTypeDDisciplineService.isEnabled(supabase);

    // Chạy lúc 00:00 nên "hôm nay" đã là ngày mới; ngày cần chốt là ngày vừa qua.
    const ngayVuaQua = luiMotNgay(ngayVnHomNay());

    console.log(`[Kỷ luật D] Chốt sổ ngày ${ngayVuaQua} (${enabled ? 'ĐANG BẬT' : dry ? 'CHẠY THỬ' : 'đang TẮT — chỉ ghi log'})`);

    const { data: staffList, error: staffError } = await supabase
        .from('Staff')
        .select('id, full_name, created_at')
        .eq('work_type', 'TYPE_D')
        .neq('status', 'KHÓA_TÀI_KHOẢN');
    if (staffError) throw staffError;

    const ids = (staffList || []).map((s: any) => s.id);
    if (ids.length === 0) {
        return NextResponse.json({ success: true, enabled, dry, targetDate: ngayVuaQua, results: [] });
    }

    const [regCu, diemDanh] = await Promise.all([
        supabase.from('KTVTypeDDailyRegistration')
            .select('*').eq('work_date', ngayVuaQua).in('staff_id', ids),
        supabase.from('KTVAttendance')
            .select('employeeId').eq('date', ngayVuaQua).in('employeeId', ids)
            .in('checkType', ['CHECK_IN', 'LATE_CHECKIN']),
    ]);

    const regCuTheoNguoi = new Map((regCu.data || []).map((r: any) => [r.staff_id, r]));
    const daDiLam = new Set((diemDanh.data || []).map((r: any) => r.employeeId));

    const results: KetQuaXuLy[] = [];

    /** Gọi service xử rồi ghi lại kết quả. */
    const xuLy = async (
        staff: any, caseKey: TypeDDisciplineCaseKey, workDate: string, lyDo: string,
    ): Promise<void> => {
        const r = await KtvTypeDDisciplineService.applyCasePenalty(supabase, {
            staffId: staff.id,
            staffName: staff.full_name,
            workDate,
            caseKey,
            reason: lyDo,
            source: 'CRON_MIDNIGHT',
        }, !enabled);

        if (r.ketQua !== 'NONE') {
            results.push({
                staff: staff.id, ten: staff.full_name, caseKey, lyDo,
                ketQua: r.ketQua, hours: r.hours, netHours: r.netHours,
            });
        }
    };

    for (const staff of staffList || []) {
        // KTV mới tạo hôm qua hoặc hôm nay → chưa kịp làm quen, bỏ qua.
        if (staff.created_at && String(staff.created_at).slice(0, 10) >= ngayVuaQua) continue;

        const reg: any = regCuTheoNguoi.get(staff.id);
        const coDiLam = daDiLam.has(staff.id) || !!reg?.check_in_at;

        if (!reg) {
            // Không đăng ký gì. Có đến làm thì chỉ là quên đăng ký → bỏ qua.
            if (!coDiLam) {
                await xuLy(staff, 'NO_REGISTRATION', ngayVuaQua, 'Không đăng ký lịch và không đi làm');
            }
            continue;
        }

        // Đăng ký OFF, hoặc có đến làm → xong việc, đóng sổ ngày đó.
        if (reg.status === 'OFF_REGISTERED' || coDiLam) {
            if (enabled) {
                await supabase.from('KTVTypeDDailyRegistration')
                    .update({ status: 'COMPLETED' }).eq('id', reg.id);
            }
            continue;
        }

        // Đăng ký làm nhưng không đến. Ba đường, ba mức.
        const daPhat = reg.penalty_applied;
        if (daPhat) continue;   // lượt trước đã xử rồi, không phạt hai lần

        const { caseKey, lyDo } = reg.status === 'ABSENT_REPORTED' && reg.absent_reported_at
            ? { caseKey: 'ABSENT_REPORTED_NO_SHOW' as const, lyDo: 'Đã báo vắng nhưng không đi làm' }
            : reg.status === 'LATE_REPORTED'
                ? { caseKey: 'LATE_REPORTED_NO_SHOW' as const, lyDo: 'Đã báo trễ nhưng không đến làm' }
                : { caseKey: 'NO_SHOW_NO_NOTICE' as const, lyDo: 'Đăng ký làm nhưng không đến và không báo' };

        await xuLy(staff, caseKey, ngayVuaQua, lyDo);

        if (enabled) {
            await supabase.from('KTVTypeDDailyRegistration')
                .update({ penalty_applied: caseKey, status: 'COMPLETED' }).eq('id', reg.id);
        }
    }

    const biKhoa = results.filter(r => r.ketQua === 'LOCK');
    const biTruGio = results.filter(r => r.ketQua === 'DEDUCT');

    if (biKhoa.length > 0 && enabled) {
        // Bản tổng hợp viết ở ngôi thứ ba và gửi cho quản lý, nên là EMERGENCY.
        const ten = biKhoa.map(r => (r.ten ? `${r.ten} (${r.staff})` : r.staff)).join(', ');
        await createNotification({
            type: 'EMERGENCY',
            message: `Hệ thống vừa khoá ${biKhoa.length} KTV Loại D khi chốt sổ ngày ${vnDate(ngayVuaQua)}: ${ten}`,
            employeeId: null,
        });
    }

    console.log(`[Kỷ luật D] ${results.length} lượt xử · ${biTruGio.length} bị trừ giờ · ${biKhoa.length} bị khoá`);

    return NextResponse.json({
        success: true,
        enabled,
        dry,
        targetDate: ngayVuaQua,
        lockedCount: biKhoa.length,
        deductedCount: biTruGio.length,
        results,
        note: enabled ? undefined
            : dry ? 'CHẠY THỬ (dry=1) — danh sách chỉ là dự kiến, chưa ghi gì.'
                : 'Kỷ luật đang TẮT — danh sách chỉ là dự kiến, chưa ghi gì.',
    });
}

export async function GET(request: Request) {
    // ⚠️ Vercel Cron gọi bằng GET. Trước đây file này chỉ export POST nên cron
    // luôn trả 405 và toàn bộ kỷ luật loại D chưa bao giờ được áp dụng.
    const authHeader = request.headers.get('Authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        // Chỉ còn MỘT lượt. `?mode=lock-unregistered` giữ lại cho lịch cron cũ
        // và cho link mà quản lý đã lưu — gọi vào cùng một chỗ.
        //
        // ?dry=1 → chỉ liệt kê sẽ đụng vào ai, KHÔNG ghi gì. Dùng để soi trước
        //          khi bật kỷ luật, khỏi khoá nhầm cả tiệm rồi mới biết.
        const dry = new URL(request.url).searchParams.get('dry') === '1';
        return await run(dry);
    } catch (error: any) {
        console.error('Lỗi daily-absence-check:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = GET;
