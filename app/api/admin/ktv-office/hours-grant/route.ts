import { NextResponse } from 'next/server';
import { requireRole, requireBusinessUser, authErrorResponse } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';
import { vnDate } from '@/lib/vn-time';
import { getBusinessToday, shiftBusinessDate } from '@/lib/business-date';
import { fmtHours } from '@/lib/hours-format';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ktv-office/hours-grant — ADMIN / DEV cộng giờ tích luỹ cho KTV loại D.
 * Plan: plans/plan_cong_gio_tich_luy_thu_cong.md
 *
 * Ghi vào `KTVDPenaltyLedger` một dòng `penalty_type = 'HOURS_GRANT'` với `hours_penalty`
 * ÂM. Giờ ròng ở MỌI nơi (xếp hạng, thứ tự nhận tua, quỹ giờ xét khoá) đều đi qua
 * `netHoursByStaff` = Σ giờ làm − Σ hours_penalty, nên cộng giờ tự có hiệu lực mà
 * không sửa công thức, không thêm bảng.
 *
 * Cùng KTV + cùng ngày cộng nhiều lần → cộng dồn vào một dòng (unique
 * staff_id/work_date/penalty_type), note nối chuỗi — giống REACTIVATION_FEE ở route mở khoá.
 *
 * KHÔNG ĐƯỢC: cho số âm (trừ giờ đã có đường kỷ luật); ghi `money_penalty`; đụng ví/tiền tua.
 */

// 🔧 CONFIGURATION — phải khớp với AdminKtvHours.logic.ts
const PENALTY_TYPE = 'HOURS_GRANT';
const GRANT_STEP = 0.25;
const MAX_HOURS_PER_GRANT = 50;
const MAX_BACKDATE_DAYS = 60;
const MIN_REASON_LEN = 5;
const MAX_NOTE_LEN = 500;

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: Request) {
    try {
        await requireRole(['ADMIN', 'DEV']);
        const bUser = await requireBusinessUser();
        if (!bUser) return bad('Unauthorized', 401);

        const supabase = getSupabaseAdmin();
        if (!supabase) return bad('Supabase admin chưa được cấu hình', 500);

        const body = await request.json().catch(() => ({}));
        const staffId = String(body?.staffId || '').trim();
        const hours = Number(body?.hours);
        const workDate = String(body?.workDate || '').trim();
        const reason = String(body?.reason || '').trim();

        if (!staffId) return bad('Thiếu mã KTV');
        if (!Number.isFinite(hours) || hours <= 0) return bad('Số giờ phải lớn hơn 0');
        if (hours > MAX_HOURS_PER_GRANT) return bad(`Tối đa ${MAX_HOURS_PER_GRANT} giờ một lần`);
        if (Math.abs(hours / GRANT_STEP - Math.round(hours / GRANT_STEP)) > 1e-9) {
            return bad(`Số giờ phải theo bước ${GRANT_STEP} (15 phút)`);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return bad('Ngày áp dụng không hợp lệ');
        if (reason.length < MIN_REASON_LEN) return bad(`Lý do phải có ít nhất ${MIN_REASON_LEN} ký tự`);

        // Ngày áp dụng theo NGÀY LÀM VIỆC (mốc cắt sáng), không được là tương lai và
        // không lùi quá xa — quỹ giờ tính theo tháng nên ngày quyết định tháng được bù.
        const today = await getBusinessToday(supabase);
        const minDate = shiftBusinessDate(today, -MAX_BACKDATE_DAYS);
        if (workDate > today) return bad('Không cộng giờ cho ngày chưa tới');
        if (workDate < minDate) return bad(`Chỉ được lùi tối đa ${MAX_BACKDATE_DAYS} ngày (từ ${vnDate(minDate)})`);

        const { data: staff, error: staffErr } = await supabase
            .from('Staff')
            .select('id, full_name, work_type')
            .eq('id', staffId)
            .maybeSingle();
        if (staffErr) throw staffErr;
        if (!staff) return bad('Không tìm thấy KTV', 404);
        if (staff.work_type !== 'TYPE_D') return bad('Chỉ KTV loại D có sổ giờ tích luỹ');

        // Tên người thao tác để lịch sử hiện tên, không hiện mã.
        const { data: actor } = await supabase
            .from('Staff')
            .select('full_name')
            .eq('id', bUser.techCode || '')
            .maybeSingle();
        const actorName = actor?.full_name || bUser.username || 'Admin';

        // Cộng dồn trong ngày: hours_penalty ÂM, nên cộng giờ = trừ thêm vào số âm.
        const { data: existing } = await supabase
            .from('KTVDPenaltyLedger')
            .select('hours_penalty, note')
            .eq('staff_id', staffId)
            .eq('work_date', workDate)
            .eq('penalty_type', PENALTY_TYPE)
            .maybeSingle();

        const prevGranted = -Number(existing?.hours_penalty || 0);
        const totalGranted = Math.round((prevGranted + hours) * 100) / 100;
        const noteLine = `+${fmtHours(hours)} — ${actorName}: ${reason}`;
        const note = [existing?.note, noteLine].filter(Boolean).join('; ').slice(0, MAX_NOTE_LEN);

        const { error: upsertErr } = await supabase
            .from('KTVDPenaltyLedger')
            .upsert({
                staff_id: staffId,
                work_date: workDate,
                penalty_type: PENALTY_TYPE,
                hours_penalty: -totalGranted,
                money_penalty: 0,
                note,
                created_by: bUser.techCode || bUser.username || null,
            }, { onConflict: 'staff_id,work_date,penalty_type' });
        if (upsertErr) throw upsertErr;

        // Báo KTV ngay — họ thấy giờ tăng và biết vì sao.
        await createNotification({
            type: 'HOURS_GRANT',
            message: `Bạn được cộng ${fmtHours(hours)} giờ tích luỹ (ngày ${vnDate(workDate)}). Lý do: ${reason}.`,
            employeeId: staffId,
        }).catch(err => console.error('❌ [HoursGrant] Không gửi được thông báo:', err));

        // Nhật ký truy vết — hỏng cũng không được chặn nghiệp vụ đã ghi.
        try {
            await supabase.from('SecurityAuditLogs').insert({
                employee_id: staffId,
                employee_name: staff.full_name || staffId,
                event_type: 'HOURS_GRANT',
                ip_address: '127.0.0.1',
                user_agent: 'API',
                details: { workDate, hours, totalGrantedOnDate: totalGranted, reason, by: bUser.techCode, byName: actorName },
            });
        } catch (logErr) {
            console.error('❌ [HoursGrant] Không ghi được nhật ký:', logErr);
        }

        return NextResponse.json({
            success: true,
            message: `Đã cộng ${fmtHours(hours)} giờ cho ${staff.full_name || staffId} (ngày ${vnDate(workDate)}).`,
            staffId,
            workDate,
            hours,
            totalGrantedOnDate: totalGranted,
        });
    } catch (err: unknown) {
        const authRes = authErrorResponse(err);
        if (authRes) return authRes;
        console.error('❌ [HoursGrant] Lỗi:', err);
        return bad((err as any)?.message || 'Lỗi không xác định', 500);
    }
}
