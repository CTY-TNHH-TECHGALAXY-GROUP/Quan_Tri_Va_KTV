/**
 * QA #20 — Hồ sơ khách ở "Tạo đơn nhanh" (Dispatch) & cờ VAT một nguồn.
 *
 * Bối cảnh: từ 22/08 đến 06/10/2026, INSERT `Customers` kèm cột không tồn tại (`vatRequested`)
 * bị nuốt im lặng → mọi khách vãng lai mới không có hồ sơ CRM; nút "Hồ sơ" (i) lột số SĐT giả
 * `GUEST-…` nên tìm trượt. Kịch bản này mô phỏng service bằng DB giả (in-memory), KHÔNG chạm DB.
 *
 *   C1. Khách mới, không liên hệ → tạo hồ sơ `GUEST-<ts>` / `guest<ts>@guest.com`, có customerId, không VAT.
 *   C2. Quầy chọn hồ sơ cũ chỉ có SĐT GUEST- (truyền customerId) → dùng đúng id, không INSERT.
 *   C3. Gõ tay SĐT GUEST- trùng hồ sơ có sẵn, không customerId → khớp exact, không tạo trùng.
 *   C4. INSERT lỗi (giả lập) → customerId null + warning CUSTOMER_NOT_CREATED, không ném lỗi.
 *   C5. VAT: khách mới kèm MST → 5 cột công ty vào hồ sơ; khách cũ kèm MST → UPDATE hồ sơ;
 *       nhãn VAT (hasVatBadge) chỉ theo taxCode — không có cờ theo đơn.
 *   C6. customerId gửi lên không tồn tại → warning CUSTOMER_NOT_FOUND, vẫn tìm/tạo theo SĐT.
 *   C7. Nút "Hồ sơ": SĐT GUEST- không được lột số; SĐT thật vẫn chuẩn hoá như cũ.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_20_quick_booking_customer.ts
 * Nên chạy thêm dưới TZ=UTC.
 */
import {
    resolveQuickBookingCustomer,
    CUSTOMER_NOT_CREATED,
    CUSTOMER_NOT_FOUND,
} from '@/lib/services/QuickBookingCustomerService';
import { hasVatBadge, normalizeTaxCode, normalizeVatInvoice } from '@/lib/services/CustomerVatService';
import { isGuestPlaceholderPhone } from '@/lib/customer.logic';
import { phoneIdentity } from '@/lib/customer-search';
import { finish, fatal } from './_exit';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

/** DB giả: chỉ bảng Customers, đủ các lời gọi service dùng (select/eq/limit, insert, update/eq). */
function mockDb(seed: Record<string, any>[], opts: { failInsert?: boolean } = {}) {
    const rows = seed.map(r => ({ ...r }));
    const inserts: any[] = [];
    const updates: { id: string; patch: any }[] = [];
    const from = (table: string) => {
        if (table !== 'Customers') throw new Error(`unexpected table ${table}`);
        const filters: [string, any][] = [];
        const q: any = {
            select: () => q,
            eq: (col: string, val: any) => { filters.push([col, val]); return q; },
            limit: (n: number) => Promise.resolve({ data: rows.filter(r => filters.every(([c, v]) => r[c] === v)).slice(0, n), error: null }),
            insert: (row: any) => {
                if (opts.failInsert) return Promise.resolve({ error: { message: "Could not find the 'vatRequested' column of 'Customers' in the schema cache" } });
                inserts.push(row); rows.push(row);
                return Promise.resolve({ error: null });
            },
            update: (patch: any) => ({
                eq: (col: string, val: any) => {
                    rows.filter(r => r[col] === val).forEach(r => Object.assign(r, patch));
                    updates.push({ id: val, patch });
                    return Promise.resolve({ error: null });
                },
            }),
        };
        return q;
    };
    return { db: { from }, rows, inserts, updates };
}

const WRB_GUEST = { id: 'CUS-7D4tvTgDZOHDjTHT', fullName: 'Mark', phone: 'GUEST-11NDK-010-05102026', email: 'mark@example.com', nationality: null, taxCode: null };
const REAL_PHONE = { id: 'CUS-1779533014820-498', fullName: 'Kim', phone: '+84987654321', email: 'kim@example.com', nationality: 'Hàn Quốc', taxCode: null };

