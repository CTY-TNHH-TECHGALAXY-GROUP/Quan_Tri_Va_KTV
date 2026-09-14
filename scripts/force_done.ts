import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { syncTurnsForDate } from '../lib/turn-sync';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) process.env.NEXT_PUBLIC_SUPABASE_URL = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) process.env.SUPABASE_SERVICE_ROLE_KEY = line.split('=')[1].trim();
});

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    // Force the booking to DONE
    await supabase.from('Bookings').update({ status: 'DONE' }).eq('id', '11NDK-004-04072026');
    
    console.log('Forced booking to DONE, running sync...');
    await syncTurnsForDate('2026-07-04');
    console.log('Done syncing. Checking KTVDailyLedger...');

    const { data: ledger } = await supabase.from('KTVDailyLedger').select('*').eq('staff_id', 'NH021').eq('date', '2026-07-04');
    console.log(ledger);
}
run();
