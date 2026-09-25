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
 * đúng thời khắc này.
 *
 * Năm tình huống, CHẾ TÀI DO QUẢN LÝ ĐẶT ở Cài đặt → Loại D (không viết cứng
 * ở đây). Thứ tự xét nằm ở `KtvTypeDDisciplineService.xetChotSoDem`:
 *
 *   NO_REGISTRATION          — ngày vừa qua không có dòng đăng ký (kể cả có đi làm)
 *   UNREGISTERED_NEXT_DAY    — ngày vừa sang chưa có dòng đăng ký
 *   NO_SHOW_NO_NOTICE        — đăng ký làm, không báo, không đến
 *   LATE_REPORTED_NO_SHOW    — đã báo trễ nhưng vẫn không đến
 *   ABSENT_REPORTED_NO_SHOW  — báo vắng trước 07:00 rồi không đến
 *
 * Hai luật đăng ký mặc định KHOÁ THẲNG (quyết định 14/09,
 * plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md). Mỗi người tối đa một lần
 * khoá mỗi đêm — khoá rồi thì dừng, không xét tiếp.
 *
 * ⚠️ Dùng NGÀY LỊCH VN, không phải ngày làm việc theo cutoff 06:00. Bảng
 * `KTVTypeDDailyRegistration.work_date` và `KTVAttendance.date` đều được ghi
 * bằng ngày lịch; tra bằng business date sẽ lệch một ngày và phạt nhầm.
 *
 * ⚠️ Không miễn người đang làm dở đơn lúc 00:00 (quyết định 14/09): đăng ký
 * trước là nghĩa vụ. Người đó bị đá khỏi app, quầy xử lý đơn thay.
 */

/** Một dòng kết quả để trả về và in log — đủ để đối chiếu khi có khiếu nại. */
interface KetQuaXuLy {
    staff: string;
    ten: string | null;
    caseKey: TypeDDisciplineCaseKey;
    /** Ngày bị ghi sổ. */
    ngay: string;
    lyDo: string;
    ketQua: 'LOCK' | 'DEDUCT' | 'NONE';
    hours: number;
    /** Quỹ giờ tại thời điểm xử — chỉ có khi chế tài là "không đủ thì khoá". */
    netHours: number | null;
    /** Khoá đã quyết nhưng HOÃN vì KTV còn đơn — áp bởi cron type-d-pending-lock. */
    hoan: boolean;
    donDangLam: string[];
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
    const ngayMoi = ngayVnHomNay();
    const ngayVuaQua = luiMotNgay(ngayMoi);

    console.log(`[Kỷ luật D] Chốt sổ ngày ${ngayVuaQua}, xét đăng ký ngày ${ngayMoi} (${enabled ? 'ĐANG BẬT' : dry ? 'CHẠY THỬ' : 'đang TẮT — chỉ ghi log'})`);

    const { data: staffList, error: staffError } = await supabase
        .from('Staff')
        .select('id, full_name, created_at')
        .eq('work_type', 'TYPE_D')
        .neq('status', 'KHÓA_TÀI_KHOẢN');
    if (staffError) throw staffError;

    const ids = (staffList || []).map((s: any) => s.id);
    if (ids.length === 0) {
        return NextResponse.json({ success: true, enabled, dry, targetDate: ngayVuaQua, newDate: ngayMoi, results: [] });
    }

    const [regMoi, regCu, diemDanh] = await Promise.all([
        supabase.from('KTVTypeDDailyRegistration')
            .select('staff_id').eq('work_date', ngayMoi).in('staff_id', ids),
        supabase.from('KTVTypeDDailyRegistration')
            .select('*').eq('work_date', ngayVuaQua).in('staff_id', ids),
        supabase.from('KTVAttendance')
            .select('employeeId').eq('date', ngayVuaQua).in('employeeId', ids)
            .in('checkType', ['CHECK_IN', 'LATE_CHECKIN']),
    ]);
    // Không đọc được đăng ký thì DỪNG: coi như "không ai đăng ký" là khoá cả tiệm.
    if (regMoi.error) throw regMoi.error;
    if (regCu.error) throw regCu.error;
    if (diemDanh.error) throw diemDanh.error;

