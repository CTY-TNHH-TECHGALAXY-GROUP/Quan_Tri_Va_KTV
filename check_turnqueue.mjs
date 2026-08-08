import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('TurnQueue')
    .select('*')
    .in('employee_id', ['NH001', 'NH011'])
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('TurnQueue:', data);
  if (error) console.error(error);
}

check();
