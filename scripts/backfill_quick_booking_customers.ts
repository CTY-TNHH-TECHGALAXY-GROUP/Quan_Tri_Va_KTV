/**
 * Backfill `Bookings.customerId` cho các đơn tạo nhanh (NDK-*) bị mất hồ sơ khách
 * từ 22/08/2026 (INSERT Customers kèm cột không tồn tại bị nuốt im lặng).
 *
 * Mặc định CHỈ ĐỌC (dry-run): in bảng từng nhóm đơn (đơn cha + đơn con) và hành động dự kiến.
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/backfill_quick_booking_customers.ts
 * Ghi thật:
 *   ... scripts/backfill_quick_booking_customers.ts --apply
 *
 * Khi --apply:
 *   - Nhóm có MANUAL_LINKS → gán thẳng id đó.
 *   - Nhóm AMBIGUOUS (≥2 hồ sơ trùng liên hệ) → BỎ QUA, in ra để đối soát tay.
 *   - Nhóm còn lại → `resolveQuickBookingCustomer` (đúng thứ tự khớp/tạo của service thật).
 *   - Chỉ UPDATE cột `customerId`; không đụng customerPhone/customerEmail.
 *   - Lưu before/after vào scripts/backfill_output/quick_booking_customers_<ts>.json để lùi.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { isDummyPhone, isDummyEmail, isGuestPlaceholderPhone } from '@/lib/customer.logic';
import { resolveQuickBookingCustomer } from '@/lib/services/QuickBookingCustomerService';

// 🔧 CONFIGURATION
const SINCE = '2026-08-22T00:00:00';
/** Đơn → hồ sơ đã đối soát tay (hồ sơ đổi SĐT sau khi đơn được tạo nên không còn khớp tự động). */
const MANUAL_LINKS: Record<string, string> = {
    'NDK-002-06102026': 'CUS-1791272255378-197', // Danny — hồ sơ đổi SĐT thật lúc 08:08 06/10
};

type BookingRow = { id: string; status: string; customerName: string | null; customerPhone: string | null; customerEmail: string | null; nationality: string | null; parent_booking_id: string | null; createdAt: string };
type Plan = { key: string; ids: string[]; name: string; phone: string; email: string; nationality: string | null; action: 'MANUAL' | 'LINK' | 'LINK_GUEST' | 'CREATE' | 'AMBIGUOUS' | 'MANUAL_NEEDED'; target?: string; note?: string };

function loadEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i < 1 || line.startsWith('#')) continue;
        env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return env;
}

const stripSuffix = (name: string | null) => (name || 'Khách vãng lai').replace(/\s*-\s*Khách\s+[A-Z]$/i, '').trim();

async function main() {
    const apply = process.argv.includes('--apply');
    const env = loadEnv();
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    const { data, error } = await sb.from('Bookings')
        .select('id, status, customerName, customerPhone, customerEmail, nationality, parent_booking_id, createdAt')
        .like('id', 'NDK-%').is('customerId', null).gte('createdAt', SINCE).neq('status', 'CANCELLED')
        .order('createdAt', { ascending: true });
    if (error) throw error;
    const rows = (data || []) as BookingRow[];

    // Gom theo đơn gốc: đơn con đi theo cha để cả cây cùng một customerId.
    const groups = new Map<string, BookingRow[]>();
    for (const r of rows) {
        const key = r.parent_booking_id || r.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
    }

    const plans: Plan[] = [];
    for (const [key, members] of groups) {
        const rep = members.find(m => !m.parent_booking_id) || members[0];
        const phone = (rep.customerPhone || '').trim();
        const email = (rep.customerEmail || '').trim().toLowerCase();
        const base: Omit<Plan, 'action'> = { key, ids: members.map(m => m.id), name: stripSuffix(rep.customerName), phone, email, nationality: rep.nationality };

        if (MANUAL_LINKS[key]) { plans.push({ ...base, action: 'MANUAL', target: MANUAL_LINKS[key] }); continue; }

        const realPhone = phone && !isDummyPhone(phone) && !isGuestPlaceholderPhone(phone);
        const realEmail = !isDummyEmail(email);
        let matches: { id: string }[] = [];
        if (realPhone) {
            const { data: m } = await sb.from('Customers').select('id').eq('phone', phone).limit(2);
            matches = m || [];
        }
        if (!matches.length && isGuestPlaceholderPhone(phone)) {
            const { data: m } = await sb.from('Customers').select('id').eq('phone', phone).limit(2);
            matches = m || [];
            if (matches.length === 1) { plans.push({ ...base, action: 'LINK_GUEST', target: matches[0].id }); continue; }
            if (!matches.length && !realEmail) { plans.push({ ...base, action: 'MANUAL_NEEDED', note: 'hồ sơ GUEST- gốc đã đổi SĐT hoặc không còn' }); continue; }
        }
        if (!matches.length && realEmail) {
            const { data: m } = await sb.from('Customers').select('id').ilike('email', email.replace(/[\\%_]/g, '\\$&')).limit(2);
            matches = m || [];
        }
        if (matches.length > 1) { plans.push({ ...base, action: 'AMBIGUOUS', note: matches.map(m => m.id).join(', ') }); continue; }
        if (matches.length === 1) { plans.push({ ...base, action: 'LINK', target: matches[0].id }); continue; }
        plans.push({ ...base, action: 'CREATE' });
    }

    console.log(`\n${apply ? '*** APPLY ***' : '--- DRY RUN ---'}  đơn: ${rows.length}, nhóm: ${plans.length}`);
    console.table(plans.map(p => ({ nhom: p.key, so_don: p.ids.length, ten: p.name, phone: p.phone, email: p.email, hanh_dong: p.action, ho_so: p.target || p.note || '' })));
    const counts = plans.reduce((acc, p) => { acc[p.action] = (acc[p.action] || 0) + 1; return acc; }, {} as Record<string, number>);
    console.log('Tổng theo hành động:', counts);

    if (!apply) { console.log('\nChưa ghi gì. Thêm --apply để thực hiện.'); return; }

    const out: { before: { id: string; customerId: null }[]; after: { id: string; customerId: string }[]; created: string[]; skipped: Plan[] } = { before: [], after: [], created: [], skipped: [] };
    for (const p of plans) {
        let target = p.target || null;
        if (p.action === 'AMBIGUOUS' || p.action === 'MANUAL_NEEDED') { out.skipped.push(p); continue; }
        if (!target) {
            const r = await resolveQuickBookingCustomer(sb, { customerName: p.name, customerPhone: p.phone, customerEmail: p.email, nationality: p.nationality });
            if (!r.customerId) { out.skipped.push({ ...p, note: r.warning }); continue; }
            target = r.customerId;
            if (r.created) out.created.push(target);
        }
        const { error: uErr } = await sb.from('Bookings').update({ customerId: target }).in('id', p.ids);
        if (uErr) { out.skipped.push({ ...p, note: uErr.message }); continue; }
        p.ids.forEach(id => { out.before.push({ id, customerId: null }); out.after.push({ id, customerId: target! }); });
        console.log(`  ✔ ${p.key} (${p.ids.length} đơn) → ${target}${out.created.includes(target) ? ' (mới)' : ''}`);
    }
    const dir = path.join(process.cwd(), 'scripts', 'backfill_output');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `quick_booking_customers_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\nĐã ghi ${out.after.length} đơn, tạo ${out.created.length} hồ sơ, bỏ qua ${out.skipped.length} nhóm. File lùi: ${file}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
