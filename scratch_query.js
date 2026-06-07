const fs = require('fs');
const fileContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
fileContent.split(/\r?\n/).forEach(line => {
  const eqIdx = line.indexOf('=');
  if (eqIdx !== -1) {
    const key = line.substring(0, eqIdx).trim();
    let val = line.substring(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.substring(1, val.length - 1);
    }
    env[key] = val;
  }
});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkBooking011Details() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: env.DIRECT_URL });
  await client.connect();

  console.log('--- Querying Booking 11NDK-011-06062026 details ---');
  const res = await client.query(`
    SELECT id, "bookingId", "serviceId", "technicianCodes", "itemRating", "ktvRatings", segments
    FROM "BookingItems"
    WHERE "bookingId" = '11NDK-011-06062026';
  `);
  
  res.rows.forEach(r => {
    console.log(`Item: ${r.id}`);
    console.log(`  Techs: ${JSON.stringify(r.technicianCodes)}`);
    console.log(`  ktvRatings: ${JSON.stringify(r.ktvRatings)}`);
    console.log(`  itemRating: ${r.itemRating}`);
    console.log(`  Segments: ${r.segments}`);
  });

  await client.end();
}

checkBooking011Details().catch(console.error);
