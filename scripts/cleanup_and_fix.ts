import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // 1. List all Staff that are NOT NH* or EXT* (junk records)
    const { data: allStaff } = await supabase.from('Staff').select('id, full_name');
    const junkStaff = (allStaff || []).filter(s => !s.id.startsWith('NH') && !s.id.startsWith('EXT'));
    
    if (junkStaff.length > 0) {
        console.log('⚠️ Found JUNK Staff records (not NH* or EXT*):');
        junkStaff.forEach(s => console.log(`  id="${s.id}", name="${s.full_name}"`));
        
        // Delete them
        for (const s of junkStaff) {
            console.log(`  🗑️ Deleting junk Staff: "${s.id}"...`);
            const { error: e1 } = await supabase.from('TurnQueue').delete().eq('employee_id', s.id);
            if (e1) console.error('  TurnQueue delete error:', e1.message);
            const { error: e2 } = await supabase.from('Staff').delete().eq('id', s.id);
            if (e2) console.error('  Staff delete error:', e2.message);
            else console.log(`  ✅ Deleted "${s.id}"`);
        }
    } else {
        console.log('✅ No junk Staff records found. All clean!');
    }
    
    // 2. Verify EXT accounts exist
    const { data: extStaff } = await supabase.from('Staff').select('id').ilike('id', 'EXT%');
    console.log(`\n📊 Total EXT accounts available: ${extStaff?.length || 0}`);
    
    // 3. Also fix the specific booking from screenshot
    const { data: booking } = await supabase
        .from('BookingItems')
        .select('id, bookingId, technicianCodes, options')
        .eq('bookingId', 'd8b2b2aa-6011-4f00-8b6c-54080a31f8b5');
    
    if (booking && booking.length > 0) {
        console.log('\n🔧 Fixing old booking d8b2b2aa with stale technicianCodes...');
        for (const item of booking) {
            const techCodes = Array.isArray(item.technicianCodes) ? item.technicianCodes : [];
            const hasJunkCode = techCodes.some(c => !c.startsWith('NH') && !c.startsWith('EXT'));
            if (hasJunkCode) {
                console.log(`  Clearing junk technicianCodes ${JSON.stringify(techCodes)} from item ${item.id}`);
                await supabase.from('BookingItems').update({ 
                    technicianCodes: null, 
                    status: 'NEW',
                    segments: null 
                }).eq('id', item.id);
                
                // Also reset booking status
                await supabase.from('Bookings').update({ 
                    status: 'NEW',
                    technicianCode: null 
                }).eq('id', 'd8b2b2aa-6011-4f00-8b6c-54080a31f8b5');
                
                console.log('  ✅ Reset booking to NEW status for re-dispatch');
            }
        }
    }
}
run();
