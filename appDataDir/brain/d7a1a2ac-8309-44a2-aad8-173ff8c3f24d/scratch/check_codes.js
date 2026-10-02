require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
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