async function main() {
    console.log('\n=== C1. Khách mới, không liên hệ ===');
    {
        const m = mockDb([WRB_GUEST]);
        const r = await resolveQuickBookingCustomer(m.db, { customerName: 'Danny', customerPhone: '', customerEmail: '' });
        check(!!r.customerId && r.created, 'tạo hồ sơ mới, có customerId', r.customerId || 'null');
        check(m.inserts.length === 1 && /^GUEST-\d+$/.test(m.inserts[0].phone), 'SĐT giả GUEST-<ts>', m.inserts[0]?.phone);
        check(/^guest\d+@guest\.com$/.test(m.inserts[0]?.email), 'email giả guest<ts>@guest.com', m.inserts[0]?.email);
        check(!('vatRequested' in (m.inserts[0] || {})), 'KHÔNG còn cột vatRequested trong INSERT Customers');
        check(r.vat === null && !r.warning, 'không VAT, không warning');
    }

    console.log('\n=== C2. Chọn hồ sơ cũ chỉ có SĐT GUEST- (truyền customerId) ===');
    {
        const m = mockDb([WRB_GUEST]);
        const r = await resolveQuickBookingCustomer(m.db, { customerId: WRB_GUEST.id, customerName: 'Mark', customerPhone: '', customerEmail: '' });
        check(r.customerId === WRB_GUEST.id && !r.created, 'dùng đúng id đã chọn', r.customerId || 'null');
        check(m.inserts.length === 0, 'không INSERT hồ sơ mới');
        check(m.updates.length === 0, 'không có gì để lấp → không UPDATE');
    }

    console.log('\n=== C3. Gõ tay SĐT GUEST- trùng hồ sơ có sẵn, không customerId ===');
    {
        const m = mockDb([WRB_GUEST]);
        const r = await resolveQuickBookingCustomer(m.db, { customerName: 'Mark', customerPhone: 'GUEST-11NDK-010-05102026', customerEmail: '' });
        check(r.customerId === WRB_GUEST.id, 'khớp exact theo chuỗi GUEST-… gốc', r.customerId || 'null');
        check(m.inserts.length === 0, 'không tạo trùng');
    }

    console.log('\n=== C4. INSERT lỗi → đơn vẫn tạo, có warning ===');
    {
        const m = mockDb([], { failInsert: true });
        const r = await resolveQuickBookingCustomer(m.db, { customerName: 'Lee', customerPhone: '', customerEmail: '' });
        check(r.customerId === null, 'customerId null');
        check(r.warning === CUSTOMER_NOT_CREATED, 'warning CUSTOMER_NOT_CREATED', r.warning);
    }

    console.log('\n=== C5. VAT một nguồn ===');
    {
        const vatInput = { taxCode: '0316794479', companyName: 'CÔNG TY TNHH ORIA', companyAddress: 'Q1, HCM', companyEmail: 'KeToan@Oria.vn', companyPhone: '028 1234 5678' };
        const m = mockDb([]);
        const r = await resolveQuickBookingCustomer(m.db, { customerName: 'Anh', customerPhone: '+84911222333', customerEmail: '', vatInvoice: vatInput });
        const row = m.inserts[0] || {};
        check(row.taxCode === '0316794479' && row.companyName === 'CÔNG TY TNHH ORIA' && row.companyEmail === 'ketoan@oria.vn', 'khách mới: 5 cột công ty ghi vào Customers (email thường hoá)', JSON.stringify({ taxCode: row.taxCode, companyEmail: row.companyEmail }));

        const m2 = mockDb([REAL_PHONE]);
        const r2 = await resolveQuickBookingCustomer(m2.db, { customerName: 'Kim', customerPhone: '+84987654321', customerEmail: '', vatInvoice: { taxCode: '0316794479-001', companyName: 'CN HCM' } });
        check(r2.customerId === REAL_PHONE.id && m2.updates.length === 1 && m2.updates[0].patch.taxCode === '0316794479-001', 'khách cũ: UPDATE 5 cột VAT lên hồ sơ', JSON.stringify(m2.updates[0]?.patch.taxCode));

        check(normalizeTaxCode(' 0316 794 479 ') === '0316794479' && normalizeTaxCode('0316794479001') === '0316794479-001' && normalizeTaxCode('12345') === null, 'chuẩn hoá MST 10 / 10-3, sai → null');
        check(normalizeVatInvoice({ taxCode: '', companyName: 'X' }) === null, 'không MST → không ghi gì vào Customers');
        check(hasVatBadge('0316794479') && !hasVatBadge('') && !hasVatBadge(null) && !hasVatBadge('  '), 'hasVatBadge chỉ theo taxCode');
    }

    console.log('\n=== C6. customerId gửi lên không tồn tại ===');
    {
        const m = mockDb([REAL_PHONE]);
        const r = await resolveQuickBookingCustomer(m.db, { customerId: 'CUS-DA-XOA', customerName: 'Kim', customerPhone: '+84987654321', customerEmail: '' });
        check(r.warning === CUSTOMER_NOT_FOUND, 'warning CUSTOMER_NOT_FOUND', r.warning);
        check(r.customerId === REAL_PHONE.id, 'vẫn khớp theo SĐT thật', r.customerId || 'null');
    }

    console.log('\n=== C7. Nút "Hồ sơ": SĐT GUEST- không lột số ===');
    {
        const guest = 'GUEST-1791272255378';
        check(isGuestPlaceholderPhone(guest) && isGuestPlaceholderPhone(' guest-11NDK-006-02102026 '), 'nhận diện GUEST- (không phân biệt hoa thường, có khoảng trắng)');
        check(!isGuestPlaceholderPhone('+84877278157') && !isGuestPlaceholderPhone(''), 'SĐT thật / rỗng không bị coi là GUEST-');
        // Trước đây: phoneIdentity('GUEST-1791272255378') === '1791272255378' → tìm trượt. Nay nhánh GUEST- đi exact, không qua phoneIdentity.
        const contact = isGuestPlaceholderPhone(guest) ? guest : phoneIdentity(guest);
        check(contact === guest, 'chuỗi tìm kiếm giữ nguyên GUEST-…', contact);
        check(phoneIdentity('+84 877 278 157') === '0877278157', 'SĐT thật vẫn chuẩn hoá như cũ');
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG'} — ${failures} loi (TZ=${process.env.TZ || 'local'}) ===`);
    finish(failures);
}

main().catch(fatal);
