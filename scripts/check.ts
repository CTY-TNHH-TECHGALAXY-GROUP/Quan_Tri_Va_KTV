import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

let supabaseUrl = '';
let supabaseKey = '';

envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) supabaseKey = line.split('=')[1].trim();
});

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTrans() {
    const { data: ledger } = await supabase.from('KTVPiggyBankLedger').select('*').order('created_at', { ascending: false }).limit(20);
    console.log('--- LEDGER ---');
    console.log(JSON.stringify(ledger, null, 2));

    const { data: bank } = await supabase.from('KTVPiggyBank').select('*').order('updated_at', { ascending: false }).limit(20);
    console.log('--- BANK ---');
    console.log(JSON.stringify(bank, null, 2));
}
checkTrans();
