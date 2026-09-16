const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: booking } = await supabase.from('Bookings').select('id, billCode, status, notes').eq('billCode', '010-13052026').single();
  if (!booking) { console.log('NOT FOUND'); return; }
  console.log('=== BOOKING ===');
  console.log('ID:', booking.id, '| Status:', booking.status);
  console.log('Notes:', booking.notes);
  
  const { data: items } = await supabase.from('BookingItems').select('id, serviceId, technicianCodes, segments, options, status, customerNote').eq('bookingId', booking.id).order('id');
  console.log('');
  console.log('=== BOOKING ITEMS (Custom fields) ===');
  (items || []).forEach((item, i) => {
    const opts = item.options || {};
    console.log('');
    console.log('Item ' + (i+1) + ': ' + item.serviceId);
    console.log('  displayName:', opts.displayName || 'N/A');
    console.log('  therapist (gender):', opts.therapist || 'N/A');
    console.log('  strength:', opts.strength || 'N/A');
    console.log('  focus:', JSON.stringify(opts.focus) || 'N/A');
    console.log('  avoid:', JSON.stringify(opts.avoid) || 'N/A');
    console.log('  note:', opts.note || 'N/A');
    console.log('  noteForKtv:', opts.noteForKtv || 'N/A');
    console.log('  notesForKtvs:', JSON.stringify(opts.notesForKtvs) || 'N/A');
    console.log('  customerNote:', item.customerNote || 'N/A');
    console.log('  KTVs:', JSON.stringify(item.technicianCodes));
    
    let segs = [];
    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
    segs.forEach((s, si) => {
      console.log('  Seg' + si + ': ktvId=' + s.ktvId + ' start=' + s.startTime + ' end=' + s.endTime);
    });
  });
})();
