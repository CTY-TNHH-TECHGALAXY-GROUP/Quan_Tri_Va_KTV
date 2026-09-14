import { createClient } from '@supabase/supabase-js'; import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' }); const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); async function run() { 
  const { error } = await supabase.from('Bookings').update({ guestCount: 1 }).eq('id', '11NDK-003-20082026-A');
  console.log('Update guestCount A:', error);
} run();
