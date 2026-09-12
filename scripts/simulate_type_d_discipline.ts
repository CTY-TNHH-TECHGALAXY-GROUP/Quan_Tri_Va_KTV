import assert from 'assert';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvTypeDDisciplineService } from '../lib/services/KtvTypeDDisciplineService';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runTest() {
    const staffId = 'T001';
    const date = '2026-09-01';

    try {
        console.log("Running discipline assertions...");
        // Clear previous
        await supabase.from('KTVServiceHoursLedger').delete().eq('staff_id', staffId).eq('date', date);

        await KtvTypeDDisciplineService.deductDailyViolation(supabase, staffId, date, 'ABSENT_NO_NOTICE');
        await KtvTypeDDisciplineService.deductDailyViolation(supabase, staffId, date, 'ABSENT_NO_NOTICE'); // Idempotent
        await KtvTypeDDisciplineService.deductOrderReject(supabase, staffId, date, 'BKG-001', 60);
        await KtvTypeDDisciplineService.deductOrderReject(supabase, staffId, date, 'BKG-001', 60); // Idempotent

        // Fetch to verify
        const { data } = await supabase.from('KTVServiceHoursLedger').select('*').eq('staff_id', staffId).eq('date', date).order('penalty_type');
        
        assert.ok(data);
        assert.strictEqual(data.length, 2);
        
        const absentViolation = data.find(d => d.penalty_type === 'ABSENT_NO_NOTICE');
        assert.ok(absentViolation);
        assert.strictEqual(absentViolation.hours_penalty, 10);
        assert.strictEqual(absentViolation.booking_id, null);

        const rejectViolation = data.find(d => d.penalty_type === 'ORDER_REJECT');
        assert.ok(rejectViolation);
        assert.strictEqual(rejectViolation.hours_penalty, 3);
        assert.strictEqual(rejectViolation.booking_id, 'BKG-001');

        console.log("All discipline assertions passed.");
    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        // ALWAYS CLEAN UP DB
        await supabase.from('KTVServiceHoursLedger').delete().eq('staff_id', staffId).eq('date', date);
    }
}

runTest();
