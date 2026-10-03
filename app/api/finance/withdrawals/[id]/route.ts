import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notification-helper';
import { WithdrawalPatchSchema } from '@/lib/schemas/finance.schema';
import { requirePermission, requireBusinessUser, authErrorResponse } from '@/lib/auth-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // Chỉ người có quyền tài chính mới duyệt/từ chối lệnh rút tiền.
        await requirePermission('finance_management');
        const actor = await requireBusinessUser();

        const { id } = await params;
        const body = await request.json();
        const parseResult = WithdrawalPatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }

        const { status, note, adminId, adminName } = parseResult.data;

        // Người xử lý lấy từ SESSION, không tin adminId/adminName trong body.
        // Chưa có session (cờ AUTH_ENFORCE_API tắt) thì mới rơi về body như cũ.
        const processedBy = actor
            ? `${actor.username || actor.businessUserId} (${actor.businessUserId})`
            : (adminName ? `${adminName} (${adminId})` : adminId);

        // Đảm bảo chỉ update nếu trạng thái đang là PENDING (chống Race Condition)
        const { data, error } = await supabase
            .from('KTVWithdrawals')
            .update({
                status,
                note,
                processed_at: new Date().toISOString(),
                processed_by: processedBy
            })
            .eq('id', id)
            .eq('status', 'PENDING') // Quan trọng: Ngăn chặn duyệt đúp
            .select()
            .single();

        if (error || !data) {
            console.error('Error updating withdrawal:', error);
            return NextResponse.json({ 
                success: false, 
                error: 'Không thể cập nhật. Có thể yêu cầu này đã được xử lý bởi người khác.' 
            }, { status: 400 });
        }

        // Tùy chọn: Thêm Notification cho KTV
        let amountText = '';
        if (data.amount === -1 || data.amount === 0 || data.amount === 1) {
            amountText = 'đầu ngày';
        } else {
            amountText = `${data.amount.toLocaleString()}đ`;
        }

        let notificationMessage = '';
        if (status === 'APPROVED') {
            notificationMessage = `Thủ quỹ đã xử lý xong yêu cầu rút tiền ${amountText} của bạn.`;
        } else if (amountText === 'đầu ngày') {
            notificationMessage = `Yêu cầu rút tiền đầu ngày của bạn đã được xử lý. Ghi chú: ${note || 'Không có'}`;
        } else {
            notificationMessage = `Yêu cầu rút tiền ${amountText} của bạn đã bị từ chối. Lý do: ${note || 'Không có'}`;
        }

        await createNotification({
            employeeId: data.staff_id,
            type: 'WALLET',
            message: notificationMessage,
        });

        return NextResponse.json({ success: true, data });
    } catch (err: any) {
        const authRes = authErrorResponse(err);
        if (authRes) return authRes;
        console.error('Exception in /api/finance/withdrawals/[id]:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
