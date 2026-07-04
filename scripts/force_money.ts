import { createClient } from '@supabase/supabase-js';
import { POST } from '../app/api/cron/sync-daily-ledger/route';

async function run() {
    console.log('Running sync-daily-ledger via API module...');
    
    // Simulate Request
    const req = new Request('http://localhost/api/cron/sync-daily-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate: '2026-07-04' })
    });
    const res = await POST(req);
    console.log('Result:', await res.json());

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: ledger } = await supabase.from('KTVDailyLedger').select('*').eq('staff_id', 'NH021').eq('date', '2026-07-04');
    console.log('Ledger after sync:', ledger);
}
run();
