import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
async function main() {
  const { data: b } = await supabase.from('Bookings').select('id, billCode, parent_booking_id, sub_suffix, status').ilike('billCode', '%LYXJ%');
  if (b.length > 0) {
    const ids = b.map(x => x.id);
    const { data: g } = await supabase.from('BookingGuests').select('id, booking_id, guest_index, guest_label').in('booking_id', ids);
    console.table(g);
  }
}
main();
