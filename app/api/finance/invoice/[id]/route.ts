import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = "force-no-store";

/**
 * Hoá đơn cho KHÁCH — route công khai (middleware: PUBLIC_API_PREFIXES).
 *
 * Khách quét QR từ modal hoá đơn của quầy bằng điện thoại, không có cookie đăng
 * nhập. Trước 04/10/2026 route đòi `requirePermission('dashboard')` nên khi bật
 * AUTH_ENFORCE_API khách nhận 401 và bị đẩy về /login. Xem
 * plans/plan_hoa_don_khach_khong_can_dang_nhap.md.
 *
 * Vì công khai nên:
 * - Chỉ GET, chỉ đọc 4 bảng Bookings / BookingItems / Services / SystemConfigs.
 * - Mọi cột trong INVOICE_BOOKING_COLUMNS PHẢI có thật trong `Bookings`
 *   (TableInSupabase.md §1). PostgREST gặp một cột lạ là trả 400 cho CẢ câu
 *   select → "Booking not found" cho mọi đơn (đã xảy ra bên WRB với
 *   `discountAmount`). Kiểm bằng scripts/check_invoice_columns.cjs.
 * - Response chỉ gồm INVOICE_PUBLIC_FIELDS: KHÔNG có accessToken, notes,
 *   violations, reception_feedback, technicianCode.
 * - Không nội suy chuỗi người dùng vào `.or()` — hai query `.eq` riêng.
 */
const INVOICE_BOOKING_COLUMNS =
    'id, billCode, customerName, customerPhone, customerEmail, customerLang, createdAt, bookingDate, timeStart, timeEnd, ' +
    'paymentMethod, totalAmount, status, source, parent_booking_id, roomName, bedId, accessToken';
const INVOICE_PUBLIC_FIELDS = [
    'id', 'billCode', 'customerName', 'customerPhone', 'customerEmail', 'customerLang', 'createdAt', 'bookingDate',
    'timeStart', 'timeEnd', 'paymentMethod', 'totalAmount', 'status', 'source', 'parent_booking_id',
    'roomName', 'bedId',
] as const;
type InvoiceBookingRow = {
    id: string;
    accessToken: string | null;
    totalAmount: number | null;
    [key: string]: unknown;
};

/** Cấu hình hoá đơn (tên spa, địa chỉ, logo...) — chỉ key này, không trả cấu hình nội bộ khác. */
const INVOICE_CONFIG_KEY = 'invoice_config';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: bookingId } = await params;
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        if (!bookingId) {
            return NextResponse.json({ success: false, error: 'Booking ID is required' }, { status: 400 });
        }

        // Nhận accessToken (QR hành trình) hoặc mã đơn (QR/in từ quầy).
        const byToken = (await supabase
            .from('Bookings')
            .select(INVOICE_BOOKING_COLUMNS)
            .eq('accessToken', bookingId)
            .maybeSingle()).data as InvoiceBookingRow | null;
        const booking: InvoiceBookingRow | null = byToken || ((await supabase
            .from('Bookings')
            .select(INVOICE_BOOKING_COLUMNS)
            .eq('id', bookingId)
            .maybeSingle()).data as InvoiceBookingRow | null);

        if (!booking) {
            return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
        }
        const publicBooking = Object.fromEntries(
            INVOICE_PUBLIC_FIELDS.filter(k => k in booking).map(k => [k, booking[k]])
        );

        // Đơn tách: cộng tiền các đơn con vào hoá đơn đơn cha.
        const { data: childBookings, error: cError } = await supabase
            .from('Bookings')
            .select('id, totalAmount')
            .eq('parent_booking_id', booking.id);
        if (cError) throw cError;

        const allBookingIds = [booking.id, ...(childBookings || []).map(b => b.id)];
        let aggregatedTotal = booking.totalAmount || 0;
        (childBookings || []).forEach(cb => {
            aggregatedTotal += (cb.totalAmount || 0);
        });

        // Fetch Items
        const { data: items, error: iError } = await supabase
            .from('BookingItems')
            .select('*')
            .in('bookingId', allBookingIds);

        if (iError) throw iError;

        // Fetch Services info. Giữ select('*') ở BookingItems (không có rủi ro cột lạ),
        // whitelist ở bước map bên dưới.
        let enrichedItems: any[] = items || [];
        if (enrichedItems.length > 0) {
            const serviceIds = enrichedItems.map(i => i.serviceId).filter(Boolean);
            const { data: svcs, error: svError } = await supabase
                .from('Services')
                .select('id, code, nameVN, nameEN, nameCN, nameJP, nameKR, priceVND, duration')
                .in('id', serviceIds);

            const svcMap = new Map();
            (svcs || []).forEach((s: any) => {
                if (s.id) svcMap.set(String(s.id).trim().toLowerCase(), s);
                if (s.code) svcMap.set(String(s.code).trim().toLowerCase(), s);
            });
            if (svError) console.error('[API Invoice] Services lookup failed:', svError.message);

            {
                enrichedItems = enrichedItems.map(i => {
                    const sId = String(i.serviceId || '').trim().toLowerCase();
                    const svc = svcMap.get(sId);
                    
                    const getName = () => {
                        const n = svc?.nameVN || svc?.nameEN || svc?.name;
                        if (typeof n === 'object' && n !== null) return n.vn || n.en || String(n);
                        return n || `Dịch vụ ${i.serviceId || 'Chưa rõ'}`;
                    };

                    // Chỉ trường hoá đơn cần (PrintableInvoice đọc id/price/quantity/duration/serviceName*).
                    // Không trả technicianCodes, ảnh bàn giao, ktvRatings, itemFeedback... của BookingItems.
                    return {
                        id: i.id,
                        bookingId: i.bookingId,
                        serviceId: i.serviceId,
                        quantity: i.quantity,
                        price: i.price,
                        status: i.status,
                        serviceName: getName(),
                        serviceNameEN: svc?.nameEN || '',
                        serviceNameCN: svc?.nameCN || '',
                        serviceNameJP: svc?.nameJP || '',
                        serviceNameKR: svc?.nameKR || '',
                        originalPrice: svc?.priceVND || i.price,
                        duration: i.duration || svc?.duration || 60
                    };
                });
            }
        }

        // Cấu hình hoá đơn — thay cho việc trang khách gọi /api/admin/settings/system
        // (route đó trả toàn bộ cấu hình thưởng/hoa hồng nội bộ, không được mở công khai).
        const { data: cfgRow } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', INVOICE_CONFIG_KEY)
            .maybeSingle();
        const invoiceConfig = cfgRow?.value && typeof cfgRow.value === 'object' ? cfgRow.value : null;

        return NextResponse.json({
            success: true,
            data: {
                ...publicBooking,
                // Bảng Bookings không có cột giảm giá → luôn 0 (promotion tính sau).
                discountAmount: 0,
                totalAmount: aggregatedTotal,
                items: enrichedItems,
                invoiceConfig,
            }
        });
    } catch (error: any) {
        console.error('[API Invoice] Error fetching booking:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
