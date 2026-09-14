import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // Check if "HIẾU" or "HIEU" exists in Staff table
    const { data: staff1 } = await supabase.from('Staff').select('id, full_name').ilike('id', '%HIEU%');
    console.log('Staff matching HIEU:', staff1);
    
    const { data: staff2 } = await supabase.from('Staff').select('id, full_name').ilike('id', '%HIẾU%');
    console.log('Staff matching HIẾU:', staff2);

    const { data: staff3 } = await supabase.from('Staff').select('id, full_name').ilike('full_name', '%Hiếu%');
    console.log('Staff matching full_name Hiếu:', staff3);
    
    // Also check the actual id values
    const { data: staff4 } = await supabase.from('Staff').select('id, full_name').eq('id', 'HIẾU');
    console.log('Staff exact match "HIẾU":', staff4);
    
    const { data: staff5 } = await supabase.from('Staff').select('id, full_name').eq('id', 'HIEU');
    console.log('Staff exact match "HIEU":', staff5);
}
run();
