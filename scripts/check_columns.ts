import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.rpc('get_table_columns', { table_name: 'Staff' });
    // Or just query one row
    const { data: d2, error: e2 } = await supabase.from('Staff').select('*').limit(1);
    console.log(d2 ? Object.keys(d2[0]) : e2);
}

run();
