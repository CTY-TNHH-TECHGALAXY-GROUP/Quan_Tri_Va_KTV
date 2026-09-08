import { SupabaseClient } from '@supabase/supabase-js';
import { KtvTypeDCommissionService } from './KtvTypeDCommissionService';

/**
 * Dòng KHÔNG phải lệnh rút tiền thật:
 *  · `intent_date` khác null — tín hiệu "báo trước lúc điểm danh"
 *  · amount = 1 kèm ghi chú "Báo trước" — dòng cũ chưa gắn intent_date
 *  · amount = 1 kèm ghi chú "Bảo trì"   — dòng kỹ thuật
 */
function laDongTinHieu(w: any): boolean {
    if (w.intent_date) return true;
    if (Math.abs(Number(w.amount)) !== 1) return false;
    const note = String(w.note || '');
    return note.includes('Báo trước') || note.includes('Bảo trì');
}

export class KtvTypeDWalletService {
    static async getBalance(supabase: SupabaseClient, staffId: string) {
        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        
        const { data: configsData } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
        const configs: Record<string, any> = {};
        (configsData || []).forEach((c: any) => { configs[c.key] = c.value; });

        const taxEffectiveDate = configs['ktv_type_d_tax_effective_from'] || '2099-01-01';
        let total_tax_deducted = 0;

        const rateVIP = Number(configs['ktv_type_d_vip_rate_per_60m']) || 180000;
        const ratePT = Number(configs['ktv_type_d_pt_rate_per_60m']) || 100000;
        
        let ratingDeductions = { "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 };
        try {
            if (configs['ktv_type_d_rating_deduction']) {
                ratingDeductions = typeof configs['ktv_type_d_rating_deduction'] === 'string' 
                    ? JSON.parse(configs['ktv_type_d_rating_deduction']) 
                    : configs['ktv_type_d_rating_deduction'];
            }
        } catch (e) {}

        const enableBonus = configs['enable_ktv_bonus_TYPE_D'] === true || configs['enable_ktv_bonus_TYPE_D'] === 'true';
        const minDeposit = Number(configs['ktv_deposit_amount_TYPE_D']) || 1000000;

        const nowVnDate = new Date(Date.now() + VN_OFFSET_MS);
        const todayStr = nowVnDate.toISOString().split('T')[0];

        // Sổ cái ngày chỉ còn dùng để lấy TIỀN PHẠT.
        //
        // ⚠️ Trước đây chỗ này còn quy `total_bonus` (điểm) ra tiền rồi trừ 10%
        // thuế riêng, đổ vào ví bonus. Nay thưởng 4★ nằm THẲNG trong tiền tua
        // (KtvDLedgerEngine.applyBonusAndTax) — đọc lại ở đây là trả hai lần.
        const { data: ledgers } = await supabase
            .from('KTVDailyLedger')
            .select('date, total_penalty')
            .eq('staff_id', staffId)
            .eq('work_type_snapshot', 'TYPE_D')
            .gte('date', GLOBAL_START_DATE_STR);

        const ledgerSummary = { penalty: 0 };
        (ledgers || [])
            .filter((l: any) => l.date < todayStr)
            .forEach((l: any) => { ledgerSummary.penalty += Number(l.total_penalty || 0); });

        const { data: adjustments } = await supabase
            .from('WalletAdjustments')
            .select('amount')
            .eq('staff_id', staffId)
            .eq('work_type_snapshot', 'TYPE_D')
            .gte('created_at', GLOBAL_START_DATE_ISO);
        const total_adjustment = (adjustments || []).reduce((sum: number, a: any) => sum + Number(a.amount), 0);

        // ⚠️ Loại DÒNG TÍN HIỆU "báo trước lúc điểm danh" (amount = 1) khỏi số dư.
        // Nó chỉ để báo Thu ngân chuẩn bị tiền mặt, không phải lệnh rút thật —
        // trước đây mỗi dòng như vậy trừ oan 1đ, và có ngày KTV tích tới 3 lần.
        const { data: withdrawals } = await supabase
            .from('KTVWithdrawals')
            .select('amount, status, note, intent_date')
            .eq('staff_id', staffId)
            .eq('work_type_snapshot', 'TYPE_D')
            .gte('request_date', GLOBAL_START_DATE_ISO);
            
        const total_withdrawn = (withdrawals || [])
            .filter((w: any) => w.status === 'APPROVED' && !laDongTinHieu(w))
            .reduce((sum: number, w: any) => sum + Math.abs(Number(w.amount)), 0);
            
        const total_pending = (withdrawals || [])
            .filter((w: any) => w.status === 'PENDING' && !laDongTinHieu(w))
            .reduce((sum: number, w: any) => sum + Math.abs(Number(w.amount)), 0);

        // ─── TIỀN TUA · TIP · THUẾ: đọc từ sổ cái ──────────────────────────
        // Cùng nguồn với màn hình lịch sử, nên KTV cộng tay các dòng lịch sử
        // luôn ra đúng số trong ví. Sổ cái lưu KHÔNG làm tròn.
        const { getRows, sumByStaff } = await import('./KtvDLedgerReader');
        const allTurnRows = await getRows(supabase, {
            staffIds: [staffId],
            from: GLOBAL_START_DATE_STR,
            to: '2099-12-31',
        });

        // ⚠️ TUA CHƯA CÓ ĐÁNH GIÁ THÌ CHƯA TÍNH TIỀN.
        // Quy chế: không có cơ sở tính tiền tua mà khách bỏ về không đánh giá.
        // Đường thoát: khách lười chấm thì lễ tân bấm "đã đánh giá" hoặc kéo
        // sang cột hoàn tất trên bảng điều phối — item về DONE là hết tạm tính.
        //
        // Trước đây ví cộng cả tiền tạm tính trong khi lịch sử thì ẩn đi, nên
        // hai màn hình nói hai chuyện khác nhau. Giờ cả hai cùng loại.
        const emptyTotals = { commission_net: 0, tax_amount: 0, take_home: 0, tip: 0, hours: 0, turns: 0 };
        const turnRows = allTurnRows.filter(r => !r.is_provisional);
        const provisionalRows = allTurnRows.filter(r => r.is_provisional);

        const turnTotals = sumByStaff(turnRows)[staffId] || emptyTotals;
        const provisionalTotals = sumByStaff(provisionalRows)[staffId] || emptyTotals;

        total_tax_deducted += turnTotals.tax_amount;

        const total_commission = turnTotals.take_home;   // = tua + thưởng 4★ − thuế
        const total_tip = turnTotals.tip;
        // Thưởng 4★ nay nằm trong `turnTotals.take_home` (cột bonus_amount của
        // sổ cái tua), không còn là ví riêng. Giữ trường này để giao diện cũ
        // không vỡ, nhưng nó luôn bằng 0 với loại D.
        const total_bonus = 0;
        const total_penalty = 0; 

        const gross_income = total_commission + total_adjustment;
        const net_balance = gross_income - total_withdrawn - total_pending;
        const available_balance = Math.max(0, net_balance - minDeposit);
        const effective_balance = Math.max(0, net_balance);

        return {
            total_commission,
            total_tip,
            total_bonus,
            total_penalty,
            total_adjustment,
            total_tax_deducted,
            total_withdrawn,
            total_pending,
            gross_income,
            min_deposit: minDeposit,
            net_balance,
            available_balance,
            effective_balance,
            bonus_wallet_total: total_bonus,
            bonus_wallet_enabled: enableBonus,
            // Tiền của các tua chưa có đánh giá — CHƯA cộng vào số dư.
            // Hiện riêng để KTV biết còn bao nhiêu đang chờ khách chấm sao.
            pending_review_amount: provisionalTotals.take_home,
            pending_review_turns: provisionalTotals.turns
        };
    }


}
