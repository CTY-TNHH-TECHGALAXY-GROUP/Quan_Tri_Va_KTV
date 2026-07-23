import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // Restore ADMIN and dev accounts that were mistakenly deleted
    const toRestore = [
        { id: 'ADMIN', full_name: 'Quản Trị Viên' },
        { id: 'dev', full_name: 'Developer' },
    ];
    
    for (const s of toRestore) {
        console.log(`Restoring Staff: "${s.id}"...`);
        const { error } = await supabase.from('Staff').upsert({
            id: s.id,
            full_name: s.full_name,
            status: 'active'
        }, { onConflict: 'id' });
        
        if (error) console.error(`  ❌ Error restoring ${s.id}:`, error.message);
        else console.log(`  ✅ Restored "${s.id}"`);
    }
    
    // Verify
    const { data: check } = await supabase.from('Staff').select('id, full_name').in('id', ['ADMIN', 'dev']);
    console.log('\nVerification:', check);
}
run();
