import { SupabaseClient } from '@supabase/supabase-js';
import { readConfigBool } from '@/lib/featureFlags';

export async function processMonthlyLedgerSync(supabase: SupabaseClient, month: number, year: number) {
    console.log(`[Cron] Syncing Monthly Ledger for ${month}/${year}`);

    // Fetch all daily ledgers for the given month and year
    // targetDate is like '2026-07-31'
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = `${year}-${String(month).padStart(2, '0')}-31`; // Supabase handles invalid dates safely in string comparisons

    const { data: dailyLedgers, error } = await supabase
        .from('KTVDailyLedger')
        .select('*')
        .gte('date', startOfMonth)
        .lte('date', endOfMonth);

    if (error) {
        console.error('Error fetching daily ledgers for monthly sync:', error);
        return false;
    }

    if (!dailyLedgers || dailyLedgers.length === 0) return true;

    const monthlyMap = new Map<string, any>();

    for (const row of dailyLedgers) {
        if (!monthlyMap.has(row.staff_id)) {
            monthlyMap.set(row.staff_id, {
                staff_id: row.staff_id,
                month,
                year,
                total_commission: 0,
                total_tip: 0,
                total_bonus: 0,
                total_penalty: 0,
                total_bookings: 0,
                total_minutes: 0,
            });
        }
        
        const m = monthlyMap.get(row.staff_id);
        m.total_commission += Number(row.total_commission || 0);
        m.total_tip += Number(row.total_tip || 0);
        m.total_bonus += Number(row.total_bonus || 0); // ĐIỂM
        m.total_penalty += Number(row.total_penalty || 0);
        m.total_bookings += Number(row.total_bookings || 0);
        m.total_minutes += Number(row.total_minutes || 0);
    }

    const upsertRows = Array.from(monthlyMap.values());
    if (upsertRows.length > 0) {
        const { error: upsertErr } = await supabase
            .from('KTVMonthlyLedger')
            .upsert(upsertRows, { onConflict: 'staff_id, month, year' });
            
        if (upsertErr) {
            console.error('Error upserting monthly ledgers:', upsertErr);
            return false;
        }
    }
    
    console.log(`✅ Synced Monthly Ledger for ${upsertRows.length} KTVs.`);
    return true;
}

export async function processYearlyLedgerSync(supabase: SupabaseClient, year: number) {
    console.log(`[Cron] Syncing Yearly Ledger for ${year}`);

    const { data: monthlyLedgers, error } = await supabase
        .from('KTVMonthlyLedger')
        .select('*')
        .eq('year', year);

    if (error) {
        console.error('Error fetching monthly ledgers for yearly sync:', error);
        return false;
    }

    if (!monthlyLedgers || monthlyLedgers.length === 0) return true;

    const yearlyMap = new Map<string, any>();

    for (const row of monthlyLedgers) {
        if (!yearlyMap.has(row.staff_id)) {
            yearlyMap.set(row.staff_id, {
                staff_id: row.staff_id,
                year,
                total_commission: 0,
                total_tip: 0,
                total_bonus: 0,
                total_penalty: 0,
                total_bookings: 0,
                total_minutes: 0,
            });
        }
        
        const y = yearlyMap.get(row.staff_id);
        y.total_commission += Number(row.total_commission || 0);
        y.total_tip += Number(row.total_tip || 0);
        y.total_bonus += Number(row.total_bonus || 0); // ĐIỂM
        y.total_penalty += Number(row.total_penalty || 0);
        y.total_bookings += Number(row.total_bookings || 0);
        y.total_minutes += Number(row.total_minutes || 0);
    }

    const upsertRows = Array.from(yearlyMap.values());
    if (upsertRows.length > 0) {
        const { error: upsertErr } = await supabase
            .from('KTVYearlyLedger')
            .upsert(upsertRows, { onConflict: 'staff_id, year' });
            
        if (upsertErr) {
            console.error('Error upserting yearly ledgers:', upsertErr);
            return false;
        }
    }
    
    console.log(`✅ Synced Yearly Ledger for ${upsertRows.length} KTVs.`);
    return true;
}

const MAINTENANCE_FEE_DEFAULT = 50000;

/**
 * Cấu hình phí bảo trì áp cho MỘT loại KTV.
 *
 * Hiện CHỈ Loại D có khoá riêng (`enable_maintenance_fee_TYPE_D`,
 * `maintenance_fee_amount_TYPE_D`); thiếu thì rơi về khoá chung. A/B/C vẫn đọc
 * thẳng khoá chung y như trước.
 *
 * ⚠️ Trang Cài đặt hệ thống GHI khoá có hậu tố cho cả A/B/C — thẻ phí bảo trì
 * nằm trong từng tab loại và ghi rõ "Cấu hình riêng cho Loại X" — nhưng chỗ này
 * cố tình KHÔNG đọc mấy khoá đó. Đọc vào là hành vi của A/B/C đổi ngay: ngày
 * 27/08/2026 quản lý đã tắt cả ba loại, DB đang sẵn ba dòng `false`, bật đọc
 * lên là 13 KTV ngừng bị thu trong kỳ tới.
 *
 * Nói cách khác, thẻ phí bảo trì ở tab A/B/C VẪN LÀ NÚT GIẢ — lỗi đã biết, để
 * xử lý sau cùng với phần còn lại của trang. Đừng "dọn cho gọn" bằng cách bỏ
 * nhánh `TYPE_D` ở đây: đó chính là chỗ khác biệt cố ý.
 */
