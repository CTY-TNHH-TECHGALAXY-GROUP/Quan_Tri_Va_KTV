const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

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
