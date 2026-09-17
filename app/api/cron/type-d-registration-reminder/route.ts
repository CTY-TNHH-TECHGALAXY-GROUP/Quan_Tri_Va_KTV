import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvTypeDDisciplineService } from '@/lib/services/KtvTypeDDisciplineService';
import { createNotification } from '@/lib/notification-helper';
import { vnDate } from '@/lib/vn-time';

export const dynamic = 'force-dynamic';

/**
 * ================================================================
 * NHẮC ĐĂNG KÝ LỊCH — LOẠI D (21:00 giờ VN)
 * ================================================================
 * 00:00 ai chưa có dòng đăng ký sẽ bị KHOÁ THẲNG (daily-absence-check). Khoá là
 * chế tài nặng nhất, nên 3 tiếng trước đó gửi một tin nhắc cho người còn thiếu:
 *
 *   · ngày mai — chưa đăng ký đi làm hoặc OFF
 *   · hôm nay  — thường là người vừa được quầy mở khoá mà chưa đăng ký bù
 *
 * Chỉ gửi khi CẢ HAI công tắc bật:
 *   · `ktv_type_d_registration_reminder` — Quản lý tính năng
 *   · `ktv_type_d_discipline_enabled`   — kỷ luật Loại D
 * Kỷ luật tắt thì không ai bị khoá, tin "sẽ bị khoá" là nói sai.
 *
 * ?dry=1 → chỉ liệt kê, không gửi.
 *
 * plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md §2.3
 */

/**
 * ⚠️ Tên khoá cố ý KHÔNG có chữ "enabled" — SessionEpochService coi `*_enabled`
 * + `type_d` là công tắc tính năng và đăng xuất cả nhóm Loại D mỗi lần lưu.
 */
const REMINDER_KEY = 'ktv_type_d_registration_reminder';

/** Ngày lịch VN hôm nay, 'YYYY-MM-DD'. */
function ngayVnHomNay(): string {
    return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function congMotNgay(ngay: string): string {
    return new Date(new Date(ngay + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
}

/** Thiếu khoá = TẮT. Giá trị có thể là boolean hoặc chuỗi tuỳ đời dữ liệu. */
async function isReminderOn(supabase: any): Promise<boolean> {
    const { data } = await supabase
        .from('SystemConfigs').select('value').eq('key', REMINDER_KEY).maybeSingle();
    const v = (data as any)?.value;
    if (typeof v === 'boolean') return v;
    return String(v ?? '').replace(/"/g, '').trim().toLowerCase() === 'true';
}

async function run(dry = false) {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase admin not configured' }, { status: 500 });
    }

    const [nhacBat, kyLuatBat] = await Promise.all([
        isReminderOn(supabase),
        KtvTypeDDisciplineService.isEnabled(supabase),
    ]);
    const send = !dry && nhacBat && kyLuatBat;

    const homNay = ngayVnHomNay();
    const ngayMai = congMotNgay(homNay);

    const { data: staffList, error: staffError } = await supabase
        .from('Staff')
        .select('id, full_name')
        .eq('work_type', 'TYPE_D');
    // Người vừa được mở khoá cũng cần lời nhắc đăng ký, nên không lọc theo status.
    if (staffError) throw staffError;

    const ids = (staffList || []).map((s: any) => s.id);
    const results: { staff: string; ten: string | null; thieu: string[] }[] = [];

    if (ids.length > 0) {
        const { data: regs, error: regError } = await supabase
            .from('KTVTypeDDailyRegistration')
            .select('staff_id, work_date')
            .in('work_date', [homNay, ngayMai])
            .in('staff_id', ids);
        if (regError) throw regError;

        const daDangKy = new Set((regs || []).map((r: any) => `${r.staff_id}|${r.work_date}`));

        for (const staff of staffList || []) {
            const thieu = [homNay, ngayMai].filter(d => !daDangKy.has(`${staff.id}|${d}`));
            if (thieu.length === 0) continue;

            results.push({ staff: staff.id, ten: staff.full_name, thieu });

            if (send) {
                await createNotification({
                    type: 'REGISTRATION_REMINDER',
                    message: `Bạn chưa đăng ký lịch (đi làm hoặc OFF) cho ngày ${thieu.map(vnDate).join(' và ')}. Đăng ký trước 00:00, nếu không tài khoản sẽ bị khoá.`,
                    employeeId: staff.id,
                });
            }
        }
    }

    console.log(`[Nhắc đăng ký D] ${results.length} KTV chưa đăng ký · ${send ? 'ĐÃ GỬI' : `không gửi (nhắc ${nhacBat ? 'bật' : 'tắt'}, kỷ luật ${kyLuatBat ? 'bật' : 'tắt'}${dry ? ', chạy thử' : ''})`}`);

    return NextResponse.json({
        success: true,
        dry,
        reminderOn: nhacBat,
        disciplineOn: kyLuatBat,
        sent: send ? results.length : 0,
        today: homNay,
        tomorrow: ngayMai,
        results,
        note: send ? undefined
            : dry ? 'CHẠY THỬ (dry=1) — chưa gửi tin nào.'
                : 'Công tắc nhắc hoặc kỷ luật Loại D đang TẮT — chưa gửi tin nào.',
    });
}

export async function GET(request: Request) {
    const authHeader = request.headers.get('Authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const dry = new URL(request.url).searchParams.get('dry') === '1';
        return await run(dry);
    } catch (error: any) {
        console.error('Lỗi type-d-registration-reminder:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = GET;
