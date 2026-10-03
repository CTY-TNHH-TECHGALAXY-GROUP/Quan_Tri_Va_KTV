import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvWalletService } from './lib/services/KtvWalletService';

dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);

async function run() {
    const balance = await KtvWalletService.getBalance(supabase, 'T001');
    console.log(JSON.stringify(balance, null, 2));
}
run();
