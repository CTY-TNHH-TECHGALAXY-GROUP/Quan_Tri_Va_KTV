import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function main() {
  const { data: b } = await supabase.from('Bookings').select('id, billCode, parent_booking_id, sub_suffix, status').ilike('billCode', '%LYXJ%');
  const ids = b.map(x => x.id);
  
  const { data: i } = await supabase.from('BookingItems').select('id, bookingId, guest_id, serviceId, status').in('bookingId', ids);
  const guestIds = [...new Set(i.filter(item => item.guest_id).map(item => item.guest_id))];
  
  console.log('Missing guests:', guestIds);
  const toInsert = guestIds.map(gid => {
    // format is bookingId_guest_1
    const bookingId = gid.split('_guest_')[0];
    const index = parseInt(gid.split('_guest_')[1] || '1');
    const suffixMatch = bookingId.match(/-([A-Z])$/);
    const label = suffixMatch ? suffixMatch[1] : 'Khách ' + index;
    return {
      id: gid,
      booking_id: bookingId,
      guest_index: index,
      guest_label: 'Khách ' + label,
      status: 'WAITING'
    };
  });
  
  const { data, error } = await supabase.from('BookingGuests').insert(toInsert).select();
  if (error) console.error(error);
  else console.log('Inserted:', data.length);
}
main();
