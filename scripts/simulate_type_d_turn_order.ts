import assert from 'assert';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvTypeDTurnService } from '../lib/services/KtvTypeDTurnService';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runTest() {
    const date = '2026-09-01';

    try {
        console.log("Running turn order assertions...");
        
        // Clean up first just in case
        await supabase.from('KTVServiceHoursLedger').delete().like('staff_id', 'T%');
        await supabase.from('TurnQueue').delete().eq('date', date);

        // Insert mock TurnQueue items
        await supabase.from('TurnQueue').insert([
            { date, employee_id: 'T001', check_in_order: 1, status: 'waiting' },
            { date, employee_id: 'T002', check_in_order: 2, status: 'working' },
            { date, employee_id: 'T011', check_in_order: 3, status: 'waiting' }
        ]);

        // Insert ledger hours WITH booking_id to prevent null/null orphaned rows outside unique constraints
        await supabase.from('KTVServiceHoursLedger').insert([
            { staff_id: 'T001', date: '2026-09-01', hours_earned: 5, booking_id: 'TEST-B1' },
            { staff_id: 'T002', date: '2026-09-01', hours_earned: 10, booking_id: 'TEST-B2' },
            { staff_id: 'T011', date: '2026-09-01', hours_earned: 8, hours_penalty: 3, booking_id: 'TEST-B3' }
        ]);

        const result = await KtvTypeDTurnService.getTurnQueue(supabase, date);

        // Asserts
        assert.ok(result);
        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].employee_id, 'T002');
        assert.strictEqual(result[0].monthly_hours, 10);
        assert.strictEqual(result[1].employee_id, 'T001');
        assert.strictEqual(result[1].monthly_hours, 5);
        assert.strictEqual(result[2].employee_id, 'T011');
        assert.strictEqual(result[2].monthly_hours, 5);

        console.log("All turn order assertions passed.");
    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        // ALWAYS CLEAN UP DB
        await supabase.from('KTVServiceHoursLedger').delete().like('staff_id', 'T%');
        await supabase.from('TurnQueue').delete().eq('date', date);
    }
}

runTest();
