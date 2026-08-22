const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log('--- SCHEMA INSPECTION V3 ---');
    try {
        const tables = ['Rooms', 'Beds', 'TurnQueue', 'Staff'];
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*').limit(1);
            if (error) {
                console.error(`Error fetching ${table}:`, error.message);
            } else if (data && data.length > 0) {
                console.log(`${table} Columns:`, Object.keys(data[0]).join(', '));
                console.log(`${table} First Row Sample:`, JSON.stringify(data[0], null, 2));
            } else {
                console.log(`${table} is EMPTY or not found.`);
            }
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

inspectSchema();
