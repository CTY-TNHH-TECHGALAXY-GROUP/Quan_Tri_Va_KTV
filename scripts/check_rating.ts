import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

envContent.split('\n').forEach(line => {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) process.env.NEXT_PUBLIC_SUPABASE_URL = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SECRET_KEY=')) process.env.SUPABASE_SECRET_KEY = line.split('=')[1].trim();
});

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);

async function check() {
    const { data } = await supabase.from('BookingItems').select('id, serviceId, itemRating').eq('bookingId', '11NDK-004-04072026');
    console.log(data);
}
check();
