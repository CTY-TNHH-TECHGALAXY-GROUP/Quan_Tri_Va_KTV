import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data: activeShifts, error: e1 } = await supabase.from('KTVShifts').select('id', { count: 'exact' }).eq('status', 'ACTIVE');
    const { data: completedShifts, error: e2 } = await supabase.from('KTVShifts').select('id', { count: 'exact' }).eq('status', 'COMPLETED');
    
    console.log(`ACTIVE = ${activeShifts?.length}, COMPLETED = ${completedShifts?.length}`);
}

main().catch(console.error);
