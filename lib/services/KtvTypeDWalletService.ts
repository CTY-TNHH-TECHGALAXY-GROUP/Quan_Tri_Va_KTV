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

/**
 * Số liệu ví loại D cho bảng thống kê phía quầy.
 *
 * Các cột `total_*` / `gross_income` / `previous_balance` tính THEO KỲ mà thu
 * ngân chọn; `net_balance` / `available_balance` luôn là ALL TIME — đúng bằng
 * con số KTV nhìn thấy trong ví của họ.
 */
export interface TypeDFinanceSummary {
    total_commission: number;
    total_tip: number;
    total_bonus: number;
    total_penalty: number;
    total_adjustment: number;
    total_withdrawn: number;
    total_pending: number;
    total_tax_deducted: number;
    gross_income: number;
    previous_balance: number;
    min_deposit: number;
    net_balance: number;
    available_balance: number;
    effective_balance: number;
    internal_fund: number;
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

    /**
     * ====================================================================
     * BẢN CHO PHÍA QUẦY — cùng nguồn, cùng công thức với `getBalance`
     * ====================================================================
     * Trang Thu Ngân KTV (`/finance/ktv`) cần đúng những con số KTV đang
     * nhìn thấy trong ví của họ, cộng thêm các cột "trong kỳ" theo khoảng
     * ngày mà quầy chọn.
     *
     * ⚠️ KHÔNG tính lại từ `Bookings`. `/api/finance/ktv-summary` quét lại
     * `Bookings` + `KtvCommissionService` — đúng cho loại A/B/C nhưng sai
     * cho loại D ở ba chỗ: không biết `rate_per_60m` / trừ sao / thuế TNCN;
     * `getAllConfigs` không có `TYPE_D` nên rơi về cọc của loại A; và không
     * lọc `work_type_snapshot` lẫn dòng tín hiệu "báo trước". Ở đây đọc
     * thẳng sổ cái tua như ví KTV nên hai phía luôn khớp (CLAUDE.md 4.2).
     *
     * Gọi MỘT LẦN cho cả danh sách loại D thay vì lặp `getBalance` từng
     * người — bảng quầy có hơn chục KTV loại D, gọi lẻ là hơn chục vòng
     * query giống hệt nhau.
     *
     * @param fromDate 'YYYY-MM-DD' theo NGÀY LÀM VIỆC. Bỏ trống = tất cả.
     * @param toDate   'YYYY-MM-DD' theo NGÀY LÀM VIỆC. Bỏ trống = tới nay.
     */
    static async getFinanceSummaries(
        supabase: SupabaseClient,
        staffIds: string[],
        fromDate?: string | null,
        toDate?: string | null
    ): Promise<Record<string, TypeDFinanceSummary>> {
        const out: Record<string, TypeDFinanceSummary> = {};
        if (!staffIds || staffIds.length === 0) return out;

        const GLOBAL_START_DATE_STR = '2026-05-04';
        const GLOBAL_START_DATE_ISO = '2026-05-04T00:00:00.000Z';
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

        /** Ngày lịch VN của một mốc timestamp — dùng cho điều chỉnh & lệnh rút. */
        const ngayVN = (ts: any): string =>
            new Date(new Date(ts).getTime() + VN_OFFSET_MS).toISOString().split('T')[0];

        const { data: configsData } = await supabase
            .from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
        const configs: Record<string, any> = {};
        (configsData || []).forEach((c: any) => { configs[c.key] = c.value; });
        const minDeposit = Number(configs['ktv_deposit_amount_TYPE_D']) || 1000000;

        const { getRows } = await import('./KtvDLedgerReader');

        const [allRows, adjRes, wdRes, internalRes] = await Promise.all([
            getRows(supabase, { staffIds, from: GLOBAL_START_DATE_STR, to: '2099-12-31' }),
            supabase.from('WalletAdjustments')
                .select('staff_id, amount, created_at')
                .in('staff_id', staffIds)
                .eq('work_type_snapshot', 'TYPE_D')
                .gte('created_at', GLOBAL_START_DATE_ISO),
            supabase.from('KTVWithdrawals')
                .select('staff_id, amount, status, note, intent_date, request_date')
                .in('staff_id', staffIds)
                .eq('work_type_snapshot', 'TYPE_D')
                .gte('request_date', GLOBAL_START_DATE_ISO),
            supabase.from('WalletAdjustments')
                .select('staff_id, amount')
                .in('staff_id', staffIds)
                .eq('wallet_type', 'BONUS'),
        ]);

        const emptyBucket = () => ({ take_home: 0, tip: 0, tax: 0, adj: 0, withdrawn: 0, pending: 0 });
        const buckets: Record<string, { all: any, period: any, prev: any }> = {};
        for (const id of staffIds) {
            buckets[id] = { all: emptyBucket(), period: emptyBucket(), prev: emptyBucket() };
        }

        /** Ô nào nhận dòng này: 'prev' (trước kỳ) hay 'period' (trong kỳ) hay null. */
        const oNao = (date: string): 'prev' | 'period' | null => {
            if (fromDate && date < fromDate) return 'prev';
            if ((!fromDate || date >= fromDate) && (!toDate || date <= toDate)) return 'period';
            return null;
        };

        // ⚠️ TUA CHƯA CÓ ĐÁNH GIÁ THÌ CHƯA TÍNH TIỀN — loại `is_provisional`
        // y hệt `getBalance`, nếu không quầy sẽ thấy số to hơn ví của KTV.
        for (const r of allRows) {
            if (r.is_provisional) continue;
            const b = buckets[r.staff_id];
            if (!b) continue;
            const takeHome = r.commission_net + r.bonus_amount - r.tax_amount;

            b.all.take_home += takeHome;
            b.all.tip += r.tip;
            b.all.tax += r.tax_amount;

            const o = oNao(r.work_date);   // sổ cái tua đã theo NGÀY LÀM VIỆC
            if (o) {
                b[o].take_home += takeHome;
                b[o].tip += r.tip;
                b[o].tax += r.tax_amount;
            }
        }

        for (const a of (adjRes.data || [])) {
            const b = buckets[a.staff_id];
            if (!b) continue;
            const amount = Number(a.amount);
            b.all.adj += amount;
            const o = oNao(ngayVN(a.created_at));
            if (o) b[o].adj += amount;
        }

        for (const w of (wdRes.data || [])) {
            const b = buckets[w.staff_id];
            if (!b || laDongTinHieu(w)) continue;      // bỏ dòng "báo trước"
            const amount = Math.abs(Number(w.amount));
            const o = oNao(ngayVN(w.request_date));

            if (w.status === 'APPROVED') {
                b.all.withdrawn += amount;
                if (o) b[o].withdrawn += amount;
            } else if (w.status === 'PENDING') {
                b.all.pending += amount;
                if (o) b[o].pending += amount;
            }
        }

        const internalFund: Record<string, number> = {};
        for (const r of (internalRes.data || [])) {
            internalFund[r.staff_id] = (internalFund[r.staff_id] || 0) + Number(r.amount);
        }

        for (const id of staffIds) {
            const { all, period, prev } = buckets[id];

            // Số dư thật = ALL TIME, giống hệt `getBalance`. Bộ lọc ngày của
            // quầy chỉ đổi các cột "trong kỳ", không được đổi số dư — nếu không
            // thu ngân chọn "Hôm nay" là thấy số dư tụt về gần 0.
            const at_gross = all.take_home + all.adj;
            const net_balance = at_gross - all.withdrawn - all.pending;

            out[id] = {
                total_commission: period.take_home,
                total_tip: period.tip,
                total_bonus: 0,        // thưởng 4★ đã nằm trong tiền tua
                total_penalty: 0,      // phạt tiền đi qua WalletAdjustments
                total_adjustment: period.adj,
                total_withdrawn: period.withdrawn,
                total_pending: period.pending,
                total_tax_deducted: period.tax,
                gross_income: period.take_home + period.adj,
                previous_balance: (prev.take_home + prev.adj) - prev.withdrawn,
                min_deposit: minDeposit,
                net_balance,
                available_balance: Math.max(0, net_balance - minDeposit),
                effective_balance: Math.max(0, net_balance),
                internal_fund: internalFund[id] || 0,
            };
        }

        return out;
    }
}
