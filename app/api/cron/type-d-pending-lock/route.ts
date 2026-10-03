import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvTypeDDisciplineService } from '@/lib/services/KtvTypeDDisciplineService';
import { invalidateLockedStaffCache } from '@/lib/auth-server';
import { createNotification } from '@/lib/notification-helper';
import { requireCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * ================================================================
 * ÁP KHOÁ ĐANG HOÃN — LOẠI D (mỗi 5 phút)
 * ================================================================
 * Cron chốt sổ 00:00 quyết khoá một KTV đang còn đơn (làm / dọn phòng / chờ
 * quầy duyệt bàn giao) thì không khoá ngay mà ghi `Staff.pending_lock`. Lượt
 * này hỏi lại từng người:
 *
 *   · đã bị khoá bằng đường khác  → xoá chờ
 *   · kỷ luật Loại D đang TẮT      → xoá chờ, không khoá
 *   · vẫn còn đơn                  → để yên, lượt sau hỏi tiếp
 *   · hết đơn                      → KHOÁ, xoá chờ
 *
 * Đơn lọc theo NGÀY LÀM VIỆC, nên qua 06:00 đơn đêm qua không còn tính — khoá
 * muộn nhất tới đó là áp, đơn kẹt không giữ người ta mãi.
 *
 * ?dry=1 → chỉ liệt kê, không ghi.
 *
 * plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md §9
 */

type HanhDong = 'KHOA' | 'CHO' | 'DA_KHOA_SAN' | 'KY_LUAT_TAT';

async function run(dry = false) {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase admin not configured' }, { status: 500 });
    }

    const { data: rows, error } = await supabase
        .from('Staff')
        .select('id, full_name, status, pending_lock')
        .not('pending_lock', 'is', null);
    if (error) throw error;

    if (!rows || rows.length === 0) {
        return NextResponse.json({ success: true, dry, results: [] });
    }

    const kyLuatBat = await KtvTypeDDisciplineService.isEnabled(supabase);
    const results: { staff: string; ten: string | null; hanhDong: HanhDong; donDangLam?: string[] }[] = [];

    for (const r of rows as any[]) {
        let pending = r.pending_lock;
        if (typeof pending === 'string') {
            try { pending = JSON.parse(pending); } catch { pending = null; }
        }

        const xoaCho = async () => {
            if (!dry) await supabase.from('Staff').update({ pending_lock: null }).eq('id', r.id);
        };

        if (r.status === 'KHÓA_TÀI_KHOẢN') {
            await xoaCho();
            results.push({ staff: r.id, ten: r.full_name, hanhDong: 'DA_KHOA_SAN' });
            continue;
        }
        if (!kyLuatBat || !pending?.workDate) {
            await xoaCho();
            results.push({ staff: r.id, ten: r.full_name, hanhDong: 'KY_LUAT_TAT' });
            continue;
        }

        const donDangLam = await KtvTypeDDisciplineService.timDonDangLam(supabase, r.id);
        if (donDangLam.length > 0) {
            results.push({ staff: r.id, ten: r.full_name, hanhDong: 'CHO', donDangLam });
            continue;
        }

        if (!dry) {
            await KtvTypeDDisciplineService.apDungKhoaDangCho(supabase, r.id, r.full_name, {
                workDate: pending.workDate,
                reason: pending.reason || 'Vi phạm kỷ luật',
            });
        }
        results.push({ staff: r.id, ten: r.full_name, hanhDong: 'KHOA' });
    }

    const vuaKhoa = results.filter(x => x.hanhDong === 'KHOA');
    if (vuaKhoa.length > 0 && !dry) {
        invalidateLockedStaffCache();
        await createNotification({
            type: 'EMERGENCY',
            message: `Đã khoá ${vuaKhoa.length} KTV Loại D sau khi xong đơn: ${vuaKhoa.map(x => x.ten ? `${x.ten} (${x.staff})` : x.staff).join(', ')}`,
            employeeId: null,
        });
    }

    if (results.some(x => x.hanhDong !== 'CHO')) {
        console.log(`[Khoá hoãn D] ${results.map(x => `${x.staff}:${x.hanhDong}`).join(' · ')}${dry ? ' (chạy thử)' : ''}`);
    }

    return NextResponse.json({ success: true, dry, results });
}

export async function GET(request: Request) {
    const unauthorized = requireCronAuth(request);
    if (unauthorized) return unauthorized;
    try {
        const dry = new URL(request.url).searchParams.get('dry') === '1';
        return await run(dry);
    } catch (error: any) {
        console.error('Lỗi type-d-pending-lock:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = GET;
