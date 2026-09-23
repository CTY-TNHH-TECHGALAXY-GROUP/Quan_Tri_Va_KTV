/**
 * Đối chiếu KtvDLedgerEngine với KTVDailyLedger đang chạy.
 *
 * CHỈ ĐỌC — không ghi gì vào DB.
 * Dùng ở bước 3 để chốt từng chênh lệch trước khi backfill KTVDTurnLedger.
 *
 *   npx ts-node -O '{"module":"commonjs"}' scripts/audit_ktvd_ledger_engine.ts [từ-ngày] [đến-ngày]
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { computeRows, TypeDConfigs, EngineService } from '../lib/services/KtvDLedgerEngine';
import { getDayCutoffHours, businessDayRange } from '../lib/business-date';

function loadEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const file = path.join(process.cwd(), '.env.local');
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
}

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ';

async function main() {
    const from = process.argv[2] || '2026-09-01';
    const to = process.argv[3] || '2026-09-30';

    const env = loadEnv();
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    const cutoffHours = await getDayCutoffHours(sb as any);

    const { data: cfgRows } = await sb.from('SystemConfigs').select('key, value');
    const cfg: Record<string, any> = {};
    (cfgRows || []).forEach((c: any) => {
        let v = c.value;
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* giữ nguyên */ } }
        cfg[c.key] = v;
    });

    const configs: TypeDConfigs = {
        rateVIP: Number(cfg['ktv_type_d_vip_rate_per_60m']) || 180000,
        ratePT: Number(cfg['ktv_type_d_pt_rate_per_60m']) || 100000,
        ratingDeductions: cfg['ktv_type_d_rating_deduction'] || { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 },
        cutoffHours,
        taxRate: 0.1,
        taxEffectiveFrom: null, // ledger lưu số TRƯỚC thuế → so cũng phải trước thuế
    };

    console.log(`Kỳ: ${from} → ${to}   |   cutoff = ${cutoffHours}h`);
    console.log(`Đơn giá: VIP ${vnd(configs.rateVIP)} · PT ${vnd(configs.ratePT)} / 60 phút`);
    console.log(`Trừ theo sao: ${JSON.stringify(configs.ratingDeductions)}\n`);

    const { data: staff } = await sb.from('Staff').select('id').eq('work_type', 'TYPE_D');
    const staffIds = (staff || []).map((s: any) => s.id);

    const { data: svc } = await sb.from('Services').select('id, code, nameVN, is_utility');
    const services: Record<string, EngineService> = {};
    (svc || []).forEach((s: any) => {
        const e = { nameVN: s.nameVN, code: s.code, is_utility: !!s.is_utility };
        if (s.id) services[String(s.id)] = e;
        if (s.code) services[String(s.code)] = e;
    });

    // Lấy rộng hơn 1 ngày mỗi đầu để không cắt mất tua ca đêm ở biên.
    const wide = businessDayRange(from, cutoffHours);
    const wideEnd = businessDayRange(to, cutoffHours);

    const { data: bookings } = await sb
        .from('Bookings')
        .select(`
            id, billCode, timeStart, status, rating,
            BookingItems!fk_bookingitems_booking (
                id, serviceId, guest_id, technicianCodes, segments, status, tip,
                itemRating, ktvRatings, options, handover_status, handover_comment
            ),
            BookingGuests ( id, rating, ktv_ratings )
        `)
        .gte('timeStart', wide.startIso)
        .lt('timeStart', wideEnd.endIso)
        .neq('status', 'CANCELLED')
        .limit(5000);

    const rows = computeRows((bookings || []) as any, staffIds, services, configs);
    const inRange = rows.filter(r => r.work_date >= from && r.work_date <= to);

    // ── Engine gộp theo (KTV, ngày) ─────────────────────────────────
    const eng: Record<string, number> = {};
    const engHours: Record<string, number> = {};
    for (const r of inRange) {
        const k = `${r.work_date}|${r.staff_id}`;
        eng[k] = (eng[k] || 0) + r.commission_net;
        engHours[k] = (engHours[k] || 0) + r.actual_minutes / 60;
    }

    // ── Sổ cái đang chạy ────────────────────────────────────────────
    const { data: ledger } = await sb
        .from('KTVDailyLedger')
        .select('date, staff_id, total_commission')
        .eq('work_type_snapshot', 'TYPE_D')
        .gte('date', from).lte('date', to);

    const led: Record<string, number> = {};
    for (const l of ledger || []) led[`${l.date}|${l.staff_id}`] = Number(l.total_commission || 0);

    const keys = [...new Set([...Object.keys(eng), ...Object.keys(led)])].sort();

    console.log(`Dòng engine sinh ra: ${inRange.length}  |  ô (KTV × ngày) so sánh: ${keys.length}\n`);
    console.log('ngày         KTV     sổ cũ           engine          chênh');
    console.log('─'.repeat(66));

    let sumLed = 0, sumEng = 0, diffCells = 0;
    for (const k of keys) {
        const [d, s] = k.split('|');
        const a = led[k] || 0, b = eng[k] || 0, diff = b - a;
        sumLed += a; sumEng += b;
        if (Math.abs(diff) >= 1) diffCells++;
        const mark = Math.abs(diff) < 1 ? '' : (diff > 0 ? '  ▲' : '  ▼');
        console.log(
            `${d}   ${s.padEnd(6)}  ${vnd(a).padStart(13)}  ${vnd(b).padStart(13)}  ${(diff ? vnd(diff) : '—').padStart(12)}${mark}`
        );
    }

    console.log('─'.repeat(66));
    console.log(`TỔNG           ${vnd(sumLed).padStart(13)}  ${vnd(sumEng).padStart(13)}  ${vnd(sumEng - sumLed).padStart(12)}`);
    console.log(`\nSố ô lệch: ${diffCells}/${keys.length}`);

    // ── Vì sao lệch ─────────────────────────────────────────────────
    const bySource: Record<string, number> = {};
    for (const r of inRange) bySource[r.rating_source] = (bySource[r.rating_source] || 0) + 1;
    console.log('\nNguồn sao engine dùng (sổ cũ luôn dùng Bookings.rating):');
    for (const [k, v] of Object.entries(bySource)) console.log(`   ${k.padEnd(10)} ${v} dòng`);

    console.log('\nGiờ tích lũy engine tính (dùng actual_minutes):');
    const byStaff: Record<string, number> = {};
    for (const [k, v] of Object.entries(engHours)) {
        const s = k.split('|')[1];
        byStaff[s] = (byStaff[s] || 0) + v;
    }
    for (const [s, h] of Object.entries(byStaff).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${s.padEnd(6)} ${h.toFixed(2)}h`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
