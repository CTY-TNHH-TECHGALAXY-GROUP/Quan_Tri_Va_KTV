const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSunnyDates() {
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, billCode, bookingDate, status')
        .in('id', ['11NDK-001-30042026', '11NDK-005-30042026', '11NDK-008-30042026', '11NDK-010-30042026']);
    
    console.log('Bookings for Sunny on 30/04:');
    bookings.forEach(b => console.log(`- ${b.billCode}: date=${b.bookingDate}, status=${b.status}`));
}

checkSunnyDates();
