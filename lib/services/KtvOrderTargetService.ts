import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ================================================================
 * KtvOrderTargetService — "KTV vừa bấm vào DỊCH VỤ nào?"
 * ================================================================
 * Màn KTV gửi lên một id có thể là id ĐƠN CON (`BookingItems.id`) hoặc id ĐƠN
 * (`Bookings.id`) — tuỳ luồng, tuỳ phiên bản màn hình. Hai route `accept-order`
 * và `reject-order` trước đây mỗi chỗ tự dò một kiểu, và cùng chung một cách dò
 * nguy hiểm khi nhận id ĐƠN:
 *
 *     const mine = candidates.find(i => i.technicianCodes.includes(staffId));
 *
 * `.find` = lấy PHẦN TỬ ĐẦU TIÊN theo thứ tự PostgREST trả về. Một đơn có nhiều
 * dịch vụ cùng gán cho một KTV (khách làm gội + massage + lấy ráy tai) thì:
 *
 *   · Bấm "Nhận đơn"   → chỉ một dịch vụ được đánh dấu đã nhận, hai cái kia vẫn
 *                        treo ở bước chờ xác nhận.
 *   · Bấm "Từ chối"    → gỡ đúng một dịch vụ, KTV vẫn dính hai dịch vụ còn lại;
 *                        mà mức phạt lại tính theo thời lượng của đúng dịch vụ
 *                        bị bốc ngẫu nhiên đó. Bốc trúng gói 30 phút thì phạt
 *                        1,5 giờ; trúng gói 90 phút thì phạt 4,5 giờ — cùng một
 *                        thao tác, hai kết quả khác nhau, không ai giải thích được.
 *
 * File này là chỗ DUY NHẤT trả lời câu hỏi trên, và trả về CẢ DANH SÁCH thay vì
 * đoán lấy một cái. Nhận đơn thì đánh dấu hết; từ chối thì bắt gọi đích danh
 * dịch vụ, vì từ chối là hành vi có chế tài, không được phép mơ hồ.
 */

export interface KtvItemRef {
    id: string;
    bookingId: string | null;
    status: string | null;
    serviceId: string | null;
    options: any;
}

export interface ResolveResult {
    /** Các đơn con của CHÍNH KTV này, theo thứ tự id để không đổi giữa hai lần gọi. */
    items: KtvItemRef[];
    bookingId: string | null;
    /** true khi id gửi lên là id đơn con cụ thể (đích danh một dịch vụ). */
    exact: boolean;
}

const sameCode = (a: any, b: any) =>
    String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function assignedTo(item: any, staffId: string): boolean {
    return (item?.technicianCodes || []).some((c: string) => sameCode(c, staffId));
}

const SELECT = 'id, bookingId, status, serviceId, options, technicianCodes';

/**
 * Tra ra các dịch vụ đang gán cho `staffId` từ một id bất kỳ.
 *
 * `id` là id đơn con → trả đúng đơn con đó (`exact = true`), và CHỈ khi nó thật
 * sự đang gán cho KTV này: không thì thao tác của người này rơi vào đơn của
 * đồng nghiệp.
 *
 * `id` là id đơn → trả MỌI đơn con của KTV này trong đơn đó (`exact = false`).
 */
export async function resolveMyItems(
    supabase: SupabaseClient,
    staffId: string,
    id: string
): Promise<ResolveResult> {
    const { data: direct } = await supabase
        .from('BookingItems').select(SELECT).eq('id', id).maybeSingle();

    if (direct) {
        if (!assignedTo(direct, staffId)) return { items: [], bookingId: (direct as any).bookingId, exact: true };
        const { technicianCodes, ...rest } = direct as any;
        return { items: [rest as KtvItemRef], bookingId: (direct as any).bookingId, exact: true };
    }

    const { data: candidates } = await supabase
        .from('BookingItems').select(SELECT).eq('bookingId', id);

    const mine = (candidates || [])
        .filter((i: any) => assignedTo(i, staffId))
        // Thứ tự PostgREST không có gì bảo đảm; chốt theo id để hai lần gọi ra
        // cùng một danh sách, và để thông báo lỗi liệt kê ổn định.
        .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))
        .map(({ technicianCodes, ...rest }: any) => rest as KtvItemRef);

    return { items: mine, bookingId: id, exact: false };
}

/** Đã bấm "nhận đơn" cho dịch vụ này chưa — theo TỪNG KTV. */
export function acceptedAtOf(options: any, staffId: string): string | null {
    const opts = typeof options === 'string' ? safeParse(options) : (options || {});
    const map = opts.acceptedByStaff || {};
    const key = String(staffId).toUpperCase();
    return map[key] || null;
}

function safeParse(raw: string): any {
    try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/**
 * Ghi mốc "đã nhận" cho RIÊNG một KTV trên một dịch vụ. Idempotent: bấm lại
 * không dời mốc cũ.
 *
 * Mốc lưu theo từng người (`acceptedByStaff`) chứ không phải một ô dùng chung:
 * một dịch vụ có thể gán 2 KTV, người bấm trước không được xác nhận thay người sau.
 */
export async function markAccepted(
    supabase: SupabaseClient,
    item: KtvItemRef,
    staffId: string
): Promise<{ changed: boolean; error?: string }> {
    const opts = typeof item.options === 'string' ? safeParse(item.options) : (item.options || {});
    const key = String(staffId).toUpperCase();
    const acceptedByStaff = { ...(opts.acceptedByStaff || {}) };

    if (acceptedByStaff[key]) return { changed: false };

    const now = new Date().toISOString();
    acceptedByStaff[key] = now;

    const next: Record<string, any> = { ...opts, acceptedByStaff };
    // Giữ acceptedAt/acceptedBy của người bấm ĐẦU TIÊN cho dữ liệu cũ và cho
    // những chỗ chỉ cần biết "đơn đã có người nhận chưa". Không ghi đè.
    if (!next.acceptedAt) {
        next.acceptedAt = now;
        next.acceptedBy = staffId;
    }

    const { error } = await supabase
        .from('BookingItems').update({ options: next }).eq('id', item.id);
    if (error) return { changed: false, error: error.message };
    return { changed: true };
}
