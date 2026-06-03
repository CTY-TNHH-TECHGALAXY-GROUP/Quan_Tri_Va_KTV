import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { techCode, amount, walletType = 'TUA' } = body;

        if (!techCode || !amount || isNaN(amount) || amount <= 0) {
            return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ. Số tiền phải lớn hơn 0.' }, { status: 400 });
        }

        const requestAmount = Number(amount);

        // 1. Chống Spam: Kiểm tra xem đã có lệnh PENDING nào chưa
        const { data: pendingRequests, error: pendingError } = await supabase
            .from('KTVWithdrawals')
            .select('id')
            .eq('staff_id', techCode)
            .eq('wallet_type', walletType)
            .eq('status', 'PENDING');

        if (pendingError) {
            console.error('Error checking pending requests:', pendingError);
            return NextResponse.json({ success: false, error: 'Lỗi kiểm tra hệ thống' }, { status: 500 });
        }

        if (pendingRequests && pendingRequests.length > 0) {
            return NextResponse.json({ 
                success: false, 
                error: 'Bạn đang có một lệnh rút tiền chờ duyệt. Vui lòng đợi lệnh đó hoàn tất trước khi tạo lệnh mới.' 
            }, { status: 400 });
        }

        if (walletType === 'TUA') {
            const { data: balanceResult, error: balanceError } = await supabase.rpc('get_ktv_wallet_balance', {
                p_staff_id: techCode
            });

            if (balanceError) {
                console.error('Error getting balance:', balanceError);
                return NextResponse.json({ success: false, error: 'Lỗi lấy thông tin số dư' }, { status: 500 });
            }

            const balanceData = typeof balanceResult === 'string' ? JSON.parse(balanceResult) : balanceResult;
            
            const effectiveBalance = Number(balanceData.effective_balance || 0);
            const minDeposit = Number(balanceData.min_deposit || 500000);

            // Validation Core Logic for TUA
            const remainingAfterWithdrawal = effectiveBalance - requestAmount;
            
            if (remainingAfterWithdrawal < minDeposit) {
                return NextResponse.json({ 
                    success: false, 
                    error: `Không thể rút. Số dư còn lại sau khi rút (${remainingAfterWithdrawal.toLocaleString()}đ) thấp hơn mức cọc tối thiểu yêu cầu (${minDeposit.toLocaleString()}đ).`
                }, { status: 400 });
            }
        }

        // 4. Tạo lệnh rút tiền
        const { data: insertData, error: insertError } = await supabase
            .from('KTVWithdrawals')
            .insert({
                staff_id: techCode,
                amount: requestAmount,
                wallet_type: walletType,
                status: 'PENDING'
            })
            .select()
            .single();

        if (insertError) {
            console.error('Error creating withdrawal request:', insertError);
            return NextResponse.json({ success: false, error: 'Không thể tạo lệnh rút tiền. Vui lòng thử lại.' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            data: insertData,
            message: 'Tạo lệnh rút tiền thành công. Vui lòng chờ kế toán duyệt.'
        });

    } catch (err: any) {
        console.error('Exception in /api/ktv/wallet/withdraw:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
