import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- BACKFILL TYPE_D ALLOW_ON_CALL ---');
    const { data: staffs, error } = await supabase
        .from('Staff')
        .select('id, full_name, feature_flags')
        .eq('work_type', 'TYPE_D');

    if (error) {
        console.error('Error fetching TYPE_D staff:', error);
        process.exit(1);
    }

    if (!staffs || staffs.length === 0) {
        console.log('No TYPE_D staff found.');
        return;
    }

    console.log(`Found ${staffs.length} TYPE_D staff members.`);

    for (const staff of staffs) {
        const currentFlags = staff.feature_flags || {};
        const oldAllowOnCall = currentFlags.allow_on_call;
        
        const newFlags = {
            ...currentFlags,
            allow_on_call: true
        };

        const { error: updateError } = await supabase
            .from('Staff')
            .update({ feature_flags: newFlags })
            .eq('id', staff.id);

        if (updateError) {
            console.error(`Failed to update ${staff.id} (${staff.full_name}):`, updateError);
        } else {
            console.log(`Updated ${staff.id} (${staff.full_name}): allow_on_call: ${oldAllowOnCall} -> true`);
        }
    }
    
    console.log('--- DONE ---');
    
    // Verify
    const { data: verifyStaffs } = await supabase
        .from('Staff')
        .select('id, feature_flags')
        .eq('work_type', 'TYPE_D');
        
    console.log('\nVerification Query Results:');
    verifyStaffs?.forEach(s => {
        console.log(`${s.id}: allow_on_call=${s.feature_flags.allow_on_call}, internal_fund_enabled=${s.feature_flags.internal_fund_enabled}, withdraw_morning_only=${s.feature_flags.withdraw_morning_only}`);
    });
}

run();
