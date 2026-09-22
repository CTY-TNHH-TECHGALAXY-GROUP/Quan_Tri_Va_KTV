import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findBill() {
    const { data, error } = await supabase.from('Bookings').select('id, billCode, status').limit(5);
    console.log("Error:", error);
    console.log("Data:", JSON.stringify(data, null, 2));
}

findBill().catch(console.error);
