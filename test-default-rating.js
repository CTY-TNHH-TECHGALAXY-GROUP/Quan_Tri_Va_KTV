const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
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
