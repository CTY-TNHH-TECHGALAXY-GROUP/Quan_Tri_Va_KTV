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
    /**
     * Các dịch vụ đã GHÉP vào dịch vụ này (`options.mergedIntoId` trỏ về đây).
     *
     * Ghép dịch vụ ở màn điều phối: thời lượng của dịch vụ con được cộng thẳng
     * vào dịch vụ cha, con bị xoá KTV và không còn là một chặng riêng. Mọi chỗ
     * khác trong luồng KTV — bấm giờ, kết thúc, sổ cái, lịch sử — đều gom theo
     * `mergedIntoId || item.id`. Nhận/từ chối đơn phải gom y như vậy.
     */
    mergedChildren: string[];
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

const optsOf = (raw: any): any =>
    (typeof raw === 'string' ? safeParse(raw) : (raw || {}));

/** Dịch vụ này thuộc "đơn con" nào — chính nó, hoặc dịch vụ cha đã ghép nó vào. */
const groupKeyOf = (item: any): string => optsOf(item?.options).mergedIntoId || item.id;

/**
 * Gom các dịch vụ ĐÃ GHÉP về một mối.
 *
 * ⚠️ Trước đây hàm này coi dịch vụ con đã ghép như một lựa chọn độc lập. Hậu quả
 * khi quầy ghép "Gội" vào "Massage" rồi giao cả cụm cho một KTV:
 *   · Hộp chọn dịch vụ khi từ chối hiện HAI dòng, mà thật ra chỉ có một chặng.
 *   · Chọn nhầm dòng con thì KTV chỉ bị gỡ khỏi cái con — cái cha (đã ôm luôn
 *     thời lượng của con) vẫn dính tên họ, coi như từ chối mà chưa từ chối.
 *   · Mức phạt tính theo thời lượng của riêng con, trong khi giờ đã dồn hết
 *     sang cha — phạt hụt.
 * Nay cả cụm ghép là MỘT lựa chọn, đại diện là dịch vụ cha.
 */
function foldMerged(rows: any[]): KtvItemRef[] {
    const groups = new Map<string, any[]>();
    for (const r of rows) {
        const k = groupKeyOf(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
    }

    const out: KtvItemRef[] = [];
    for (const [key, members] of groups) {
        // Đại diện là dịch vụ CHA nếu chính nó cũng thuộc về KTV này; không thì
        // lấy dòng con có id nhỏ nhất để kết quả ổn định giữa hai lần gọi.
        const sorted = [...members].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const head = sorted.find(m => m.id === key) || sorted[0];
        const { technicianCodes, ...rest } = head;
        out.push({
            ...(rest as any),
            mergedChildren: sorted.filter(m => m.id !== head.id).map(m => m.id),
        } as KtvItemRef);
    }
    return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Mọi id cần đụng tới khi thao tác lên một lựa chọn: chính nó + phần đã ghép. */
export function idsOf(item: KtvItemRef): string[] {
    return [item.id, ...(item.mergedChildren || [])];
}

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

        // Gửi lên id của một dịch vụ ĐÃ GHÉP thì phải quy về cả cụm: thao tác
        // trên mình nó là bỏ sót phần còn lại của cùng một chặng.
        const { data: siblings } = await supabase
            .from('BookingItems').select(SELECT).eq('bookingId', (direct as any).bookingId);
        const key = groupKeyOf(direct);
        const sameGroup = (siblings || [])
            .filter((i: any) => assignedTo(i, staffId) && groupKeyOf(i) === key);

        const folded = foldMerged(sameGroup.length > 0 ? sameGroup : [direct]);
        return { items: folded, bookingId: (direct as any).bookingId, exact: true };
    }

    const { data: candidates } = await supabase
        .from('BookingItems').select(SELECT).eq('bookingId', id);

    // Thứ tự PostgREST không có gì bảo đảm; `foldMerged` chốt theo id để hai lần
    // gọi ra cùng một danh sách, và để thông báo lỗi liệt kê ổn định.
    const mine = foldMerged((candidates || []).filter((i: any) => assignedTo(i, staffId)));

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

/**
 * Đánh dấu "đã nhận" cho CẢ CỤM: dịch vụ cha và mọi dịch vụ đã ghép vào nó.
 *
 * Ghép rồi thì cả cụm là một chặng — nhận cha mà con vẫn treo ở bước chờ xác
 * nhận là trạng thái không ai gỡ được, vì màn KTV chỉ hiện đúng cái cha.
 */
export async function markAcceptedGroup(
    supabase: SupabaseClient,
    item: KtvItemRef,
    staffId: string
): Promise<{ error?: string }> {
    const first = await markAccepted(supabase, item, staffId);
    if (first.error) return { error: first.error };

    if (item.mergedChildren.length === 0) return {};

    const { data: children } = await supabase
        .from('BookingItems').select(SELECT).in('id', item.mergedChildren);

    for (const c of (children || [])) {
        const { technicianCodes, ...rest } = c as any;
        const res = await markAccepted(
            supabase, { ...(rest as any), mergedChildren: [] } as KtvItemRef, staffId);
        if (res.error) return { error: res.error };
    }
    return {};
}
