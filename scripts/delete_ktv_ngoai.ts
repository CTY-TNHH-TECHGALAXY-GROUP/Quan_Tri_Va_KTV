import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: staff, error } = await supabase
        .from('Staff')
        .select('id, full_name')
        .like('full_name', 'KTV Ngoài %');
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Found staff:', staff);
    
    for (const s of staff) {
        console.log(`Deleting ${s.id} - ${s.full_name}`);
        // Xóa khỏi bảng Staff
        const { error: delError } = await supabase.from('Staff').delete().eq('id', s.id);
        if (delError) console.error('Failed to delete staff', s.id, delError);
        
        // Xóa khỏi bảng Users
        const { error: delUserError } = await supabase.from('Users').delete().eq('id', s.id);
        if (delUserError) console.error('Failed to delete user', s.id, delUserError);
    }
    console.log('Done');
}

run();
