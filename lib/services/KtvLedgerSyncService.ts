import { SupabaseClient } from '@supabase/supabase-js';

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
        m.total_bonus += Number(row.total_bonus || 0);
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
        y.total_bonus += Number(row.total_bonus || 0);
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

/**
 * Process monthly maintenance fee deduction for all active KTVs.
 * Called on the last day of each month during the daily ledger sync cron.
 * Idempotent: checks if fee was already deducted for the given month/year.
 */
export async function processMonthlyMaintenanceFee(supabase: SupabaseClient, month: number, year: number) {
    console.log(`[Cron] Processing Monthly Maintenance Fee for ${month}/${year}`);

    // Date restriction removed for testing via toggle

    // 1. Check if feature is enabled
    const { data: enableConfig } = await supabase
        .from('SystemConfigs')
        .select('value')
        .eq('key', 'enable_maintenance_fee')
        .single();

    const isEnabled = enableConfig?.value === true || enableConfig?.value === 'true';
    if (!isEnabled) {
        console.log('[Cron] Maintenance fee is DISABLED. Skipping.');
        return true;
    }

    // 🔧 YÊU CẦU TỪ KHÁCH: Tháng 07/2026 đã thu tiền tay, hệ thống sẽ bỏ qua không thu.
    // Đến 31/08/2026 mới bắt đầu thu tiếp (tức là month >= 8 năm 2026).
    if (year === 2026 && month <= 7) {
        console.log('[Cron] Maintenance fee is manually disabled for <= 07/2026 by request. Skipping.');
        return true;
    }

    // 2. Get fee amount
    const { data: amountConfig } = await supabase
        .from('SystemConfigs')
        .select('value')
        .eq('key', 'maintenance_fee_amount')
        .single();

    let feeAmount = 50000; // default
    if (amountConfig?.value) {
        const parsed = Number(String(amountConfig.value).replace(/"/g, ''));
        if (!isNaN(parsed) && parsed > 0) feeAmount = parsed;
    }

    // 3. Get all active KTVs
    const { data: ktvs, error: ktvError } = await supabase
        .from('Staff')
        .select('id, full_name, feature_flags')
        .eq('status', 'ĐANG LÀM')
        .ilike('id', 'NH%');

    if (ktvError || !ktvs || ktvs.length === 0) {
        console.log('[Cron] No active KTVs found for maintenance fee.');
        return true;
    }

    // 4. Idempotency: Check which KTVs already got charged this month
    const reasonPattern = `Phí bảo trì hệ thống tháng ${String(month).padStart(2, '0')}/${year}`;
    const { data: existingRecords } = await supabase
        .from('WalletAdjustments')
        .select('staff_id')
        .eq('reason', reasonPattern)
        .eq('created_by', 'SYSTEM_CRON');

    const alreadyChargedSet = new Set((existingRecords || []).map(r => r.staff_id));

    // 5. Filter out KTVs that were already charged or have the feature flag disabled
    const toCharge = ktvs.filter(k => {
        if (alreadyChargedSet.has(k.id)) return false;
        if (k.feature_flags && k.feature_flags.maintenance_fee === false) return false;
        return true;
    });
    if (toCharge.length === 0) {
        console.log('[Cron] All KTVs already charged for this month. Skipping.');
        return true;
    }

    // 6. Batch insert negative adjustments
    const adjustments: any[] = toCharge.map(ktv => ({
        staff_id: ktv.id,
        amount: -feeAmount, // Negative = deduction
        type: 'ADJUST',
        reason: reasonPattern,
        created_by: 'SYSTEM_CRON',
    }));

    // Add total to 'dev' account
    const totalCollected = feeAmount * toCharge.length;
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

    console.log(`✅ Charged maintenance fee (${feeAmount.toLocaleString()}đ) for ${toCharge.length} KTVs.`);
    return true;
}
