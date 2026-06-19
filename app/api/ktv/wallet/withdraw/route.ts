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

        // 1. Chống Spam: Đã được yêu cầu tắt
        // KTV có thể gửi thông báo rút tiền nhiều lần dù cho lệnh cũ chưa được duyệt.

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
            
            // USER YÊU CẦU: Không chặn lệnh rút tiền, chỉ gửi thông báo.
            // if (remainingAfterWithdrawal < minDeposit) {
            //     return NextResponse.json({ 
            //         success: false, 
            //         error: `Không thể rút. Số dư còn lại sau khi rút (${remainingAfterWithdrawal.toLocaleString()}đ) thấp hơn mức cọc tối thiểu yêu cầu (${minDeposit.toLocaleString()}đ).`
            //     }, { status: 400 });
            // }
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
            message: 'Đã gửi thông báo rút tiền đến Quầy/Kế toán thành công.'
        });

    } catch (err: any) {
        console.error('Exception in /api/ktv/wallet/withdraw:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
