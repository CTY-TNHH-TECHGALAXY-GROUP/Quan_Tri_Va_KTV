/**
 * Backfill KTVDTurnLedger từ Bookings.
 *
 *   # xem trước, KHÔNG ghi gì
 *   npx ts-node -O '{"module":"commonjs"}' scripts/backfill_ktvd_turn_ledger.ts 2026-09-01 2026-09-30 --dry-run
 *
 *   # ghi thật
 *   npx ts-node -O '{"module":"commonjs"}' scripts/backfill_ktvd_turn_ledger.ts 2026-09-01 2026-09-30
 *
 * An toàn:
 *   · upsert theo (staff_id, booking_item_id) → chạy lại bao nhiêu lần cũng ra một kết quả
 *   · KHÔNG đè dòng đã `entry_status = 'LOCKED'`
 *   · chỉ ghi vào KTVDTurnLedger, không đụng bảng nào khác
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { computeRows, TurnRow } from '../lib/services/KtvDLedgerEngine';
import { loadContext } from '../lib/services/KtvDLedgerWriter';
import { businessDayRange } from '../lib/business-date';

function loadEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
}

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ';

async function main() {
    const from = process.argv[2] || '2026-09-01';
    const to = process.argv[3] || '2026-09-30';
    const dryRun = process.argv.includes('--dry-run');

    const env = loadEnv();
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Dùng CHUNG bộ nạp cấu hình với cửa ghi thật (KtvDLedgerWriter.loadContext).
    //
    // ⚠️ Trước đây file này chép lại y hệt đoạn dựng configs/services/staffIds.
    // `scripts` bị loại khỏi tsconfig nên TypeScript không bắt được khi
    // TypeDConfigs mọc thêm trường: backfill lặng lẽ chạy với cấu hình thiếu và
    // ghi ra số khác hẳn cửa ghi thật. Đúng lúc thêm `bonusEnabled` /
    // `bonusPerGuest` thì nó đã thiếu thật — backfill sẽ không cộng thưởng nào.
    const { configs, services, staffIds } = await loadContext(sb as any);
    const cutoffHours = configs.cutoffHours;

    console.log(`${dryRun ? '🔍 XEM TRƯỚC (không ghi)' : '✍️  GHI THẬT'}`);
    console.log(`Kỳ ${from} → ${to} | cutoff ${cutoffHours}h | VIP ${vnd(configs.rateVIP)} · PT ${vnd(configs.ratePT)}`);
    console.log(`Thuế áp từ: ${configs.taxEffectiveFrom || '(chưa áp)'}\n`);

    // Nới rộng cửa sổ fetch 1 ngày mỗi đầu: tua ca đêm của ngày `from` có
    // timeStart rơi sang ngày lịch kế tiếp.
    const wide = businessDayRange(from, cutoffHours);
    const wideEnd = businessDayRange(to, cutoffHours);

    let all: any[] = [];
    for (let page = 0; ; page++) {
        const { data, error } = await sb
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
            .range(page * 500, (page + 1) * 500 - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < 500) break;
    }

    const rows = computeRows(all as any, staffIds, services, configs)
        .filter(r => r.work_date >= from && r.work_date <= to);

    console.log(`Bookings quét: ${all.length}  →  dòng sổ cái: ${rows.length}\n`);
    if (rows.length === 0) { console.log('Không có gì để ghi.'); return; }

    // Không đè dòng đã khoá sổ.
    const { data: locked } = await sb
        .from('KTVDTurnLedger')
        .select('staff_id, booking_item_id')
        .eq('entry_status', 'LOCKED')
        .gte('work_date', from).lte('work_date', to);
    const lockedKeys = new Set((locked || []).map((l: any) => `${l.staff_id}|${l.booking_item_id}`));

    const writable = rows.filter(r => !lockedKeys.has(`${r.staff_id}|${r.booking_item_id}`));
    if (lockedKeys.size > 0) {
        console.log(`⏭️  Bỏ qua ${rows.length - writable.length} dòng đã LOCKED\n`);
    }

    // Tổng theo ngày để soi nhanh
    const byDate: Record<string, { n: number; net: number; bonus: number; tax: number; hours: number }> = {};
    for (const r of writable) {
        const d = (byDate[r.work_date] ||= { n: 0, net: 0, bonus: 0, tax: 0, hours: 0 });
        d.n++; d.net += r.commission_net; d.bonus += r.bonus_amount;
        d.tax += r.tax_amount; d.hours += r.actual_minutes / 60;
    }
    console.log('ngày          dòng   tiền tua        thưởng 4★          thuế      thực nhận      giờ');
    console.log('─'.repeat(88));
    for (const [d, v] of Object.entries(byDate).sort()) {
        console.log(`${d}   ${String(v.n).padStart(4)}   ${vnd(v.net).padStart(12)}   ${vnd(v.bonus).padStart(12)}   ${vnd(v.tax).padStart(11)}   ${vnd(v.net + v.bonus - v.tax).padStart(12)}   ${v.hours.toFixed(2).padStart(5)}h`);
    }
    console.log('─'.repeat(88));
    const t = writable.reduce((a, r) => ({
        net: a.net + r.commission_net, bonus: a.bonus + r.bonus_amount, tax: a.tax + r.tax_amount,
    }), { net: 0, bonus: 0, tax: 0 });
    console.log(`TỔNG          ${String(writable.length).padStart(4)}   ${vnd(t.net).padStart(12)}   ${vnd(t.bonus).padStart(12)}   ${vnd(t.tax).padStart(11)}   ${vnd(t.net + t.bonus - t.tax).padStart(12)}
`);

    if (dryRun) { console.log('🔍 Chế độ xem trước — chưa ghi gì vào database.'); return; }

    const payload = writable.map((r: TurnRow) => ({ ...r, source: 'BACKFILL' }));
    let done = 0;
    for (let i = 0; i < payload.length; i += 200) {
        const chunk = payload.slice(i, i + 200);
        const { error } = await sb
            .from('KTVDTurnLedger')
            .upsert(chunk, { onConflict: 'staff_id,booking_item_id' });
        if (error) throw error;
        done += chunk.length;
        console.log(`   ghi ${done}/${payload.length}`);
    }
    console.log(`\n✅ Đã ghi ${done} dòng vào KTVDTurnLedger.`);
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
