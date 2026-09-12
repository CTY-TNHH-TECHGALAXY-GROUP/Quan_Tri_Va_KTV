import { getSupabaseAdmin } from '../lib/supabaseAdmin';
async function run() {
    const sb = getSupabaseAdmin();
    if (!sb) { console.error('No sb'); return; }
    const {data} = await sb.from('Staff').select('id, full_name').ilike('id', 'EXT%');
    console.log('EXT Accounts:', data);
}
run();
