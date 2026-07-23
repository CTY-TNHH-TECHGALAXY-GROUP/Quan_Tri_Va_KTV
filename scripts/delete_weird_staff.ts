import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const idsToDelete = ['NH079, NH016', 'NH014, NH021, NH025', 'THUÝ, BAO'];
    
    for (const id of idsToDelete) {
        console.log(`Deleting ${id}...`);
        const { error: delError } = await supabase.from('Staff').delete().eq('id', id);
        if (delError) console.error('Failed to delete staff', id, delError);
        
        const { error: delUserError } = await supabase.from('Users').delete().eq('id', id);
        if (delUserError) console.error('Failed to delete user', id, delUserError);
    }
    console.log('Done');
}

run();
