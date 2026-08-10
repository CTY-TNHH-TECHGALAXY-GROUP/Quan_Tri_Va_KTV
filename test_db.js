const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  const { data: b } = await supabase.from('Bookings').select('id, billCode').eq('billCode', '003-10082026').single();
  const { data: items } = await supabase.from('BookingItems').select('id, serviceId, status, segments, technicianCodes').eq('bookingId', b.id);
  const { data: svcs } = await supabase.from('Services').select('id, code, nameVN, duration').in('id', items.map(i => i.serviceId));
  const { data: svcs2 } = await supabase.from('Services').select('id, code, nameVN, duration').in('code', items.map(i => i.serviceId));
  
  for (const i of items) {
     const s = svcs.find(x => x.id === i.serviceId || x.code === i.serviceId) || svcs2.find(x => x.id === i.serviceId || x.code === i.serviceId);
     console.log(`- Item ${i.id}: ${s ? s.nameVN : i.serviceId} (${s ? s.duration : '?'}p)`);
     console.log(`  KTV: ${i.technicianCodes}`);
     const segs = Array.isArray(i.segments) ? i.segments : JSON.parse(i.segments || '[]');
     console.log(`  Segs:`, segs.map(s => `${s.ktvId}: ${s.duration}p`));
  }
}
fix();
