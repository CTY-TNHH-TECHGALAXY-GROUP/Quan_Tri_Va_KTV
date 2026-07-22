require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    // Attempt to insert a StaffNotification with fake bookingId
    // It should fail with FK constraint error
    const { data, error } = await supabase.from('StaffNotifications').insert({
        bookingId: '00000000-0000-0000-0000-000000000000',
        employeeId: null,
        type: 'NEW_ORDER',
        message: 'Test',
        isRead: false
    });
    console.log('Result Fake ID:', error || 'Success');
}

run();
