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
