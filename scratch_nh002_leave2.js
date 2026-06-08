import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const SUPABASE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
    const { data: shifts } = await supabase.from('KTVShifts').select('*').eq('employeeId', 'NH002').order('createdAt', { ascending: false }).limit(20);
    console.log("KTVShifts:", shifts);
}

check();
