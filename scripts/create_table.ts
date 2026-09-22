import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
async function run() {
    const query = `CREATE TABLE IF NOT EXISTS "KTVDailyRegistration" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "staff_id" TEXT NOT NULL,
        "work_date" DATE NOT NULL,
        "registered_at" TIMESTAMPTZ DEFAULT NOW(),
        "status" TEXT DEFAULT 'REGISTERED',
        "absent_reported_at" TIMESTAMPTZ,
        "late_reported_at" TIMESTAMPTZ,
        "late_expected_time" TIME,
        "late_report_count" INT DEFAULT 0,
        "check_in_at" TIMESTAMPTZ,
        "penalty_applied" TEXT,
        "expected_start_time" TIME,
        UNIQUE("staff_id", "work_date")
    );`;
    const { error } = await supabase.rpc('execute_sql', { query });
    console.log(error ? 'Error: ' + error.message : 'Table created successfully');
}
run();
