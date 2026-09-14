import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data } = await supabase.from('Staff').select('id, full_name, role').eq('id', 'HIEU');
    console.log('Staff HIEU:', data);
    
    // Check if it starts with NH (case-insensitive)
    if (data && data.length > 0) {
        console.log('id starts with NH?', data[0].id.startsWith('NH'));
        console.log('id starts with EXT?', data[0].id.startsWith('EXT'));
        console.log('id length:', data[0].id.length);
        console.log('id chars:', [...data[0].id].map(c => c.charCodeAt(0)));
    }
}
run();
