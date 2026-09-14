import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
    const { data: staff } = await supabase.from('Staff').select('id, full_name, work_type').eq('id', 'NH011').single();
    console.log('Staff NH011:', staff);

    const today = new Date().toISOString().split('T')[0];
    console.log('Ngày hôm nay (server):', today);

    const { data: booking } = await supabase.from('Bookings').select('*').ilike('id', '%004-%').gte('bookingDate', `${today}T00:00:00+07:00`).lte('bookingDate', `${today}T23:59:59.999+07:00`);
    console.log('\nBooking 004 hôm nay:', JSON.stringify(booking, null, 2));

    const { data: items } = await supabase.from('BookingItems').select('*').in('bookingId', (booking||[]).map((b:any)=>b.id));
    console.log('\nItems:', JSON.stringify(items, null, 2));
}
main();
