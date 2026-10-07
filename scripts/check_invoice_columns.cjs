// Kiểm các cột whitelist của API hoá đơn có thật trong DB (route công khai, một cột lạ = 404 mọi đơn).
// Chạy: node scripts/check_invoice_columns.cjs   (đọc .env.local)
const fs = require('fs'); const path = require('path');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const src = fs.readFileSync(path.join(__dirname, '..', 'app/api/finance/invoice/[id]/route.ts'), 'utf8');
const cols = [...src.matchAll(/const INVOICE_BOOKING_COLUMNS =\s*((?:'[^']*'\s*\+?\s*)+);/g)][0][1]
  .match(/'[^']*'/g).map(s => s.slice(1, -1)).join('').split(',').map(s => s.trim()).filter(Boolean);
const key = process.env.SUPABASE_SECRET_KEY; const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const H = { apikey: key, Authorization: `Bearer ${key}` };
(async () => {
  let ok = true;
  for (const [label, q] of [
    [`Bookings select ${cols.length} cột`, `Bookings?select=${cols.join(',')}&limit=1`],
    ['Bookings đơn con (id,totalAmount)', 'Bookings?select=id,totalAmount&parent_booking_id=not.is.null&limit=1'],
    ['SystemConfigs invoice_config', 'SystemConfigs?select=value&key=eq.invoice_config'],
  ]) {
    const r = await fetch(`${base}/${q}`, { headers: H });
    console.log(`${r.status === 200 ? '✅' : '❌'} ${label} -> HTTP ${r.status}`);
    if (r.status !== 200) { ok = false; console.error(await r.text()); }
  }
  process.exit(ok ? 0 : 1);
})();
