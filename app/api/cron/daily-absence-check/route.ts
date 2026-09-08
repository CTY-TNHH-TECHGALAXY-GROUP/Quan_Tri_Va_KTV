import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvTypeDDisciplineService } from '@/lib/services/KtvTypeDDisciplineService';
import { getBusinessToday, previousBusinessDate } from '@/lib/business-date';
import { createNotification } from '@/lib/notification-helper';
import { vnDate } from '@/lib/vn-time';

export const dynamic = 'force-dynamic';

/**
 * ================================================================
 * CHỐT SỔ KỶ LUẬT CUỐI NGÀY — LOẠI D
 * ================================================================
 * Ba tình huống, ba mức khác nhau (theo quy chế):
 *
 *   1. Không đăng ký gì (không OFF, không LÀM)  → KHOÁ TÀI KHOẢN
 *   2. Đăng ký LÀM rồi không đến, không báo gì  → −10 giờ
 *   3. Đăng ký LÀM, có báo vắng muộn            →  −5 giờ
 *   4. Đăng ký OFF                              → không sao
 *
 * ⚠️ Trước đây tình huống 2 bị KHOÁ TÀI KHOẢN thay vì trừ 10 giờ — nặng hơn
 * quy chế rất nhiều (khoá thì không đăng nhập được cho tới khi admin mở).
 *
 * ⚠️ Và cả cron này CHƯA BAO GIỜ CHẠY: nó chỉ export POST, trong khi Vercel
 * Cron gọi bằng GET → 405. Toàn bộ kỷ luật loại D là luật trên giấy.
 *
 * Chốt theo NGÀY LÀM VIỆC liền trước, không phải "hôm nay theo lịch": chạy
 * lúc 06:30 (sau cutoff 06:00) thì ngày làm việc hôm qua vừa đóng.
 */
/**
 * ================================================================
 * KHOÁ NGAY LÚC 00:00 — chưa đăng ký lịch cho ngày vừa sang
 * ================================================================
 * Nửa đêm là hạn chót quyết định lịch — cùng mốc với hạn đổi lịch miễn phạt
 * (được đổi thoải mái đến hết ngày hôm trước). Sang ngày mới mà chưa đăng ký
 * gì thì khoá luôn, không đợi hết ngày mới biết.
 *
 * ⚠️ Dùng NGÀY LỊCH VN, không phải ngày làm việc theo cutoff. Bảng
 * `KTVTypeDDailyRegistration.work_date` được ghi bằng `vnToday()` (ngày lịch),
 * nên tra bằng business date lúc 00:00 sẽ ra ngày HÔM TRƯỚC và khoá nhầm.
 */
async function runLockUnregistered() {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase admin not configured' }, { status: 500 });
    }

    // Ngày LỊCH VN vừa sang — khớp với cách `KTVTypeDDailyRegistration.work_date`
    // được ghi (vnToday()), không dùng business date.
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const enabled = await KtvTypeDDisciplineService.isEnabled(supabase);

    const { data: staffList } = await supabase
        .from('Staff')
        .select('id, full_name, created_at')
        .eq('work_type', 'TYPE_D')
        .neq('status', 'KHÓA_TÀI_KHOẢN');

    const ids = (staffList || []).map((s: any) => s.id);
    const { data: regs } = await supabase
        .from('KTVTypeDDailyRegistration')
        .select('staff_id').eq('work_date', today).in('staff_id', ids);
    const daDangKy = new Set((regs || []).map((r: any) => r.staff_id));

    const locked: string[] = [];
    for (const staff of staffList || []) {
        if (daDangKy.has(staff.id)) continue;
        // Bỏ qua KTV mới tạo hôm nay — chưa kịp làm quen.
        if (staff.created_at && String(staff.created_at).slice(0, 10) >= today) continue;

        locked.push(staff.full_name ? `${staff.full_name} (${staff.id})` : staff.id);
        if (!enabled) continue;

        const lyDo = `Chưa đăng ký lịch (đi làm hoặc OFF) cho ngày ${today}`;
        await supabase.from('SecurityAuditLogs').insert({
            employee_id: staff.id,
            employee_name: staff.full_name || staff.id,
            event_type: 'AUTO_LOCK_NO_REGISTRATION',
            ip_address: '127.0.0.1',
            user_agent: 'CRON',
            details: { source: 'CRON_MIDNIGHT', targetDate: today, reason: lyDo },
        });
        await supabase.from('Staff').update({ status: 'KHÓA_TÀI_KHOẢN' }).eq('id', staff.id);
        await KtvTypeDDisciplineService.markAccountLock(supabase, staff.id, today, lyDo);
        // Khoá tài khoản là tin CÁ NHÂN gửi chính chủ, không phải tin khẩn của quầy.
        // Để chung type EMERGENCY thì rule của nó (admin/reception/dev, cờ 🎯 tắt)
        // đẩy câu "Tài khoản của bạn đã bị khoá" cho Admin/Lễ tân đọc, còn KTV bị
        // khoá thì không hay biết gì.
        await createNotification({
            type: 'ACCOUNT_LOCK',
            message: `Tài khoản của bạn đã bị khóa do chưa đăng ký lịch (đi làm hoặc OFF) cho ngày ${today}.`,
            employeeId: staff.id,
        });
    }

    console.log(`[Kỷ luật D 00:00] ${locked.length} KTV chưa đăng ký ${today} (${enabled ? 'ĐÃ KHOÁ' : 'đang TẮT'})`);
    return NextResponse.json({
        success: true, mode: 'lock-unregistered', enabled,
        targetDate: today, lockedCount: locked.length, locked,
        note: enabled ? undefined : 'Kỷ luật đang TẮT — danh sách chỉ là dự kiến.',
    });
}

