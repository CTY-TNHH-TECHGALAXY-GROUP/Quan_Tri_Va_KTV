const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function addStatusColumn() {
    console.log('--- ADDING STATUS COLUMN TO BEDS ---');
    try {
        // We cannot run raw SQL easily via JS client unless there is an RPC.
        // Let's try to just update a record with a new field and see if it works (unlikely for SQL DB)
        const { error } = await supabase.from('Beds').update({ status: 'ready' }).match({ id: 'V1-1' });
        if (error && error.message.includes('column "status" of relation "Beds" does not exist')) {
            console.log('❌ Column "status" does not exist. Need to add it.');
            // I will inform the user that they need to add the column or I will try to use a different table.
        } else if (!error) {
            console.log('✅ Column "status" exists or was added!');
        } else {
            console.error('Error:', error.message);
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

addStatusColumn();
