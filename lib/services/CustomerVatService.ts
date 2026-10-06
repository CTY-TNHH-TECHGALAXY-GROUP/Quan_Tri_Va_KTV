/**
 * CustomerVatService — một nguồn duy nhất cho thông tin hoá đơn VAT của khách.
 *
 * Hệ thống KHÔNG có cột `vatRequested` ở `Customers` lẫn `Bookings` (DB thật, kiểm tra 06/10/2026).
 * "Khách cần VAT" chỉ có MỘT nguồn: 5 cột công ty trên `Customers` — taxCode, companyName,
 * companyAddress, companyEmail, companyPhone (WRB nội bộ ghi ở `src/lib/bookingCustomer.ts`;
 * admin ghi qua tạo đơn nhanh). Bật VAT ở form thì bắt buộc có MST, không có cờ "cần VAT nhưng chưa MST".
 *
 * Nhãn "VAT" trên Kanban/CRM phải đi qua `hasVatBadge` để hai phía không lệch nhau.
 * WRB là repo khác nên không import được file này; khi đổi quy tắc ở đây phải đối chiếu
 * `web_noi_bo/wrb-noi-bo-dev/src/lib/bookingCustomer.ts`.
 */
import { isDummyEmail } from '@/lib/customer.logic';

export interface VatInvoiceInput {
    taxCode?: string | null;
    companyName?: string | null;
    companyAddress?: string | null;
    companyEmail?: string | null;
    companyPhone?: string | null;
}

/** Đúng 5 cột công ty của bảng `Customers`. */
export interface VatCustomerColumns {
    taxCode: string;
    companyName: string | null;
    companyAddress: string | null;
    companyEmail: string | null;
    companyPhone: string | null;
}

/** MST Việt Nam: 10 số, hoặc 10 số + 3 số chi nhánh (có/không gạch nối). */
const TAX_CODE_PATTERN = /^(\d{10})(?:-?(\d{3}))?$/;

/** Chuẩn hoá MST về dạng `0316794479` hoặc `0316794479-001`; sai định dạng → null. */
export function normalizeTaxCode(raw?: string | null): string | null {
    const compact = (raw || '').replace(/[\s.]/g, '');
    const match = TAX_CODE_PATTERN.exec(compact);
    if (!match) return null;
    return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

const cleanText = (value?: string | null): string | null => {
    const text = (value ?? '').toString().trim();
    return text || null;
};

/**
 * Thông tin VAT quầy nhập → 5 cột `Customers`. Không có MST hợp lệ → null (không ghi gì).
 * Email công ty ảo (không có @, @guest.com) bị loại để không lưu rác vào hồ sơ.
 */
export function normalizeVatInvoice(input?: VatInvoiceInput | null): VatCustomerColumns | null {
    const taxCode = normalizeTaxCode(input?.taxCode);
    if (!taxCode) return null;
    const companyEmail = cleanText(input?.companyEmail);
    return {
        taxCode,
        companyName: cleanText(input?.companyName),
        companyAddress: cleanText(input?.companyAddress),
        companyEmail: companyEmail && !isDummyEmail(companyEmail) ? companyEmail.toLowerCase() : null,
        companyPhone: cleanText(input?.companyPhone),
    };
}

/**
 * Nhãn "VAT" cho một đơn: khách đã có MST trong hồ sơ.
 * Dùng chung cho Kanban (`getDispatchData`) và mọi chỗ hiển thị sau này.
 */
export function hasVatBadge(customerTaxCode?: string | null): boolean {
    return !!(customerTaxCode && customerTaxCode.trim());
}