    const daDangKyNgayMoi = new Set((regMoi.data || []).map((r: any) => r.staff_id));
    const regCuTheoNguoi = new Map((regCu.data || []).map((r: any) => [r.staff_id, r]));
    const daDiLam = new Set((diemDanh.data || []).map((r: any) => r.employeeId));

    const results: KetQuaXuLy[] = [];

    /** Gọi service xử, ghi lại kết quả. Trả về true nếu người này vừa bị khoá. */
    const xuLy = async (
        staff: any, caseKey: TypeDDisciplineCaseKey, workDate: string, lyDo: string,
    ): Promise<boolean> => {
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
                staff: staff.id, ten: staff.full_name, caseKey, ngay: workDate, lyDo,
                ketQua: r.ketQua, hours: r.hours, netHours: r.netHours,
                hoan: r.hoan, donDangLam: r.donDangLam,
            });
        }
        return r.ketQua === 'LOCK';
    };

    for (const staff of staffList || []) {
        // KTV mới tạo hôm qua hoặc hôm nay → chưa kịp làm quen, bỏ qua.
        if (staff.created_at && String(staff.created_at).slice(0, 10) >= ngayVuaQua) continue;

        const reg: any = regCuTheoNguoi.get(staff.id) || null;
        const { dongSoNgayVuaQua, loi } = KtvTypeDDisciplineService.xetChotSoDem({
            regNgayVuaQua: reg,
            coRegNgayMoi: daDangKyNgayMoi.has(staff.id),
            coDiLamNgayVuaQua: daDiLam.has(staff.id) || !!reg?.check_in_at,
        });

        if (dongSoNgayVuaQua && enabled) {
            await supabase.from('KTVTypeDDailyRegistration')
                .update({ status: 'COMPLETED' }).eq('id', reg.id);
        }

        for (const l of loi) {
            const biKhoa = await xuLy(staff, l.caseKey, l.ngay === 'MOI' ? ngayMoi : ngayVuaQua, l.lyDo);

            if (l.danhDauDangKy && enabled) {
                await supabase.from('KTVTypeDDailyRegistration')
                    .update({ penalty_applied: l.caseKey, status: 'COMPLETED' }).eq('id', reg.id);
            }
            // Đã khoá thì thôi, không chồng thêm án nào nữa trong đêm nay.
            if (biKhoa) break;
        }
    }

    const biKhoa = results.filter(r => r.ketQua === 'LOCK' && !r.hoan);
    const choKhoa = results.filter(r => r.ketQua === 'LOCK' && r.hoan);
    const biTruGio = results.filter(r => r.ketQua === 'DEDUCT');

    if ((biKhoa.length > 0 || choKhoa.length > 0) && enabled) {
        // Bản tổng hợp viết ở ngôi thứ ba và gửi cho quản lý, nên là EMERGENCY.
        const ten = (ds: KetQuaXuLy[]) => ds.map(r => (r.ten ? `${r.ten} (${r.staff})` : r.staff)).join(', ');
        const phan = [
            biKhoa.length > 0 ? `đã khoá ${biKhoa.length} KTV: ${ten(biKhoa)}` : '',
            choKhoa.length > 0 ? `sẽ khoá ${choKhoa.length} KTV khi xong đơn: ${choKhoa.map(r => `${r.ten || r.staff} (${r.donDangLam.join(', ')})`).join(', ')}` : '',
        ].filter(Boolean).join(' · ');
        await createNotification({
            type: 'EMERGENCY',
            message: `Chốt sổ Loại D đêm ${vnDate(ngayVuaQua)}: ${phan}`,
            employeeId: null,
        });
    }

    console.log(`[Kỷ luật D] ${results.length} lượt xử · ${biTruGio.length} bị trừ giờ · ${biKhoa.length} bị khoá · ${choKhoa.length} chờ khoá`);

    return NextResponse.json({
        success: true,
        enabled,
        dry,
        targetDate: ngayVuaQua,
        newDate: ngayMoi,
        lockedCount: biKhoa.length,
        pendingLockCount: choKhoa.length,
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