export function resolveMaintenanceFeeForType(
    configs: Record<string, any>,
    workType: string,
): { enabled: boolean; amount: number } {
    const pick = (base: string) => {
        if (workType !== 'TYPE_D') return configs[base];
        const scoped = configs[`${base}_TYPE_D`];
        return scoped !== undefined && scoped !== null && scoped !== '' ? scoped : configs[base];
    };

    const parsedAmount = Number(String(pick('maintenance_fee_amount') ?? '').replace(/"/g, ''));

    return {
        enabled: readConfigBool(pick('enable_maintenance_fee'), false),
        amount: !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount : MAINTENANCE_FEE_DEFAULT,
    };
}

/**
 * Process monthly maintenance fee deduction for all active KTVs.
 * Called on the last day of each month during the daily ledger sync cron.
 * Idempotent: checks if fee was already deducted for the given month/year.
 */
export async function processMonthlyMaintenanceFee(supabase: SupabaseClient, month: number, year: number) {
    console.log(`[Cron] Processing Monthly Maintenance Fee for ${month}/${year}`);

    // Date restriction removed for testing via toggle

    // 🔧 YÊU CẦU TỪ KHÁCH: Tháng 07/2026 đã thu tiền tay, hệ thống sẽ bỏ qua không thu.
    // Đến 31/08/2026 mới bắt đầu thu tiếp (tức là month >= 8 năm 2026).
    if (year === 2026 && month <= 7) {
        console.log('[Cron] Maintenance fee is manually disabled for <= 07/2026 by request. Skipping.');
        return true;
    }

    // 1. Nạp cấu hình phí bảo trì — cả khoá chung lẫn khoá theo từng loại KTV.
    const { data: configRows, error: configError } = await supabase
        .from('SystemConfigs')
        .select('key, value')
        .or('key.like.enable_maintenance_fee%,key.like.maintenance_fee_amount%');

    if (configError) {
        console.error('[Cron] Error loading maintenance fee configs:', configError.message);
        return false;
    }

    const configs: Record<string, any> = {};
    (configRows || []).forEach(row => { configs[row.key] = row.value; });

    // 2. Get all active KTVs
    const { data: ktvs, error: ktvError } = await supabase
        .from('Staff')
        .select('id, full_name, feature_flags, work_type')
        .eq('status', 'ĐANG LÀM')
        .ilike('id', 'NH%');

    if (ktvError || !ktvs || ktvs.length === 0) {
        console.log('[Cron] No active KTVs found for maintenance fee.');
        return true;
    }

    // 3. Idempotency: Check which KTVs already got charged this month
    const reasonPattern = `Phí bảo trì hệ thống tháng ${String(month).padStart(2, '0')}/${year}`;
    const { data: existingRecords } = await supabase
        .from('WalletAdjustments')
        .select('staff_id')
        .eq('reason', reasonPattern)
        .eq('created_by', 'SYSTEM_CRON');

    const alreadyChargedSet = new Set((existingRecords || []).map(r => r.staff_id));

    // 4. Lọc theo cần gạt CỦA CHÍNH LOẠI người đó, rồi tới cờ cá nhân.
    const feeCache = new Map<string, { enabled: boolean; amount: number }>();
    const feeFor = (workType: string) => {
        if (!feeCache.has(workType)) feeCache.set(workType, resolveMaintenanceFeeForType(configs, workType));
        return feeCache.get(workType)!;
    };

    const toCharge = ktvs
        .map(k => ({ ktv: k, fee: feeFor(k.work_type || 'TYPE_A') }))
        .filter(({ ktv, fee }) => {
            if (!fee.enabled) return false;
            if (alreadyChargedSet.has(ktv.id)) return false;
            if (ktv.feature_flags && ktv.feature_flags.maintenance_fee === false) return false;
            return true;
        });

    if (toCharge.length === 0) {
        console.log('[Cron] No KTV to charge maintenance fee (disabled per type, or already charged).');
        return true;
    }

    // 5. Batch insert negative adjustments — mỗi loại có thể một mức tiền khác nhau.
    const adjustments: any[] = toCharge.map(({ ktv, fee }) => ({
        staff_id: ktv.id,
        amount: -fee.amount, // Negative = deduction
        type: 'ADJUST',
        reason: reasonPattern,
        created_by: 'SYSTEM_CRON',
    }));

    // Add total to 'dev' account
    const totalCollected = toCharge.reduce((sum, { fee }) => sum + fee.amount, 0);
    adjustments.push({
        staff_id: 'dev',
        amount: totalCollected, // Positive = income
        type: 'ADJUST',
        reason: `Thu phí bảo trì hệ thống tháng ${String(month).padStart(2, '0')}/${year} (Từ ${toCharge.length} KTV)`,
        created_by: 'SYSTEM_CRON',
    });

    const { error: insertError } = await supabase
        .from('WalletAdjustments')
        .insert(adjustments);

    if (insertError) {
        console.error('[Cron] Error inserting maintenance fee adjustments:', insertError);
        return false;
    }

    console.log(`✅ Charged maintenance fee (tổng ${totalCollected.toLocaleString()}đ) for ${toCharge.length} KTVs.`);
    return true;
}
