const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function globalAudit() {
    const targetDate = '2026-04-30';
    console.log(`--- Global Audit for ${targetDate} ---`);

    // 1. Get all BookingItems for the date
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, billCode')
        .gte('bookingDate', `${targetDate} 00:00:00`)
        .lte('bookingDate', `${targetDate} 23:59:59`);
    
    const bookingIds = bookings.map(b => b.id);
    const { data: items } = await supabase
        .from('BookingItems')
        .select('id, bookingId, technicianCodes, status')
        .in('bookingId', bookingIds);

    // 2. Get all TurnLedger entries for the date
    const { data: ledgers } = await supabase
        .from('TurnLedger')
        .select('*')
        .eq('date', targetDate);

    const ledgerMap = new Set(ledgers.map(l => `${l.employee_id}_${l.booking_id}`));

    // 3. Compare
    const missingEntries = [];
    items.forEach(item => {
        if (item.technicianCodes) {
            item.technicianCodes.forEach(code => {
                const key = `${code}_${item.bookingId}`;
                if (!ledgerMap.has(key)) {
                    // Cẩn thận: 1 bill nhiều items thì chỉ tính 1 ledger. 
                    // Nhưng ở đây ta kiểm tra theo bookingId, nên nếu bill đó chưa có ledger cho KTV này thì là thiếu.
                    missingEntries.push({ code, bookingId: item.bookingId, billCode: bookings.find(b => b.id === item.bookingId)?.billCode });
                }
            });
        }
    });

    console.log(`\nFound ${missingEntries.length} potentially missing Ledger entries:`);
    // Filter duplicates (multiple items in same booking for same KTV)
    const uniqueMissing = [];
    const seen = new Set();
    missingEntries.forEach(m => {
        const k = `${m.code}_${m.bookingId}`;
        if (!seen.has(k)) {
            uniqueMissing.push(m);
            seen.add(k);
        }
    });

    uniqueMissing.forEach(m => {
        console.log(`- KTV: ${m.code}, Bill: ${m.billCode} (${m.bookingId})`);
    });

    if (uniqueMissing.length > 0) {
        console.log('\n--- Fixing Missing Ledgers ---');
        for (const m of uniqueMissing) {
            console.log(`Inserting Ledger for ${m.code} - ${m.billCode}...`);
            await supabase.from('TurnLedger').insert({
                date: targetDate,
                booking_id: m.bookingId,
                employee_id: m.code,
                source: 'AUDIT_FIX'
            }).select();
        }
        console.log('✅ All missing ledgers inserted.');
    }
}

globalAudit();
