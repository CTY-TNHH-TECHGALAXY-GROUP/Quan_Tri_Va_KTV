import { NextResponse } from 'next/server';
import { requirePermission, requireBusinessUser } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';

export const dynamic = 'force-dynamic';

/** Mức phí kích hoạt lại đang cấu hình. Cần gạt tắt = không thu. */
async function readReactivationFee(supabase: any) {
    const { data } = await supabase.from('SystemConfigs').select('key, value')
        .in('key', ['ktv_type_d_reactivation_fee', 'ktv_type_d_reactivation_fee_enabled']);
    let amount = 1_000_000;
    let enabled = false;
    (data || []).forEach((c: any) => {
        if (c.key === 'ktv_type_d_reactivation_fee') {
            const n = Number(c.value);
            if (Number.isFinite(n) && n >= 0) amount = n;
        }
        if (c.key === 'ktv_type_d_reactivation_fee_enabled') {
            enabled = c.value === true || c.value === 'true';
        }
    });
    return { amount, enabled };
}

/**
 * Thông tin cần cho hộp thoại mở khoá: KTV bị khoá vì gì, và phải thu bao nhiêu.
 *
 * Lý do lấy từ dấu mốc ACCOUNT_LOCK trong sổ phạt loại D; đơn cũ hoặc KTV không
 * phải loại D thì lùi về nhật ký bảo mật (mọi lần khoá đều ghi ở đó).
 */
