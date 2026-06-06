const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

const bookingId = '507d91c1-af0d-4635-aa52-678521b7a3ba';

async function cleanup() {
    console.log(`🧹 [Cleanup] Cleaning up data for booking: ${bookingId}...`);
    try {
        // 1. Xóa StaffNotifications
        const { error: nErr } = await supabase
            .from('StaffNotifications')
            .delete()
            .eq('bookingId', bookingId);
        if (nErr) throw nErr;
        console.log("✅ [Cleanup] StaffNotifications deleted.");

        // 2. Xóa BookingItems
        const { error: iErr } = await supabase
            .from('BookingItems')
            .delete()
            .eq('bookingId', bookingId);
        if (iErr) throw iErr;
        console.log("✅ [Cleanup] BookingItems deleted.");

        // 3. Xóa Bookings
        const { error: bErr } = await supabase
            .from('Bookings')
            .delete()
            .eq('id', bookingId);
        if (bErr) throw bErr;
        console.log("✅ [Cleanup] Booking deleted.");

        console.log("🎉 [Cleanup] All simulation data cleaned up successfully!");
    } catch (err) {
        console.error("❌ [Cleanup] Error during cleanup:", err);
    }
}

cleanup();
