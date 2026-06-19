import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notification-helper';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { status, note, adminId, adminName } = body;

        if (!adminId) {
            return NextResponse.json({ success: false, error: 'Thiếu thông tin người xử lý (adminId)' }, { status: 401 });
        }

        if (status !== 'APPROVED' && status !== 'REJECTED') {
            return NextResponse.json({ success: false, error: 'Trạng thái không hợp lệ' }, { status: 400 });
        }

        // Đảm bảo chỉ update nếu trạng thái đang là PENDING (chống Race Condition)
        const { data, error } = await supabase
            .from('KTVWithdrawals')
            .update({
                status,
                note,
                processed_at: new Date().toISOString(),
                processed_by: adminName ? `${adminName} (${adminId})` : adminId
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

        const notificationMessage = status === 'APPROVED' 
            ? `Thủ quỹ đã xử lý xong yêu cầu rút tiền ${amountText} của bạn.`
            : `Yêu cầu rút tiền ${amountText} của bạn đã bị từ chối. Lý do: ${note || 'Không có'}`;

        await createNotification({
            employeeId: data.staff_id,
            type: 'WALLET',
            message: notificationMessage,
        });

        return NextResponse.json({ success: true, data });
    } catch (err: any) {
        console.error('Exception in /api/finance/withdrawals/[id]:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
