const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function listColumns() {
    console.log('--- BOOKINGS COLUMNS ---');
    try {
        const { data, error } = await supabase
            .from('Bookings')
            .select('*')
            .limit(1);
        
        if (error) {
            console.error('Error:', error);
            return;
        }

        if (data && data.length > 0) {
            console.log(Object.keys(data[0]).join(', '));
        } else {
            console.log('No data found to inspect columns');
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

listColumns();
