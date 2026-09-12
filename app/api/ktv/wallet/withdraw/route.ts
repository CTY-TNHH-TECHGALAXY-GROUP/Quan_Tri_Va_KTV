import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvWalletWithdrawSchema } from '@/lib/schemas/ktv.schema';
import { KtvWalletService } from '@/lib/services/KtvWalletService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const parseResult = KtvWalletWithdrawSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const { techCode, amount, walletType } = parseResult.data;

        
        const requestAmount = Number(amount);

        const { data: staffData } = await supabase.from('Staff').select('work_type').eq('id', techCode).single();
        const workType = staffData?.work_type || 'TYPE_A';

        if (workType === 'TYPE_D') {
            const { data: configRows } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
            const configs: Record<string, string> = {};
            (configRows || []).forEach(c => { configs[c.key] = c.value; });
            if (configs['ktv_type_d_withdraw_morning_only'] === 'true') {
                const vnOffset = 7 * 60 * 60 * 1000;
                const vnNow = new Date(Date.now() + vnOffset);
                if (vnNow.getUTCHours() >= 12) {
                    return NextResponse.json({ success: false, error: 'Chế độ Cố định theo ca chỉ được phép rút tiền trước 12:00 trưa.' }, { status: 400 });
                }
            }
        }


        // 1. Chống Spam: Đã được yêu cầu tắt
        // KTV có thể gửi thông báo rút tiền nhiều lần dù cho lệnh cũ chưa được duyệt.

        if (walletType === 'TUA') {
            let balanceData;
            try {
                balanceData = await KtvWalletService.getBalance(supabase, techCode);
            } catch (err) {
                console.error('Error getting balance in withdraw:', err);
                return NextResponse.json({ success: false, error: 'Lỗi lấy thông tin số dư' }, { status: 500 });
            }
            
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
                status: 'PENDING',
                work_type_snapshot: workType
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
