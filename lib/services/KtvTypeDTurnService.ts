import { SupabaseClient } from '@supabase/supabase-js';

export class KtvTypeDTurnService {
    /**
     * Gets the TurnQueue for TYPE_D KTVs on a specific date, sorted by monthly accumulated hours.
     * Replaces the need for a raw SQL JOIN by combining queries efficiently.
     */
    static async getTurnQueue(supabase: SupabaseClient, date: string) {
        // 1. Fetch TurnQueue with Staff info for TYPE_D
        const { data: queueData, error: queueError } = await supabase
            .from('TurnQueue')
            .select(`
                *,
                Staff!inner (
                    id,
                    work_type,
                    work_type_effective_from
                )
            `)
            .eq('date', date)
            .eq('Staff.work_type', 'TYPE_D');

        if (queueError) throw queueError;
        if (!queueData || queueData.length === 0) return [];

        const staffIds = queueData.map(q => q.employee_id);

        // 2. Fetch Service Hours for the current month
        const now = new Date();
        const firstDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().split('T')[0];

        const { data: ledgerData, error: ledgerError } = await supabase
            .from('KTVServiceHoursLedger')
            .select('staff_id, date, hours_earned, hours_penalty')
            .in('staff_id', staffIds)
            .gte('date', firstDayOfMonth);

        if (ledgerError) throw ledgerError;

        // 3. Calculate accumulated hours per staff
        const staffHoursMap: Record<string, number> = {};
        for (const staffId of staffIds) {
            staffHoursMap[staffId] = 0;
        }

        if (ledgerData) {
            for (const row of ledgerData) {
                const staff = queueData.find(q => q.employee_id === row.staff_id)?.Staff as any;
                if (!staff) continue;

                // Enforce constraint: only count hours on or after work_type_effective_from
                const effectiveDate = staff.work_type_effective_from || '2020-01-01';
                if (row.date >= effectiveDate) {
                    const earned = Number(row.hours_earned) || 0;
                    const penalty = Number(row.hours_penalty) || 0;
                    staffHoursMap[row.staff_id] += (earned - penalty);
                }
            }
        }

        // 4. Map the calculated hours back to the queue items
        const enrichedQueue = queueData.map(q => {
            return {
                ...q,
                monthly_hours: staffHoursMap[q.employee_id] || 0
            };
        });

        // 5. Sort: monthly_hours DESC, check_in_order ASC
        enrichedQueue.sort((a, b) => {
            if (b.monthly_hours !== a.monthly_hours) {
                return b.monthly_hours - a.monthly_hours; // DESC
            }
            // Tie-breaker
            return (a.check_in_order || 0) - (b.check_in_order || 0); // ASC
        });

        return enrichedQueue;
    }
}
