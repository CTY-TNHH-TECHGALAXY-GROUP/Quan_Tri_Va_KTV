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

async function check() {
    // Check TurnLedger for NH021 today
    const { data: turns, error: e1 } = await supabase
        .from('TurnLedger')
        .select('*')
        .eq('employee_id', 'NH021')
        .order('created_at', { ascending: false })
        .limit(10);
    
    console.log('--- TurnLedger cho NH021 ---');
    console.log(e1 ? e1 : JSON.stringify(turns, null, 2));

    // Check KtvAssignments (Maybe that's the table?)
    const { data: assign, error: e3 } = await supabase
        .from('KtvAssignments')
        .select('*')
        .eq('employee_id', 'NH021')
        .order('created_at', { ascending: false })
        .limit(10);
    
    console.log('--- KtvAssignments cho NH021 ---');
    console.log(e3 ? e3 : JSON.stringify(assign, null, 2));
}
check();
