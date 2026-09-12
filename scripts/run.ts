
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
async function main() {
    // Re-verify
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const { data } = await supabase.from('TurnQueue').select('employee_id, status, current_order_id').in('employee_id', ['NH002', 'NH011']).eq('date', today);
    console.log(JSON.stringify(data, null, 2));
}
main().then(() => process.exit(0)).catch(console.error);

