const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log('--- SCHEMA INSPECTION ---');
    try {
        console.log('\n--- LATEST BOOKINGS ---');
        const { data: bks, error: be } = await supabase
            .from('Bookings')
            .select('id, billCode, status, rating, technicianCode, createdAt')
            .order('createdAt', { ascending: false })
            .limit(5);
        
        if (be) console.error('Error fetching bookings:', be);
        else {
            console.table(bks);
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

inspectSchema();
