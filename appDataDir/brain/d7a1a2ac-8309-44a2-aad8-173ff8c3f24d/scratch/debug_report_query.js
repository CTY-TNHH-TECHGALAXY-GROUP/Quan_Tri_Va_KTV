const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function debugReportQueryFixed() {
    const dateFrom = '2026-04-30';
    const dateTo = '2026-04-30';
    const KTV_RANKING_STATUSES = ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'DONE', 'COMPLETED', 'FEEDBACK'];

    console.log(`Querying Bookings for ${dateFrom}...`);
    const { data: bookings, error } = await supabase
        .from('Bookings')
        .select('id, technicianCode, status, bookingDate')
        .in('status', KTV_RANKING_STATUSES)
        .gte('bookingDate', `${dateFrom} 00:00:00`)
        .lte('bookingDate', `${dateTo} 23:59:59`);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${bookings.length} bookings.`);
    if (bookings.length > 0) {
        const ids = bookings.map(b => b.id);
        const { data: items, error: iErr } = await supabase
            .from('BookingItems')
            .select('id, bookingId')
            .in('bookingId', ids);
            
        console.log(`Found ${items?.length || 0} items.`);
    }
}

debugReportQueryFixed();
