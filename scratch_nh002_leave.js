import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const SUPABASE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
    const { data: shifts } = await supabase.from('KTVShifts').select('*').eq('employeeId', 'NH002').order('effectiveFrom', { ascending: false }).limit(5);
    console.log("KTVShifts:", shifts);

    const { data: leaves } = await supabase.from('KTVLeaveRequests').select('*').eq('employeeId', 'NH002').order('date', { ascending: false }).limit(5);
    console.log("KTVLeaveRequests:", leaves);

    const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const today = new Date(vnNow.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    console.log("Business Today:", today);

    // Fetch active shift using the api logic
    const { data: activeShifts } = await supabase
        .from('KTVShifts')
        .select('*')
        .eq('employeeId', 'NH002')
        .lte('effectiveFrom', today)
        .in('status', ['ACTIVE', 'REPLACED'])
        .order('effectiveFrom', { ascending: false })
        .order('createdAt', { ascending: false });
    
    console.log("Active shift resolved by system:", activeShifts ? activeShifts[0] : null);
}

check();
