const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function auditSunny() {
    const targetDate = '2026-04-30';
    const empId = 'NH027';
    console.log(`--- Auditing Sunny (${empId}) for ${targetDate} ---`);

    // 1. Check TurnLedger
    const { data: ledger } = await supabase
        .from('TurnLedger')
        .select('*')
        .eq('date', targetDate)
        .eq('employee_id', empId);
    
    console.log(`\n[TurnLedger entries]: ${ledger?.length || 0}`);
    ledger?.forEach(l => console.log(`- Ledger ID: ${l.id}, Booking: ${l.booking_id}`));

    // 2. Check BookingItems
    // Since technicianCodes is an array, we use cs (contains)
    const { data: items } = await supabase
        .from('BookingItems')
        .select('id, bookingId, status, technicianCodes')
        .contains('technicianCodes', [empId]);
    
    // Filter by booking date (we need to join or check Booking table)
    const bookingIds = items.map(i => i.bookingId);
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, bookingDate, billCode, status')
        .in('id', bookingIds)
        .gte('bookingDate', `${targetDate} 00:00:00`)
        .lte('bookingDate', `${targetDate} 23:59:59`);

    const validBookingIds = new Set(bookings.map(b => b.id));
    const sunnyItems = items.filter(i => validBookingIds.has(i.bookingId));

    console.log(`\n[BookingItems found for Sunny on ${targetDate}]: ${sunnyItems.length}`);
    sunnyItems.forEach(i => {
        const b = bookings.find(bk => bk.id === i.bookingId);
        console.log(`- Item: ${i.id}, Booking: ${i.bookingId} (${b?.billCode}), Status: ${i.status}`);
    });

    // Find mismatch
    const ledgerBookingIds = new Set(ledger.map(l => l.booking_id));
    const missingInLedger = sunnyItems.filter(i => !ledgerBookingIds.has(i.bookingId));

    if (missingInLedger.length > 0) {
        console.log(`\n⚠️ Missing in TurnLedger:`);
        missingInLedger.forEach(i => console.log(`- Booking ${i.bookingId}`));
    } else {
        console.log(`\n✅ No missing ledger entries found based on current BookingItems.`);
    }
}

auditSunny();
