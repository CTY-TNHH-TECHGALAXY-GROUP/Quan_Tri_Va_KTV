import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // Find all "junk" Staff records that were auto-created by old dispatch logic
    // These are records where id = full_name (e.g., id: "HIEU", full_name: "HIEU")
    // and the id doesn't follow any known pattern (NH***, EXT**)
    const { data: allStaff } = await supabase
        .from('Staff')
        .select('id, full_name, role')
        .not('id', 'ilike', 'NH%')
        .not('id', 'ilike', 'EXT%')
        .order('id');
    
    console.log('Non-standard Staff records (potential junk):');
    allStaff?.forEach(s => {
        console.log(`  id="${s.id}", full_name="${s.full_name}", role="${s.role}"`);
    });
    console.log(`\nTotal: ${allStaff?.length || 0} records`);
}
run();
