import { NextResponse } from 'next/server';
import { requirePermission, requireBusinessUser, invalidateLockedStaffCache } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';
import { FEATURE_MAINTENANCE_MESSAGE } from '@/lib/constants/featureMaintenance.i18n';
import { findUnfinishedWorkToday } from '@/lib/unfinished-work';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/staff/lock — the "Hoạt động" switch on the Features table,
 * turned OFF.
 *
 * Writes the SAME state the Office "Mở khóa" button reads
 * (`Staff.status = 'KHÓA_TÀI_KHOẢN'`), so the two screens can never disagree:
 * switch ON here ⇔ no unlock button in Office. Turning it back ON goes through
 * the existing `POST /api/admin/staff/unlock` — there is deliberately no
 * second unlock path.
 *
 * `lock_source = 'MANUAL'` is written in the same UPDATE, so every KTV-facing
 * surface shows only "Tính năng của bạn đang bảo trì" for this lock, while
 * disciplinary locks keep their reason. A DB trigger clears it again whenever
 * status leaves the locked state (any writer, including unlock).
 *
 * NOT written: KTVDPenaltyLedger. A manual switch is not a violation.
 *
 * Permission: `system_settings` — the Features table lives on that page, and
 * unlike `staff_features` it is in MODULES, so admins on fallback permissions
 * are not locked out of their own switch.
 */
export async function POST(request: Request) {
    try {
        try {
            await requirePermission('system_settings');
        } catch {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

        const bUser = await requireBusinessUser();
        if (!bUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const staffId = String(body?.staffId || '').trim();
        const reason = String(body?.reason || '').trim();
        if (!staffId || !reason) {
            return NextResponse.json({ success: false, error: 'Thiếu mã nhân viên hoặc lý do' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin not configured' }, { status: 500 });
        }

        const { data: staff } = await supabase
            .from('Staff')
            .select('id, full_name, status')
            .eq('id', staffId)
            .maybeSingle();

        if (!staff) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy nhân viên' }, { status: 404 });
        }
        if (staff.status !== 'ĐANG LÀM') {
            return NextResponse.json({
                success: false,
                error: staff.status === 'KHÓA_TÀI_KHOẢN'
                    ? 'Tài khoản này đang bị khoá rồi'
                    : 'Chỉ tắt được tài khoản đang làm',
            }, { status: 400 });
        }

        // Refuse while the KTV still has work in flight TODAY. A locked KTV
        // cannot press "Hoàn tất" / hand over the room, which breaks the
        // commission flow for an order that is running or already dispatched.
        // The rule (today's business date, item still needs the KTV, not
        // swapped out) lives in findUnfinishedWorkToday — see why there.
        const busy = await findUnfinishedWorkToday(supabase, staffId);
        if (busy.length > 0) {
            // Bill codes, not ids: the counter must be able to find the order.
            const list = busy.map(b => `${b.billCode} — ${b.statusLabel}`).join('; ');
            return NextResponse.json({
                success: false,
                error: `KTV đang có đơn chưa xong hôm nay (${list}). Chờ xong đơn rồi hãy tắt.`,
                billCodes: Array.from(new Set(busy.map(b => b.billCode))),
            }, { status: 409 });
        }

        // Guarded on the previous status so two admins clicking at once cannot
        // both "win", and a status changed in between is not overwritten.
        const { data: updated, error: updateError } = await supabase
            .from('Staff')
            .update({ status: 'KHÓA_TÀI_KHOẢN', lock_source: 'MANUAL' })
            .eq('id', staffId)
            .eq('status', 'ĐANG LÀM')
            .select('id')
            .maybeSingle();

        if (updateError) {
            console.error('[StaffLock] update failed:', updateError);
            return NextResponse.json({ success: false, error: 'Không thể tắt tài khoản' }, { status: 500 });
        }
        if (!updated) {
            return NextResponse.json({ success: false, error: 'Trạng thái tài khoản vừa thay đổi, tải lại rồi thử lại' }, { status: 409 });
        }

        // Otherwise the API lock check keeps using its 20s cache.
        invalidateLockedStaffCache();

        const { data: actor } = await supabase
            .from('Staff').select('full_name').eq('id', bUser.techCode).maybeSingle();
        const actorName = (actor as any)?.full_name
            || (bUser.role ? `Quản lý (${bUser.role})` : null)
            || bUser.techCode
            || 'Không rõ';

        await supabase.from('SecurityAuditLogs').insert({
            employee_id: staff.id,
            employee_name: staff.full_name || staff.id,
            event_type: 'MANUAL_LOCK',
            ip_address: '127.0.0.1',
            user_agent: 'API',
            details: {
                locked_by: actorName,
                locked_by_id: bUser.businessUserId,
                reason,
                source: 'FEATURES_TABLE',
            },
        });

        // Personal notice to the KTV — the maintenance sentence only; the admin's
        // reason stays in the audit log.
        await createNotification({
            type: 'ACCOUNT_LOCK',
            message: FEATURE_MAINTENANCE_MESSAGE,
            employeeId: staff.id,
        });

        return NextResponse.json({ success: true, message: 'Đã tắt hoạt động tài khoản' });
    } catch (error: any) {
        console.error('[StaffLock] unexpected error:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Lỗi không xác định' }, { status: 500 });
    }
}
