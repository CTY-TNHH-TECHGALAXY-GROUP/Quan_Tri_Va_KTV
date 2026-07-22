import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';

envFile.split('\n').forEach(line => {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) SUPABASE_URL = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) SUPABASE_KEY = line.split('=')[1].trim();
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkWeirdTimes() {
  const { data: bookings } = await supabase.from('Bookings').select('id, bookingDate, timeBooking').limit(1000);
  
  for (const b of bookings) {
      if (!b.bookingDate) continue;
      
      const vnTimeStr = new Date(b.bookingDate).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
      const vnDate = new Date(vnTimeStr);
      const hour = vnDate.getHours();
      
      if (hour === 4 || hour === 5 || hour === 6 || hour === 7) {
          console.log(`Booking ID: ${b.id}`);
          console.log(`Original bookingDate: ${b.bookingDate}`);
          console.log(`timeBooking (if any): ${b.timeBooking}`);
          console.log(`Converted vnTimeStr: ${vnTimeStr}`);
          console.log(`Parsed hour: ${hour}`);
          console.log('---');
      }
  }
}

checkWeirdTimes().catch(console.error);
