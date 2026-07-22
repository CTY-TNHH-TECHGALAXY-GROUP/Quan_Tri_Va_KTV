import { getSupabaseAdmin } from './supabaseAdmin';

export async function syncTurnsForDate(date: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase not initialized');

        // 1. Nhóm và đếm số lượng tua từ TurnLedger trong ngày
        const { data: ledgers, error: ledgerError } = await supabase
            .from('TurnLedger')
            .select('employee_id')
            .eq('date', date);

        if (ledgerError) throw ledgerError;

        // Gom nhóm theo employee_id
        const turnsCount: Record<string, number> = {};
        (ledgers || []).forEach(ledger => {
            const empId = ledger.employee_id;
            if (empId) {
                turnsCount[empId] = (turnsCount[empId] || 0) + 1;
            }
        });

        // 2. Lấy tất cả KTV đang có mặt trong TurnQueue ngày hôm nay
        const { data: queues, error: queueError } = await supabase
            .from('TurnQueue')
            .select('id, employee_id, turns_completed')
            .eq('date', date);

        if (queueError) throw queueError;

        // 3. Gom chung tập hợp nhân viên cần đồng bộ (từ Ledger HOẶC đang có TurnQueue)
        const allEmployeeIds = new Set([
            ...Object.keys(turnsCount),
            ...(queues || []).map(q => q.employee_id).filter(Boolean)
        ]);

        if (allEmployeeIds.size > 0) {
            for (const empId of Array.from(allEmployeeIds)) {
                const actualCount = turnsCount[empId] || 0;
                
                // Nếu nhân viên đã có queue, chỉ update nếu sai
                const existingQueue = (queues || []).find(q => q.employee_id === empId);
                
                if (existingQueue) {
                    if (existingQueue.turns_completed !== actualCount) {
                        await supabase
                            .from('TurnQueue')
                            .update({ turns_completed: actualCount })
                            .eq('id', existingQueue.id);
                    }
                } else {
                    // Nếu nhân viên có trong Ledger nhưng chưa có Queue (ít gặp), thì tạo mới
                    await supabase
                        .from('TurnQueue')
                        .insert({
                            employee_id: empId,
                            date: date,
                            turns_completed: actualCount,
                            status: 'waiting'
                        });
                }
            }
        }

        return true;
    } catch (error) {
        console.error('Turn Sync Error:', error);
        return false;
    }
}