export async function GET(request: Request) {
    try {
        try {
            await requirePermission('dashboard');
        } catch {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const staffId = new URL(request.url).searchParams.get('staffId');
        if (!staffId) return NextResponse.json({ error: 'Thiếu staffId' }, { status: 400 });

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase admin not configured' }, { status: 500 });

        const [{ data: staff }, { data: lockRow }, { data: audit }, fee] = await Promise.all([
            supabase.from('Staff').select('id, full_name, status, work_type').eq('id', staffId).maybeSingle(),
            supabase.from('KTVDPenaltyLedger')
                .select('work_date, note').eq('staff_id', staffId).eq('penalty_type', 'ACCOUNT_LOCK')
                .order('work_date', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('SecurityAuditLogs')
                .select('event_type, created_at, details').eq('employee_id', staffId)
                .in('event_type', ['AUTO_LOCK_ABSENCE', 'AUTO_LOCK_REJECT_NO_HOURS'])
                .order('created_at', { ascending: false }).limit(1).maybeSingle(),
            readReactivationFee(supabase),
        ]);

        if (!staff) return NextResponse.json({ error: 'Không tìm thấy nhân viên' }, { status: 404 });

        const isTypeD = (staff as any).work_type === 'TYPE_D';
        return NextResponse.json({
            success: true,
            data: {
                staffId: (staff as any).id,
                name: (staff as any).full_name || (staff as any).id,
                locked: (staff as any).status === 'KHÓA_TÀI_KHOẢN',
                lockReason: (lockRow as any)?.note || (audit as any)?.details?.reason || null,
                lockDate: (lockRow as any)?.work_date || (audit as any)?.created_at || null,
                // Phí chỉ áp cho loại D — sổ ghi phí là sổ phạt của loại D.
                feeEnabled: fee.enabled && isTypeD,
                feeMin: fee.amount,
            },
        });
    } catch (error: any) {
        console.error('Lỗi lấy thông tin mở khoá:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
  try {
    // 1. Kiểm tra quyền Admin (cần quyền dashboard)
    // ⚠️ requirePermission trả về true khi hợp lệ và THROW khi không đủ quyền —
    // không phải trả về Response lỗi. Bắt bằng try/catch, giống app/api/reception/guest-arrival.
    try {
      await requirePermission('dashboard');
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const bUser = await requireBusinessUser();
    if (!bUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { staffId, reason, reactivationFee } = body;

    if (!staffId || !reason) {
      return NextResponse.json({ error: 'Thiếu staffId hoặc lý do (reason)' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase admin not configured' }, { status: 500 });
    }

    // 2. Kiểm tra xem staff có tồn tại và đang bị khóa không
    const { data: staff, error: staffError } = await supabase
      .from('Staff')
      .select('id, full_name, status, work_type')
      .eq('id', staffId)
      .single();

    if (staffError || !staff) {
      return NextResponse.json({ error: 'Không tìm thấy nhân viên' }, { status: 404 });
    }

    if (staff.status !== 'KHÓA_TÀI_KHOẢN') {
      return NextResponse.json({ error: 'Nhân viên này không bị khóa tài khoản' }, { status: 400 });
    }

    // 2a. Ai bấm mở khoá. bUser.techCode có thể là UUID (tài khoản quản lý không
    // gắn mã nhân viên) — tra tên thật để nhật ký đọc được, giống cách route
    // chấm điểm Office đang làm. Không có tên thì lùi về vai trò rồi tới mã.
    const { data: actor } = await supabase
      .from('Staff').select('full_name').eq('id', bUser.techCode).maybeSingle();
    const actorName = (actor as any)?.full_name
      || (bUser.role ? `Quản lý (${bUser.role})` : null)
      || bUser.techCode
      || 'Không rõ';

    // 2b. Phí kích hoạt lại — mức trong cài đặt là SÀN, quản lý được thu cao hơn
    // chứ không được thấp hơn. Chặn ở server chứ không chỉ ở ô nhập, vì đây là
    // tiền và request có thể gửi thẳng.
    const fee = await readReactivationFee(supabase);
    const chargeFee = fee.enabled && (staff as any).work_type === 'TYPE_D';
    let feeCharged = 0;

    if (chargeFee) {
      feeCharged = Number(reactivationFee);
      if (!Number.isFinite(feeCharged)) feeCharged = fee.amount;
      if (feeCharged < fee.amount) {
        return NextResponse.json({
          error: `Phí kích hoạt lại tối thiểu là ${fee.amount.toLocaleString('vi-VN')}đ`,
        }, { status: 400 });
      }
    }

    // 3. Mở khóa (Set trạng thái về ĐANG LÀM)
    const { error: updateError } = await supabase
      .from('Staff')
      .update({ status: 'ĐANG LÀM' })
      .eq('id', staffId);

    if (updateError) {
      console.error('Lỗi khi mở khóa tài khoản:', updateError);
      return NextResponse.json({ error: 'Không thể mở khóa tài khoản' }, { status: 500 });
    }

    // 3b. Ghi khoản phí vào sổ phạt loại D (cột tiền, KHÔNG đụng cột giờ nên
    // không ảnh hưởng thứ tự nhận tua). Khoá idempotency là
    // (staff_id, work_date, penalty_type) nên mở khoá hai lần trong cùng ngày
    // phải cộng dồn, không ghi đè.
    if (chargeFee && feeCharged > 0) {
      const { getBusinessToday } = await import('@/lib/business-date');
      const workDate = await getBusinessToday(supabase);

      const { data: existing } = await supabase.from('KTVDPenaltyLedger')
        .select('money_penalty, note')
        .eq('staff_id', staffId).eq('work_date', workDate).eq('penalty_type', 'REACTIVATION_FEE')
        .maybeSingle();

      const total = Number((existing as any)?.money_penalty || 0) + feeCharged;
      const note = [(existing as any)?.note, `${feeCharged.toLocaleString('vi-VN')}đ — ${actorName} mở khoá: ${reason}`]
        .filter(Boolean).join('; ');

      const { error: feeErr } = await supabase.from('KTVDPenaltyLedger').upsert({
        staff_id: staffId,
        work_date: workDate,
        penalty_type: 'REACTIVATION_FEE',
        hours_penalty: 0,
        money_penalty: total,
        note: `Phí kích hoạt lại: ${note}`.slice(0, 500),
        created_by: bUser.techCode || null,
      }, { onConflict: 'staff_id,work_date,penalty_type' });

      if (feeErr) console.error('[Unlock] Không ghi được phí kích hoạt lại:', feeErr);
    }

    // Xoá bộ nhớ đệm danh sách khoá, nếu không người vừa được mở vẫn bị chặn
    // thêm tối đa 20 giây nữa.
    const { invalidateLockedStaffCache } = await import('@/lib/auth-server');
    invalidateLockedStaffCache();

    // 4. Ghi Audit Log
    await supabase.from('SecurityAuditLogs').insert({
      employee_id: staff.id,
      employee_name: staff.full_name || staff.id,
      event_type: 'MANUAL_UNLOCK',
      ip_address: '127.0.0.1',
      user_agent: 'API',
      details: { 
        unlocked_by: actorName,
        unlocked_by_id: bUser.businessUserId,
        reason: reason,
        reactivation_fee: feeCharged
      }
    });

    // 5. Gửi thông báo cho KTV
    // Tin cá nhân gửi chính chủ — không dùng EMERGENCY (tin khẩn của quầy).
    await createNotification({
      type: 'MANUAL_UNLOCK',
      message: feeCharged > 0
        ? `Tài khoản của bạn đã được mở khóa. Phí kích hoạt lại: ${feeCharged.toLocaleString('vi-VN')}đ. Lý do: ${reason}`
        : `Tài khoản của bạn đã được mở khóa. Lý do: ${reason}`,
      employeeId: staff.id
    });

    return NextResponse.json({
      success: true,
      feeCharged,
      message: 'Đã mở khóa tài khoản thành công',
    });

  } catch (error: any) {
    console.error('Error in manual staff unlock:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
