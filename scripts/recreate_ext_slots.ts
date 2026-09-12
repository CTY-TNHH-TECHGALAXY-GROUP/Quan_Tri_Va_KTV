import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const extStaff = Array.from({ length: 30 }, (_, i) => {
        const id = `EXT${String(i + 1).padStart(2, '0')}`;
        return {
            id,
            full_name: `KTV Ngoài ${i + 1}`,
            position: 'Kỹ thuật viên',
            status: 'ĐANG LÀM',
            work_type: 'TYPE_C'
        };
    });

    for (const staff of extStaff) {
        const { error } = await supabase.from('Staff').upsert(staff, { onConflict: 'id' });
        if (error) {
            console.error('Failed to insert', staff.id, error);
        }
    }
    console.log('Successfully recreated EXT dummy slots.');
}

run();
