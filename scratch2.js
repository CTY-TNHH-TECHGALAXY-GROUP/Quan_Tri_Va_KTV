require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const bookingId = '11NDK-012-16082026';
  const { data: booking } = await supabase.from('Bookings').select('*').eq('id', bookingId).single();
  
  // Try to find items for this booking OR any of its sub-bookings
  const { data: childBookings } = await supabase.from('Bookings').select('id').eq('parent_booking_id', bookingId);
  const childBookingIds = (childBookings || []).map(b => b.id);
  const allBookingIds = [bookingId, ...childBookingIds];
  
  const { data: items } = await supabase.from('BookingItems').select('*').in('bookingId', allBookingIds);
  console.log('Found items from child bookings:', items?.length);
  
  let enrichedItems = items || [];
  if (enrichedItems.length > 0) {
      const serviceIds = enrichedItems.map(i => i.serviceId).filter(Boolean);
      const { data: svcs, error: svError } = await supabase
          .from('Services')
          .select('id, code, nameVN, nameEN, priceVND, duration')
          .in('id', serviceIds);

      if (!svError && svcs) {
          const svcMap = new Map();
          svcs.forEach((s) => {
              if (s.id) svcMap.set(String(s.id).trim().toLowerCase(), s);
              if (s.code) svcMap.set(String(s.code).trim().toLowerCase(), s);
          });
          
          enrichedItems = enrichedItems.map(i => {
              const sId = String(i.serviceId || '').trim().toLowerCase();
              const svc = svcMap.get(sId);
              
              const getName = () => {
                  const n = svc?.nameVN || svc?.nameEN || svc?.name;
                  if (typeof n === 'object' && n !== null) return n.vn || n.en || String(n);
                  return n || `Dịch vụ ${i.serviceId || 'Chưa rõ'}`;
              };

              return {
                  ...i,
                  serviceName: getName(),
                  originalPrice: svc?.priceVND || i.price,
                  duration: i.duration || svc?.duration || 60
              };
          });
      }
  }

  const result = {
      ...booking,
      items: enrichedItems
  };
  console.log('Result items length:', result.items.length);
  console.log('Booking details:', { 
      totalAmount: booking.totalAmount, 
      source: booking.source, 
      status: booking.status,
      parent_booking_id: booking.parent_booking_id
  });
  console.log('billCode:', result.billCode);
}
check();
