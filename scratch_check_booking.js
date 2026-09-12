const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanOrder() {
    const bookingId = '11NDK-011-30082026';
    const mainGuestId = 'a327c2ec-f921-410f-ab11-ff3e5855a019';
    const badGuestId = '36212368-d6fe-42b0-88f8-8b9fa9d53cf3';

    console.log('Updating BookingItems...');
    const { error: updateError } = await supabase.from('BookingItems').update({ guest_id: mainGuestId }).eq('bookingId', bookingId);
    if (updateError) {
        console.error('Error updating items:', updateError);
        return;
    }
    
    console.log('Deleting bad guest...');
    const { error: delError } = await supabase.from('BookingGuests').delete().eq('id', badGuestId);
    if (delError) {
        console.error('Error deleting guest:', delError);
        return;
    }
    
    console.log('Done!');
}
cleanOrder();
