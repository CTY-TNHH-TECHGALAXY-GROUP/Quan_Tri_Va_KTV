/** TEST only: drain the Type D recompute for DEMO5LANG demo orders (prod cron does this) and print the ledger. */
import fs from 'node:fs';
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
Object.assign(process.env, env);
const { recomputeTurnRows } = require('@/lib/services/KtvDLedgerWriter');
const { getSupabaseAdmin } = require('@/lib/supabaseAdmin');
(async () => {
  const db = new Client({ connectionString: env.DATABASE_URL }); await db.connect();
  const items = (await db.query(`select id from "BookingItems" where "bookingId" like 'DEMO5LANG%' and "itemRating" is not null`)).rows.map((r: any) => r.id);
  if (items.length) await recomputeTurnRows(getSupabaseAdmin(), items);
  const rows = (await db.query(`select booking_item_id, rating_used, rating_scale, deduction_rate, commission_gross, commission_net, bonus_amount from "KTVDTurnLedger" where staff_id='DEMO5LANG-KTV' order by booking_item_id`)).rows;
  const vnd = (x: any) => Math.round(Number(x)).toLocaleString('vi-VN') + 'đ';
  for (const r of rows) console.log(`${r.booking_item_id} | ${r.rating_used}/${r.rating_scale} sao | trừ ${Math.round(r.deduction_rate * 100)}% | gốc ${vnd(r.commission_gross)} → ${vnd(r.commission_net)} | thưởng ${vnd(r.bonus_amount)}`);
  const notes = (await db.query(`select type, message from "StaffNotifications" where "bookingId" like 'DEMO5LANG%' order by "createdAt"`)).rows;
  for (const n of notes) console.log(`  [${n.type}] ${n.message}`);
  await db.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
