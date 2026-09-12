import { NextResponse } from 'next/server';
import { formatVnd } from '@/lib/format.logic';
import { createClient } from '@supabase/supabase-js';
import { KtvWalletWithdrawSchema } from '@/lib/schemas/ktv.schema';
import { KtvWalletService } from '@/lib/services/KtvWalletService';
import { KtvTypeDWalletService } from '@/lib/services/KtvTypeDWalletService';
import { WalletAccessService } from '@/lib/services/WalletAccessService';
import { WalletType } from '@/lib/featureFlags';
import { usesOfficeBonus } from '@/lib/services/KtvOfficeBonusService';

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

        // Ví đang tắt thì không được rút — trước đây cờ chỉ ẩn tab, gọi thẳng
        // API vẫn tạo được lệnh rút.
        const deniedWallet = await WalletAccessService.denyIfDisabled(
            supabase, techCode, (walletType === 'BONUS' ? 'BONUS' : 'TUA') as WalletType);
        if (deniedWallet) return deniedWallet;

        // Điểm Office là thang chất lượng, không phải số dư tích được — không có
        // tỉ giá điểm→tiền nào trong quy chế. Hệ quả tiền duy nhất của nó là mức
        // quỹ nội bộ còn phải đóng cuối tháng. Giao diện đã bỏ nút quy đổi, đây
        // là lớp chặn thật: ẩn nút không phải là chặn.
        if (walletType === 'BONUS' && await usesOfficeBonus(supabase, techCode)) {
            return NextResponse.json({
                success: false,
                error: 'Điểm Office không quy đổi ra tiền được. Điểm tháng chỉ quyết định mức quỹ nội bộ bạn phải đóng.',
                code: 'OFFICE_POINTS_NOT_REDEEMABLE',
            }, { status: 400 });
        }

        
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
            let balanceData: any;
            try {
                // ⚠️ Phải dùng ĐÚNG service theo chế độ. Trước đây chỗ này luôn gọi
                // KtvWalletService (bản A/B/C) kể cả với loại D, nên số dư và mức
                // cọc lấy ra đều sai cho loại D.
                balanceData = workType === 'TYPE_D'
                    ? await KtvTypeDWalletService.getBalance(supabase, techCode)
                    : await KtvWalletService.getBalance(supabase, techCode);
            } catch (err) {
                console.error('Error getting balance in withdraw:', err);
                return NextResponse.json({ success: false, error: 'Lỗi lấy thông tin số dư' }, { status: 500 });
            }

            // `available_balance` đã là max(0, số dư ròng − cọc tối thiểu), tức
            // đúng bằng số được phép rút mà KHÔNG chạm vào tiền cọc.
            // CẮT phần lẻ: KTV nhìn thấy "86.971đ" trên ví thì trần rút đúng
            // bằng đó. Không cắt thì hệ thống cho rút 86.971,719đ — số mà màn
            // hình chưa bao giờ hiện, và cũng không tiêu được.
            const availableBalance = Math.trunc(Number(balanceData.available_balance || 0));
            const minDeposit = Number(balanceData.min_deposit || 0);
            const netBalance = Number(balanceData.net_balance || 0);

            if (requestAmount > availableBalance) {
                const conLai = netBalance - requestAmount;
                return NextResponse.json({
                    success: false,
                    error: availableBalance <= 0
                        ? `Chưa thể rút tiền. Số dư ${formatVnd(netBalance)} chưa vượt mức cọc tối thiểu ${formatVnd(minDeposit)}.`
                        : `Chỉ được rút tối đa ${formatVnd(availableBalance)}. Rút ${formatVnd(requestAmount)} sẽ làm số dư còn ${formatVnd(conLai)}, thấp hơn mức cọc tối thiểu ${formatVnd(minDeposit)}.`,
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
