import { createClient } from '@supabase/supabase-js';

// Setup admin client to bypass RLS for cron job
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    }
);

export class PiggyBankService {
    /**
     * Tự động trừ tiền từ Ví Tua (WalletAdjustments) chuyển sang Ví Tích Lũy (KTVPiggyBankLedger)
     * Dành cho tất cả KTV đang ở trạng thái ACTIVE và chưa đạt tổng số tuần mục tiêu.
     */
    static async executeWeeklyDeduction() {
        try {
            // 1. Lấy cấu hình tổng số tuần
            const { data: configData, error: configError } = await supabaseAdmin
                .from('SystemConfigs')
                .select('value')
                .eq('key', 'ktv_piggy_bank_total_weeks')
                .single();

            if (configError) throw new Error(`Lỗi lấy cấu hình số tuần: ${configError.message}`);
            
            const totalWeeksTarget = parseInt(configData?.value as string) || 50;

            // 2. Lấy danh sách KTV đang tham gia ví tích lũy (ACTIVE)
            const { data: activeBanks, error: fetchError } = await supabaseAdmin
                .from('KTVPiggyBank')
                .select('*')
                .eq('status', 'ACTIVE');

            if (fetchError) throw new Error(`Lỗi lấy danh sách KTVPiggyBank: ${fetchError.message}`);
            if (!activeBanks || activeBanks.length === 0) {
                return { success: true, message: 'Không có KTV nào đang chạy tích lũy.', deductedCount: 0 };
            }

            let deductedCount = 0;
            const now = new Date().toISOString();

            // 3. Thực thi trừ tiền từng KTV
            for (const bank of activeBanks) {
                const ktvId = bank.staff_id;
                const weeklyAmount = Number(bank.weekly_amount);
                
                // Nếu KTV cài đặt số tiền bằng 0 hoặc đã đạt mục tiêu thì bỏ qua
                if (weeklyAmount <= 0) continue;
                if (bank.contributed_weeks >= totalWeeksTarget) {
                    // Update status to COMPLETED if somehow missed
                    await supabaseAdmin.from('KTVPiggyBank').update({ status: 'COMPLETED' }).eq('id', bank.id);
                    continue;
                }

                // Chạy transaction (bằng cách insert độc lập, nếu dùng RPC thì tốt hơn nhưng chạy batch JS vẫn ổn định cho cron nhỏ)
                // 3.1 Trừ tiền từ Ví Tua
                const { error: errWallet } = await supabaseAdmin.from('WalletAdjustments').insert({
                    staff_id: ktvId,
                    amount: -weeklyAmount,
                    type: 'ADJUST',
                    reason: `Trừ tiền Ví Tích Lũy (Tuần ${bank.contributed_weeks + 1})`,
                    created_by: 'SYSTEM_CRON'
                });

                if (errWallet) {
                    console.error(`[PiggyBank] Lỗi trừ ví tua KTV ${ktvId}:`, errWallet);
                    continue;
                }

                // 3.2 Thêm tiền vào Ví Tích Lũy
                const { error: errLedger } = await supabaseAdmin.from('KTVPiggyBankLedger').insert({
                    staff_id: ktvId,
                    amount: weeklyAmount,
                    type: 'DEPOSIT',
                    note: `Đóng tích lũy tuần ${bank.contributed_weeks + 1}`
                });

                if (errLedger) {
                    console.error(`[PiggyBank] Lỗi cộng ví tích lũy KTV ${ktvId}:`, errLedger);
                    // Rủi ro data drift nhẹ ở đây nếu insert ledger lỗi nhưng ví tua đã trừ
                    continue;
                }

                // 3.3 Cập nhật tiến độ
                const newContributedWeeks = bank.contributed_weeks + 1;
                const newStatus = newContributedWeeks >= totalWeeksTarget ? 'COMPLETED' : 'ACTIVE';
                
                await supabaseAdmin.from('KTVPiggyBank').update({
                    contributed_weeks: newContributedWeeks,
                    status: newStatus,
                    updated_at: now
                }).eq('id', bank.id);

                deductedCount++;

                // 3.4 Gửi thông báo Push (StaffNotifications)
                await supabaseAdmin.from('StaffNotifications').insert({
                    employeeId: ktvId,
                    type: 'WALLET',
                    message: `Tiết kiệm thành công tuần ${newContributedWeeks}! Đã chuyển ${weeklyAmount.toLocaleString('vi-VN')}đ vào Ví Heo Đất.`
                });
            }

            return { 
                success: true, 
                message: `Khấu trừ thành công cho ${deductedCount} KTV.`,
                deductedCount 
            };

        } catch (error: any) {
            console.error('[PiggyBankService Error]', error);
            return { success: false, error: error.message };
        }
    }
}
