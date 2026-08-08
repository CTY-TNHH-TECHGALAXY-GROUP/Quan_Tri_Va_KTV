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

async function checkGeoff() {
  const { data: customer } = await supabase.from('Customers').select('id, fullName, phone').ilike('phone', '%GUEST-17%');

  if (customer && customer.length > 0) {
    for (let c of customer) {
        const custId = c.id;
        const { data: bookings } = await supabase.from('Bookings').select('id, bookingDate, status, notes').eq('customerId', custId).order('bookingDate', { ascending: false });
        
        let evalCount = 0;
        
        for (const b of bookings) {
          if (['COMPLETED', 'FEEDBACK', 'CLEANING', 'DONE'].includes(b.status)) {
            const { data: items } = await supabase.from('BookingItems').select('id, itemRating, itemFeedback').eq('bookingId', b.id);
            
            let hasEval = b.notes && b.notes.includes('[Đánh giá KTV:');
            let hasRating = items && items.some(i => i.itemRating || i.itemFeedback);
            
            if (hasEval || hasRating) {
                evalCount++;
            }
          }
        }
        console.log(`${c.fullName} (${c.phone}) has ${bookings.length} valid bookings and ${evalCount} evaluations.`);
    }
  }
}

checkGeoff().catch(console.error);
