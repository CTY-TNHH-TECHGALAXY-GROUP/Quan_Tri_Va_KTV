/**
 * QuickBookingCustomerService — tìm hoặc tạo hồ sơ `Customers` cho đơn tạo nhanh ở bảng điều phối.
 *
 * Thứ tự khớp (dừng ở bước đầu tiên có kết quả):
 *   1. `customerId` quầy đã chọn trong ô gợi ý → dùng thẳng (kể cả hồ sơ chỉ có SĐT `GUEST-…`).
 *   2. SĐT thật → `Customers.phone` exact.
 *   3. SĐT giả `GUEST-…` (hồ sơ do WRB / WebBooking sinh) → exact theo chuỗi nguyên bản,
 *      KHÔNG lột số. Trước đây nhánh này bị bỏ qua nên tạo trùng hoặc rơi vào lỗi.
 *   4. Email thật → `Customers.email` exact.
 *   5. Không có gì → tạo hồ sơ mới `CUS-<ts>-<n>` với SĐT/email giả như khách vãng lai.
 *
 * Lỗi tạo hồ sơ KHÔNG chặn tạo đơn nhưng phải trả `warning` để UI nói với quầy.
 * Bài học 22/08–06/10/2026: INSERT kèm cột không tồn tại (`vatRequested`) bị nuốt im lặng,
 * mọi khách vãng lai mới trong 6 tuần không có hồ sơ CRM mà không ai biết.
 *
 * Hàm nhận `db` từ ngoài để mô phỏng được bằng mock (scripts/qa/qa_20_quick_booking_customer.ts).
 */
import { isDummyPhone, isDummyEmail, isGuestPlaceholderPhone, GUEST_PHONE_PREFIX } from '@/lib/customer.logic';
import { normalizeVatInvoice, type VatInvoiceInput, type VatCustomerColumns } from './CustomerVatService';

/** Đơn đã tạo nhưng hồ sơ khách không tạo được (lỗi DB). */
export const CUSTOMER_NOT_CREATED = 'CUSTOMER_NOT_CREATED';
/** `customerId` quầy gửi lên không còn tồn tại; đã rơi về tìm/tạo theo SĐT/email. */
export const CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND';

export type QuickBookingCustomerWarning = typeof CUSTOMER_NOT_CREATED | typeof CUSTOMER_NOT_FOUND;

export interface QuickBookingCustomerInput {
    customerId?: string | null;
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    nationality?: string | null;
    vatInvoice?: VatInvoiceInput | null;
}

export interface QuickBookingCustomerResult {
    customerId: string | null;
    created: boolean;
    /** SĐT / email đã làm sạch (rỗng nếu là giá trị ảo). */
    phone: string;
    email: string;
    vat: VatCustomerColumns | null;
    warning?: QuickBookingCustomerWarning;
}

/** Chỉ cần `.from()` để mock được; client thật của Supabase thoả mãn. */
export interface CustomerDb {
    from(table: string): any;
}

interface CustomerRow {
    id: string;
    phone: string | null;
    email: string | null;
    nationality: string | null;
    taxCode: string | null;
}

const CUSTOMER_SELECT = 'id, phone, email, nationality, taxCode';

/** Ép SĐT/email ảo thành rỗng (toàn số 0, 'aa', không có @) — giữ nguyên hành vi cũ. */
export function cleanQuickBookingContact(phoneRaw?: string | null, emailRaw?: string | null): { phone: string; email: string } {
    let phone = (phoneRaw || '').trim();
    let email = (emailRaw || '').trim();
    const lowerEmail = email.toLowerCase();
    if (lowerEmail === 'aa' || lowerEmail === 'a' || (email && !email.includes('@'))) email = '';
    if (/^0+$/.test(phone)) phone = '';
    return { phone, email };
}

async function findOne(db: CustomerDb, column: 'id' | 'phone' | 'email', value: string): Promise<CustomerRow | null> {
    const { data, error } = await db.from('Customers').select(CUSTOMER_SELECT).eq(column, value).limit(1);
    if (error) {
        console.warn(`⚠️ [QuickBookingCustomer] lookup ${column} failed:`, error.message);
        return null;
    }
    return (data && data[0]) || null;
}

export async function resolveQuickBookingCustomer(db: CustomerDb, input: QuickBookingCustomerInput): Promise<QuickBookingCustomerResult> {
    const { phone, email } = cleanQuickBookingContact(input.customerPhone, input.customerEmail);
    const vat = normalizeVatInvoice(input.vatInvoice);
    const guestPhone = isGuestPlaceholderPhone(phone);
    const realPhone = !!phone && !guestPhone && !isDummyPhone(phone);
    const realEmail = !isDummyEmail(email);
    let warning: QuickBookingCustomerWarning | undefined;

    let existing: CustomerRow | null = null;

    // 1. Quầy đã chọn hồ sơ trong ô gợi ý
    const knownId = (input.customerId || '').trim();
    if (knownId) {
        existing = await findOne(db, 'id', knownId);
        if (!existing) warning = CUSTOMER_NOT_FOUND;
    }
    // 2. SĐT thật
    if (!existing && realPhone) existing = await findOne(db, 'phone', phone);
    // 3. SĐT giả GUEST-… → exact theo chuỗi gốc
    if (!existing && guestPhone) existing = await findOne(db, 'phone', phone);
    // 4. Email thật
    if (!existing && realEmail) existing = await findOne(db, 'email', email);

    const now = new Date().toISOString();

    if (existing) {
        // Lấp thông tin còn thiếu; thông tin VAT quầy vừa nhập thì ghi đè (đây là dữ liệu mới nhất).
        const updates: Record<string, unknown> = {};
        const existingPhoneDummy = isDummyPhone(existing.phone || '') || isGuestPlaceholderPhone(existing.phone || '');
        if (existingPhoneDummy && realPhone) updates.phone = phone;
        if (isDummyEmail(existing.email || '') && realEmail) updates.email = email;
        if (!existing.nationality && input.nationality) updates.nationality = input.nationality;
        if (vat) Object.assign(updates, vat);
        if (Object.keys(updates).length > 0) {
            updates.updatedAt = now;
            const { error } = await db.from('Customers').update(updates).eq('id', existing.id);
            if (error) console.warn('⚠️ [QuickBookingCustomer] enrich failed (non-blocking):', error.message);
        }
        return { customerId: existing.id, created: false, phone, email, vat, warning };
    }

    // 5. Tạo mới
    const ts = Date.now();
    const customerId = `CUS-${ts}-${Math.floor(Math.random() * 100)}`;
    const row: Record<string, unknown> = {
        id: customerId,
        fullName: input.customerName,
        phone: realPhone || guestPhone ? phone : `${GUEST_PHONE_PREFIX}${ts}`,
        email: realEmail ? email : `guest${ts}@guest.com`,
        nationality: input.nationality || null,
        createdAt: now,
        updatedAt: now,
        ...(vat || {}),
    };
    const { error } = await db.from('Customers').insert(row);
    if (error) {
        console.error('❌ [QuickBookingCustomer] create failed:', error.message);
        return { customerId: null, created: false, phone, email, vat, warning: CUSTOMER_NOT_CREATED };
    }
    return { customerId, created: true, phone, email, vat, warning };
}
