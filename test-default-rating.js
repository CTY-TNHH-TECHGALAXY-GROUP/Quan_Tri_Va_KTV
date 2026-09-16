const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemZvaGZkaW5kb3ZmY3BhaXpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3OTgwMCwiZXhwIjoyMDg3MjU1ODAwfQ.wGaNWPGK8fLF5GMzbiGTApVnktdtaegQkquTMOGPyl8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testDefaultRating() {
    const testId = 'TEST-' + Date.now();
    console.log('Inserting test booking:', testId);
    const { data, error } = await supabase.from('Bookings').insert({
        id: testId,
        customerName: 'Test Default',
        customerPhone: '0000',
        totalAmount: 0,
        status: 'PENDING',
        billCode: 'TEST-' + Math.random().toString(36).substring(7),
        bookingDate: new Date().toISOString()
    }).select().single();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Inserted Rating:', data.rating);
    }
}

testDefaultRating();