async function run() {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase admin not configured' }, { status: 500 });
    }

    const targetDate = previousBusinessDate(await getBusinessToday(supabase));

    // ⚠️ CÔNG TẮC AN TOÀN — mặc định TẮT.
    // Chạy thử trên dữ liệu thật cho thấy nếu bật ngay thì 9/12 KTV loại D bị
    // khoá tài khoản trong đêm đầu tiên, chỉ vì chưa ai có thói quen đăng ký
    // lịch hằng ngày (giai đoạn test). Luật đúng, nhưng áp lên dữ liệu hiện
    // tại thì quét sạch.
    //
    // Bật bằng cách đặt SystemConfigs.ktv_type_d_discipline_enabled = true,
    // SAU KHI KTV đã quen đăng ký. Không cần deploy lại.
    //
    // `?dry=1` để xem trước sẽ đụng vào ai mà không ghi gì.
    const enabled = await KtvTypeDDisciplineService.isEnabled(supabase);

    console.log(`[Kỷ luật D] Chốt sổ ngày làm việc ${targetDate} (${enabled ? 'ĐANG BẬT' : 'đang TẮT — chỉ ghi log'})`);

    const { data: staffList, error: staffError } = await supabase
        .from('Staff')
        .select('id, status, work_type, created_at, full_name')
        .eq('work_type', 'TYPE_D')
        .neq('status', 'KHÓA_TÀI_KHOẢN');

    if (staffError) throw staffError;

    const locked: string[] = [];
    const penalised: { staff: string; hours: number; ly_do: string }[] = [];
    let processed = 0;

    for (const staff of staffList || []) {
        // Bỏ qua KTV mới tạo trong chính ngày đang chốt.
        if (staff.created_at && String(staff.created_at).slice(0, 10) >= targetDate) continue;

        const [{ data: registration }, { data: attendance }] = await Promise.all([
            supabase.from('KTVTypeDDailyRegistration')
                .select('*').eq('staff_id', staff.id).eq('work_date', targetDate).maybeSingle(),
            supabase.from('KTVAttendance')
                .select('id').eq('employeeId', staff.id).eq('date', targetDate)
                .in('checkType', ['CHECK_IN', 'LATE_CHECKIN']).limit(1),
        ]);

        const daDiLam = !!(attendance && attendance.length > 0);
        processed++;

        // ── 1. KHÔNG ĐĂNG KÝ GÌ → khoá tài khoản ────────────────────
        if (!registration) {
            if (daDiLam) continue;   // quên đăng ký nhưng vẫn đến làm → bỏ qua

            const lyDo = 'Không đăng ký lịch và không điểm danh';
            locked.push(staff.full_name ? `${staff.full_name} (${staff.id})` : staff.id);
            if (!enabled) continue;

            await supabase.from('SecurityAuditLogs').insert({
                employee_id: staff.id,
                employee_name: staff.full_name || staff.id,
                event_type: 'AUTO_LOCK_ABSENCE',
                ip_address: '127.0.0.1',
                user_agent: 'CRON',
                details: { source: 'CRON', violationDate: targetDate, reason: lyDo },
            });
            await supabase.from('Staff').update({ status: 'KHÓA_TÀI_KHOẢN' }).eq('id', staff.id);
            await KtvTypeDDisciplineService.markAccountLock(supabase, staff.id, targetDate, lyDo);
            await createNotification({
                type: 'ACCOUNT_LOCK',
                message: `Tài khoản của bạn đã bị khóa do không đăng ký lịch và không đi làm ngày ${vnDate(targetDate)}.`,
                employeeId: staff.id,
            });
            continue;
        }

        // ── 4. ĐĂNG KÝ OFF → không sao ──────────────────────────────
        if (registration.status === 'OFF_REGISTERED') {
            if (enabled) {
                await supabase.from('KTVTypeDDailyRegistration')
                    .update({ status: 'COMPLETED' }).eq('id', registration.id);
            }
            continue;
        }

        // Có đến làm → xong, không phạt gì.
        if (daDiLam || registration.check_in_at) {
            if (enabled) {
                await supabase.from('KTVTypeDDailyRegistration')
                    .update({ status: 'COMPLETED' }).eq('id', registration.id);
            }
            continue;
        }

        // ── 2 & 3. ĐĂNG KÝ LÀM NHƯNG KHÔNG ĐẾN ──────────────────────
        // Có báo vắng đúng quy trình (trước 07:00) → −5h.
        // Không báo gì (REGISTERED lặn luôn, hoặc đã báo trễ rồi vẫn không đến) → KHÓA TÀI KHOẢN.
        // Theo quy chế mới (chốt 2026-09-03): đăng ký làm mà lặn nặng ngang không đăng ký gì.
        const coBaoVang = registration.status === 'ABSENT_REPORTED' && !!registration.absent_reported_at;

        if (coBaoVang) {
            if (registration.penalty_applied !== 'ABSENT_EARLY_NOTICE') {
                const lyDo = 'Đã báo vắng nhưng không đi làm';
                penalised.push({ staff: staff.id, hours: 5, ly_do: lyDo });
                if (!enabled) continue;

                const hours = await KtvTypeDDisciplineService.deductDailyViolation(
                    supabase, staff.id, targetDate, 'ABSENT_EARLY_NOTICE', `Chốt sổ cuối ngày: ${lyDo}`, 'CRON',
                );
                await supabase.from('KTVTypeDDailyRegistration')
                    .update({ penalty_applied: 'ABSENT_EARLY_NOTICE', status: 'COMPLETED' })
                    .eq('id', registration.id);
                await createNotification({
                    type: 'WARNING',
                    message: `Bạn bị trừ ${hours} giờ tích lũy ngày ${vnDate(targetDate)}. Lý do: ${lyDo}.`,
                    employeeId: staff.id,
                });
            }
            continue;
        }

        // Không báo gì → KHÓA TÀI KHOẢN
        const lyDoKhoa = registration.status === 'LATE_REPORTED'
            ? 'Đã báo trễ nhưng không đến làm'
            : 'Đăng ký làm nhưng không đến và không báo';
        locked.push(staff.full_name ? `${staff.full_name} (${staff.id})` : staff.id);
        if (!enabled) continue;

        await supabase.from('SecurityAuditLogs').insert({
            employee_id: staff.id,
            employee_name: staff.full_name || staff.id,
            event_type: 'AUTO_LOCK_ABSENCE',
            ip_address: '127.0.0.1',
            user_agent: 'CRON',
            details: { source: 'CRON', violationDate: targetDate, reason: lyDoKhoa },
        });
        await supabase.from('Staff').update({ status: 'KHÓA_TÀI_KHOẢN' }).eq('id', staff.id);
        await KtvTypeDDisciplineService.markAccountLock(supabase, staff.id, targetDate, lyDoKhoa);
        await supabase.from('KTVTypeDDailyRegistration')
            .update({ status: 'COMPLETED' }).eq('id', registration.id);
        await createNotification({
            type: 'ACCOUNT_LOCK',
            message: `Tài khoản của bạn đã bị khóa do ${lyDoKhoa.toLowerCase()} ngày ${vnDate(targetDate)}.`,
            employeeId: staff.id,
        });
    }

    if (locked.length > 0 && enabled) {
        // Bản tổng hợp này viết ở ngôi thứ ba và gửi cho quản lý, nên vẫn là EMERGENCY.
        await createNotification({
            type: 'EMERGENCY',
            message: `Hệ thống vừa khóa ${locked.length} KTV do không đăng ký lịch ngày ${vnDate(targetDate)}: ${locked.join(', ')}`,
            employeeId: null,
        });
    }

    console.log(`[Kỷ luật D] ${processed} KTV · ${penalised.length} bị trừ giờ · ${locked.length} bị khoá`);
    return NextResponse.json({
        success: true, enabled, targetDate, processed,
        penalised, lockedCount: locked.length, locked,
        note: enabled ? undefined : 'Kỷ luật đang TẮT — danh sách bên dưới chỉ là dự kiến, chưa ghi gì.',
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
        // ?mode=lock-unregistered → khoá ngay lúc 12h nếu chưa đăng ký ngày mai.
        // Không có tham số → chốt sổ cuối ngày (phạt trừ giờ).
        const mode = new URL(request.url).searchParams.get('mode');
        return mode === 'lock-unregistered' ? await runLockUnregistered() : await run();
    } catch (error: any) {
        console.error('Lỗi daily-absence-check:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = GET;
