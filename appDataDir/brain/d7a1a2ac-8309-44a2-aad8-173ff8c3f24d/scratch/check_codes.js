const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCodes() {
    const { data: items } = await supabase
        .from('BookingItems')
        .select('id, technicianCodes')
        .contains('technicianCodes', ['NH027']);
    
    console.log('Items with NH027:');
    items.forEach(i => console.log(`- ${i.id}: ${JSON.stringify(i.technicianCodes)}`));
}

checkCodes();
