import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const SUPABASE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
    const { data } = await supabase.from('SystemConfigs').select('*').eq('key', 'spa_day_cutoff_hours');
    console.log("Config:", data);
}

check();
