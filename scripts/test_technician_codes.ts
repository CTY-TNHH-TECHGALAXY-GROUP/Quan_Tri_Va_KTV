import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data } = await supabase.from('BookingItems').select('id, technicianCodes').limit(1);
    if (data && data.length) {
        const { error } = await supabase.from('BookingItems').update({ technicianCodes: ['TEST_HIEUU'] }).eq('id', data[0].id);
        console.log('Update Error:', error);
        
        // Revert
        await supabase.from('BookingItems').update({ technicianCodes: data[0].technicianCodes }).eq('id', data[0].id);
    }
}

run();
