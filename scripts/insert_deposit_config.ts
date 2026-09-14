// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function insertConfig() {
  const { data, error } = await supabase
    .from('SystemConfigs')
    .upsert({
      key: 'web_booking_deposit_percent',
      value: '40',
      description: 'Tỉ lệ phần trăm cọc mặc định cho Web Booking (Khách mới)'
    }, { onConflict: 'key' });

  if (error) {
    console.error('Error inserting config:', error);
  } else {
    console.log('Successfully inserted/updated web_booking_deposit_percent to 40%');
  }
}

insertConfig();
