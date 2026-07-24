const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixBooking() {
  const bookingId = '11NDK-002-23072026';
  
  // 1. Fetch the booking
  const { data: booking, error: fetchError } = await supabase
    .from('Bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) {
    console.error("Error fetching booking:", fetchError);
    return;
  }
  
  console.log("Current Booking:", { id: booking.id, customerId: booking.customerId, customerName: booking.customerName });
  
  if (booking.customerId !== 'CUS-1783760257591-612') {
    console.log("Booking is not linked to Don't ID. Current ID:", booking.customerId);
  }

  // 2. Create a new dummy customer for Lee
  const newCustomerId = `CUS-${Date.now()}-${Math.floor(Math.random() * 100)}`;
  const guestCode = `GUEST-${Date.now()}`;
  const now = new Date().toISOString();

  const { error: cusError } = await supabase.from('Customers').insert({
      id: newCustomerId,
      fullName: booking.customerName || 'Lee',
      phone: guestCode,
      email: guestCode,
      createdAt: now,
      updatedAt: now,
  });

  if (cusError) {
    console.error("Error creating new customer:", cusError);
    return;
  }
  console.log("Created new customer:", newCustomerId);

  // 3. Update the booking to link to the new customer
  const { error: updateError } = await supabase
    .from('Bookings')
    .update({ customerId: newCustomerId })
    .eq('id', bookingId);

  if (updateError) {
    console.error("Error updating booking:", updateError);
    return;
  }

  console.log("Successfully unlinked Don and linked to new customer:", newCustomerId);
}

fixBooking();
