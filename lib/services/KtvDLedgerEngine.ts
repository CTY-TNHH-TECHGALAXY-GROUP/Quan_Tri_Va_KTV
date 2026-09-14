import { isVoidedSegment, workedMsOf } from '../segment-time';
import { toBusinessDate } from '../business-date';

/**
 * ================================================================
 * KtvDLedgerEngine — CÔNG THỨC DUY NHẤT cho tiền tua & giờ loại D
 * ================================================================
 * Hàm THUẦN: không query, không ghi DB, không đọc `new Date()` cho logic
 * nghiệp vụ. Đưa vào dữ liệu đã fetch + config → trả ra các dòng sổ cái.
 *
 * Nhờ vậy nó test được bằng dữ liệu bịa, và được dùng lại y nguyên cho cả
 * 3 đường: ghi theo sự kiện, backfill, và cron lưới an toàn.
 *
 * Grain: 1 dòng = 1 KTV × 1 BookingItem.
 *
 * ⚠️ MỌI consumer (ví, lịch sử, giờ tích lũy, xếp tua, báo cáo) phải lấy số
 * từ các dòng này. Không nơi nào được tự tính lại từ Bookings.
 */

// ── Trạng thái item được tính tiền ──────────────────────────────────
const PAYABLE_STATUSES = ['DONE', 'COMPLETED', 'FEEDBACK', 'CLEANING'];
/** Item đã chốt hẳn — sao đã về, KTV đã bàn giao. */
const FINAL_STATUSES = ['DONE'];
/** Đủ điều kiện hiện tiền cho KTV (khách đã FB hoặc đã bỏ qua). */
const SETTLED_STATUSES = ['DONE', 'COMPLETED'];

// ── Nhóm đơn giá ────────────────────────────────────────────────────
// Chỉ 2 nhóm. Không có 'COMBO': không mã dịch vụ nào bắt đầu bằng COMBO
// ("Combo King" là NHS0800 → Phổ thông), và Settings cũng chỉ có 2 đơn giá.
const VIP_PREFIXES = ['NHP', 'NHT', 'VIP'];

/** Từ mốc sao này trở lên thì khách sinh ra một suất thưởng. */
const BONUS_MIN_RATING = 4;

export type RateCategory = 'VIP' | 'PT';
export type RatingSource = 'GUEST_KTV' | 'GUEST' | 'ITEM_KTV' | 'ITEM' | 'BOOKING' | 'NONE';
export type EntryStatus = 'OPEN' | 'FINAL';

export interface TypeDConfigs {
    rateVIP: number;
    ratePT: number;
    /** { '0':0, '1':0.75, '2':0.5, '3':0.25, '4':0 } — thang 4★ */
    ratingDeductions: Record<string, number>;
    cutoffHours: number;
    /** 0.1 = 10% */
    taxRate: number;
    /** 'YYYY-MM-DD', hoặc null nếu chưa áp thuế */
    taxEffectiveFrom: string | null;
    /** Cần gạt `enable_ktv_bonus_TYPE_D`. Tắt thì không dòng nào có thưởng. */
    bonusEnabled: boolean;
    /** Tiền thưởng cho MỘT khách chấm 4★, trước khi chia cho số KTV loại D. */
    bonusPerGuest: number;
}

export interface EngineGuest {
    id: string;
    rating?: number | null;
    ktv_ratings?: Record<string, number> | null;
}

export interface EngineItem {
    id: string;
    serviceId?: string | null;
    guest_id?: string | null;
    technicianCodes?: string[] | null;
    segments?: any;
    status?: string | null;
    tip?: number | null;
    itemRating?: number | null;
    ktvRatings?: Record<string, number> | null;
    options?: any;
    handover_status?: string | null;
    handover_comment?: string | null;
}

export interface EngineBooking {
    id: string;
    billCode?: string | null;
    timeStart?: string | null;
    status?: string | null;
    rating?: number | null;
    BookingItems?: EngineItem[] | null;
    BookingGuests?: EngineGuest[] | null;
}

export interface EngineService {
    nameVN?: string | null;
    code?: string | null;
    is_utility?: boolean | null;
}

export interface TurnRow {
    staff_id: string;
    booking_item_id: string;
    booking_id: string;
    guest_id: string | null;
    group_id: string;
    work_date: string;

    bill_code: string | null;
    bill_suffix: string;
    service_id: string | null;
    service_name: string | null;
    rate_category: RateCategory;
    booking_time_start: string | null;

    assigned_minutes: number;
    actual_minutes: number;
    paid_minutes: number;
    custom_minutes: number | null;

    rate_per_60m: number;
    rating_used: number;
    rating_source: RatingSource;
    deduction_rate: number;
    commission_gross: number;
    commission_net: number;
    /**
     * Thưởng 4★ cộng vào tiền tua. Một suất mỗi KHÁCH, chia đều cho số KTV
     * loại D phục vụ khách đó, và chỉ ghi trên ĐÚNG MỘT dòng của khách —
     * ghi lên mọi dòng là tổng bị nhân lên theo số dịch vụ.
     */
    bonus_amount: number;
    tax_amount: number;
    tip: number;

    item_status: string | null;
    is_provisional: boolean;
    entry_status: EntryStatus;

    handover_status: string | null;
    handover_comment: string | null;
    co_workers: string[];
    /**
     * Tua này có KTV KHÁC LOẠI làm cùng (cùng một khách).
     * Khi true thì không phát thưởng, dù khách chấm 4★ — nhưng tiền tua vẫn
     * tính và vẫn trừ theo sao. Lưu vào dòng để lịch sử giải thích được.
     */
    has_other_type_coworker: boolean;
}

// ── Tiện ích ────────────────────────────────────────────────────────

function parseJson(value: any, fallback: any): any {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

function sameKtv(a: string | null | undefined, b: string): boolean {
    return !!a && a.toLowerCase() === b.toLowerCase();
}

/** Segments của riêng KTV này trong một item. */
function segmentsOf(item: EngineItem, staffId: string): any[] {
    const segs = parseJson(item.segments, []);
    if (!Array.isArray(segs)) return [];
    return segs.filter((s: any) => sameKtv(s?.ktvId, staffId));
}

/** `options.mergedIntoId || item.id` — id của "đơn con" (một khách). */
function groupIdOf(item: EngineItem): string {
    const opts = parseJson(item.options, {}) || {};
    return opts.mergedIntoId || item.id;
}

export function rateCategoryOf(serviceId: string | null | undefined): RateCategory {
    const sid = String(serviceId || '').toUpperCase();
    return VIP_PREFIXES.some(p => sid.startsWith(p)) ? 'VIP' : 'PT';
}

/**
 * Sao áp cho KTV này ở đơn này — ưu tiên theo KHÁCH, chi tiết nhất trước.
 * Trả cả nguồn để sau này tra được số đó từ đâu ra.
 */
export function resolveRating(
    booking: EngineBooking,
    item: EngineItem,
    guest: EngineGuest | undefined,
    staffId: string
): { rating: number; source: RatingSource } {
    const pick = (map: Record<string, number> | null | undefined): number | null => {
        if (!map) return null;
        for (const [k, v] of Object.entries(map)) {
            if (sameKtv(k, staffId) && v != null) return Number(v);
        }
        return null;
    };

    const guestKtv = pick(parseJson(guest?.ktv_ratings, null));
    if (guestKtv != null) return { rating: guestKtv, source: 'GUEST_KTV' };

    if (guest?.rating != null) return { rating: Number(guest.rating), source: 'GUEST' };

    const itemKtv = pick(parseJson(item.ktvRatings, null));
    if (itemKtv != null) return { rating: itemKtv, source: 'ITEM_KTV' };

    if (item.itemRating != null) return { rating: Number(item.itemRating), source: 'ITEM' };

    // ⚠️ CHỈ lùi về sao CẤP BILL khi đơn KHÔNG có bản ghi khách nào.
    //
    // Đơn đã tách khách (`BookingGuests`) mà khách này chưa chấm thì nghĩa là
    // CHƯA CHẤM — không phải "lấy tạm sao của người bên cạnh".
    //
    // Ca thật gặp ngày 08/09: T079 làm 3 khách ở 3 đơn con. Đúng MỘT khách chấm
    // 4 sao (ghi trên item của đơn -A). Nhưng `Bookings.rating` = 4 lại nằm ở
    // đơn -C, nên khách của -C — người chưa hề chấm — cũng được gán 4 sao. Một
    // lần chấm hoá thành hai.
    //
    // Đơn cũ chưa có `BookingGuests` thì `guest` là undefined, đường lùi này vẫn
    // giữ nguyên để dữ liệu cũ không mất sao.
    if (!guest && booking.rating != null) return { rating: Number(booking.rating), source: 'BOOKING' };

    return { rating: 0, source: 'NONE' };
}

/**
 * Phút gán / phút làm thực / phút được trả tiền.
 *
 * ⚠️ `paid` và `actual` KHÔNG dùng chung cách tính, và đây là chủ ý — nó sao
 * chép đúng hai hàm đang chạy trong production, để engine không tự ý đổi
 * lương hay đổi giờ tích lũy của KTV:
 *
 *   paid   ← KtvTypeDCommissionService.calculateGuestCommission  (TIỀN)
 *            · phút LẺ, không làm tròn
 *            · thực = max(0, t2−t1) → mốc lỗi (t2 < t1) trả 0
 *            · = min(thực, gán): làm 55/60 trả 55; làm 70/60 vẫn trả 60
 *
 *   actual ← KtvTypeDTurnService.calculateActualMinutes           (GIỜ)
 *            · phút LÀM TRÒN
 *            · mốc lỗi (t2 ≤ t1) thì lùi về giờ gán
 *            · CHẶN TRÊN tại giờ gán — xem ghi chú dưới
 *
 * Hai cách này lệch nhau ở phần lẻ và ở mốc lỗi.
 *
 * ⚠️ CHẶN TRÊN cho `actual` (thêm 04/09/2026): trước đây giờ tích lũy không
 * có trần, nên một tua quên bấm kết thúc đẻ ra 1441 phút = 24 giờ (bill
 * 005-02092026-B). Vì thứ tự nhận khách sort theo net_hours DESC, một lần
 * quên bấm là đủ để một KTV đứng đầu hàng suốt cả tháng. Máy treo hay lỗi
 * ghi nhận thì không thể tính thành giờ làm — giờ thực chặn tại giờ gán,
 * đúng như tiền. Phải sửa cùng lúc ở KtvTypeDTurnService.calculateActualMinutes.
 *
 * `customCommissionDuration` (admin can thiệp) thắng cả hai và KHÔNG bị chặn —
 * đó là con số admin cố ý nhập, không phải dữ liệu hỏng.
 */
export function computeMinutes(segs: any[]): {
    assigned: number; actual: number; paid: number; custom: number | null;
} {
    let assigned = 0, actual = 0, paid = 0, custom: number | null = null;

    for (const seg of segs) {
        // Chặng bị tước quyền lợi (KTV bị đổi ra, huỷ do lỗi KTV): không tiền,
        // không giờ, không cả giờ gán. Vẫn nằm trong đơn để biết ai từng làm.
        if (isVoidedSegment(seg)) continue;

        const gan = Number(seg?.duration) || 0;
        assigned += gan;

        const hasCustom = seg?.customCommissionDuration !== undefined
            && seg?.customCommissionDuration !== null;
        if (hasCustom) {
            const c = Number(seg.customCommissionDuration) || 0;
            custom = (custom ?? 0) + c;
            actual += c;
            paid += c;
            continue;
        }

        // Đã trừ các khoảng tạm dừng — xem lib/segment-time.ts
        const workedMs = workedMsOf(seg);
        const hasMarks = workedMs !== null;

        // TIỀN — phút lẻ, mốc lỗi trả 0, chặn tại giờ gán
        paid += hasMarks ? Math.min(workedMs / 60000, gan) : gan;

        // GIỜ — phút làm tròn, mốc lỗi lùi về giờ gán, chặn tại giờ gán
        actual += (hasMarks && workedMs > 0) ? Math.min(Math.round(workedMs / 60000), gan) : gan;
    }

    return { assigned, actual, paid, custom };
}

/**
 * Cộng thưởng 4★ vào tiền tua, rồi mới tính thuế TNCN trên tổng.
 *
 * Chạy sau khi đã dựng xong mọi dòng của MỘT bill, vì thưởng tính THEO KHÁCH:
 * một khách chấm 4★ sinh đúng một suất thưởng, chia đều cho số KTV loại D
 * phục vụ khách đó — không phụ thuộc khách làm mấy dịch vụ.
 *
 * Suất thưởng ghi lên ĐÚNG MỘT dòng của mỗi (KTV, khách). Rải lên mọi dòng thì
 * tổng theo ngày và theo tháng bị nhân lên theo số dịch vụ.
 *
 * ⚠️ Giữ nguyên luật loại trừ cũ: bill có bất kỳ KTV KHÔNG thuộc loại D thì cả
 * bill mất thưởng. Đây là luật sẵn có của phần thưởng, chuyển vào tiền tua
 * không phải lý do để nới nó ra.
 */
export function applyBonusAndTax(
    bookingRows: TurnRow[],
    hasOtherType: boolean,
    workDate: string | null,
    configs: TypeDConfigs
): void {
    const canBonus = configs.bonusEnabled && !hasOtherType && configs.bonusPerGuest > 0;

    if (canBonus) {
        // Mỗi khách có mấy KTV loại D? Đếm trên chính các dòng của bill này.
        const staffPerGuest = new Map<string, Set<string>>();
        for (const r of bookingRows) {
            if (Number(r.rating_used) < BONUS_MIN_RATING) continue;
            const set = staffPerGuest.get(r.group_id) || new Set<string>();
            set.add(r.staff_id);
            staffPerGuest.set(r.group_id, set);
        }

        const paid = new Set<string>();
        for (const r of bookingRows) {
            if (Number(r.rating_used) < BONUS_MIN_RATING) continue;
            const key = `${r.staff_id}|${r.group_id}`;
            if (paid.has(key)) continue;          // suất này đã ghi ở dòng trước
            const dCount = staffPerGuest.get(r.group_id)?.size || 1;
            r.bonus_amount = configs.bonusPerGuest / dCount;
            paid.add(key);
        }
    }

    // KHÔNG làm tròn — cùng lý do với commission_net: làm tròn ở một cấp là
    // tổng theo khách / theo ngày / theo tháng lệch nhau.
    const isTaxed = !!configs.taxEffectiveFrom && !!workDate && workDate >= configs.taxEffectiveFrom;
    for (const r of bookingRows) {
        r.tax_amount = isTaxed ? (r.commission_net + r.bonus_amount) * configs.taxRate : 0;
    }
}

// ── Engine ──────────────────────────────────────────────────────────

/**
 * Dựng các dòng sổ cái từ dữ liệu đã fetch.
 *
 * @param bookings   Bookings kèm BookingItems + BookingGuests
 * @param staffIds   Chỉ dựng dòng cho những KTV này (danh sách loại D)
 * @param services   serviceId → { nameVN, is_utility }
 * @param configs    đơn giá, bảng trừ sao, cutoff, thuế
 */
export function computeRows(
    bookings: EngineBooking[],
    staffIds: string[],
    services: Record<string, EngineService>,
    configs: TypeDConfigs
): TurnRow[] {
    const staffSet = new Map<string, string>(); // lowercase → id gốc
    for (const id of staffIds) staffSet.set(id.toLowerCase(), id);

    const rows: TurnRow[] = [];

    for (const booking of bookings) {
        // Dòng của RIÊNG bill này. Thưởng 4★ tính theo khách nên phải gom đủ
        // các dòng của bill mới biết mỗi khách có mấy KTV loại D phục vụ.
        const bookingRows: TurnRow[] = [];
        const allItems = booking.BookingItems || [];
        if (allItems.length === 0) continue;

        const isUtility = (i: EngineItem) => !!services[String(i.serviceId)]?.is_utility;

        // Hậu tố -A / -B: đánh theo TẤT CẢ đơn con của bill (không riêng KTV này),
        // nếu không thì hai KTV cùng bill sẽ thấy hậu tố khác nhau.
        const groupOrder: string[] = [];
        for (const i of allItems) {
            if (isUtility(i)) continue;
            const g = groupIdOf(i);
            if (!groupOrder.includes(g)) groupOrder.push(g);
        }
        const suffixOf = (g: string) => groupOrder.length > 1
            ? `-${String.fromCharCode(65 + Math.max(0, groupOrder.indexOf(g)))}`
            : '';

        // Bill này có KTV nào KHÔNG thuộc loại D không? Xét trên toàn đơn cha.
        const hasOtherType = allItems.some((i: EngineItem) =>
            !isUtility(i) && (i.technicianCodes || []).some(c => !staffSet.has(String(c).toLowerCase())));

        const guestById = new Map<string, EngineGuest>();
        for (const g of booking.BookingGuests || []) guestById.set(String(g.id), g);

        const workDate = booking.timeStart
            ? toBusinessDate(new Date(booking.timeStart + (/[Z+]/.test(booking.timeStart.slice(10)) ? '' : 'Z')), configs.cutoffHours)
            : null;

        for (const item of allItems) {
            // Dịch vụ tiện ích (Phòng riêng...) không sinh dòng: không gán KTV,
            // không tính hoa hồng, không tính giờ.
            if (isUtility(item)) continue;
            if (!PAYABLE_STATUSES.includes(String(item.status))) continue;
            if (!workDate) continue;

            const techCodes = item.technicianCodes || [];

            for (const rawCode of techCodes) {
                const staffId = staffSet.get(String(rawCode).toLowerCase());
                if (!staffId) continue; // không phải KTV loại D

                const segs = segmentsOf(item, staffId);
                if (segs.length === 0) continue;

                const { assigned, actual, paid, custom } = computeMinutes(segs);
                if (paid <= 0 && actual <= 0) continue;

                const guest = item.guest_id ? guestById.get(String(item.guest_id)) : undefined;
                const { rating, source } = resolveRating(booking, item, guest, staffId);

                const category = rateCategoryOf(item.serviceId);
                const rate = category === 'VIP' ? configs.rateVIP : configs.ratePT;
                const deduction = Number(configs.ratingDeductions[String(rating)] ?? 0);

                // KHÔNG làm tròn — xem ghi chú về thuế bên dưới. Cùng một lý do:
                // chỉ cần làm tròn ở một cấp là tổng theo khách, theo ngày và theo
                // tháng sẽ lệch nhau. Giữ nguyên phần lẻ khi lưu, làm tròn ở tầng
                // GIAO DIỆN khi hiện cho KTV và ở lúc chi tiền thật.
                const gross = paid * (rate / 60);
                const net = gross * (1 - deduction);

                // Thuế TNCN — KHÔNG làm tròn.
                //
                // Vì không làm tròn nên thuế cộng dồn chính xác ở mọi cấp:
                //   thuế(khách) = 0,1 × Σ(tiền từng đơn) = Σ(0,1 × tiền từng đơn)
                // Tức là lưu theo dòng hay theo khách đều ra cùng một số — đúng
                // nghĩa "thuế theo đơn của khách" mà không phải gộp dòng lại.
                //
                // Chính việc làm tròn là thứ đã khiến ví (tính trên tổng ngày) lệch
                // với lịch sử (làm tròn từng đơn) — lỗi L5. Bỏ làm tròn thì lệch
                // không còn khả năng xảy ra ở bất kỳ cấp cộng dồn nào.

                const itemStatus = String(item.status);
                const hasRating = rating > 0;
                const isSettled = SETTLED_STATUSES.includes(itemStatus);

                const svc = services[String(item.serviceId)];
                const opts = parseJson(item.options, {}) || {};
                const group = groupIdOf(item);

                // ⚠️ Xét trên TOÀN ĐƠN CHA, không phải từng khách.
                // Chỉ cần trong bill có MỘT KTV khác chế độ là mọi KTV loại D
                // ở các đơn con đều mất thưởng — kể cả người phục vụ khách khác.

                bookingRows.push({
                    staff_id: staffId,
                    booking_item_id: item.id,
                    booking_id: booking.id,
                    guest_id: item.guest_id ? String(item.guest_id) : null,
                    group_id: group,
                    work_date: workDate,

                    bill_code: booking.billCode ?? null,
                    bill_suffix: suffixOf(group),
                    service_id: item.serviceId ? String(item.serviceId) : null,
                    service_name: opts.displayName || svc?.nameVN || svc?.code || (item.serviceId ? String(item.serviceId) : null),
                    rate_category: category,
                    booking_time_start: booking.timeStart ?? null,

                    assigned_minutes: assigned,
                    actual_minutes: actual,
                    paid_minutes: paid,
                    custom_minutes: custom,

                    rate_per_60m: rate,
                    rating_used: rating,
                    rating_source: source,
                    deduction_rate: deduction,
                    commission_gross: gross,
                    commission_net: net,
                    // Cả hai được điền ở bước hậu kỳ bên dưới.
                    bonus_amount: 0,
                    tax_amount: 0,
                    tip: Number(item.tip) || 0,

                    item_status: itemStatus,
                    // Chưa có sao và chưa chốt trạng thái → chưa hiện tiền cho KTV.
                    is_provisional: !hasRating && !isSettled,
                    entry_status: FINAL_STATUSES.includes(itemStatus) ? 'FINAL' : 'OPEN',

                    handover_status: item.handover_status ?? null,
                    handover_comment: item.handover_comment ?? null,
                    co_workers: techCodes
                        .map(c => String(c).trim().toUpperCase())
                        .filter(c => c && c !== staffId.toUpperCase()),
                    has_other_type_coworker: hasOtherType,
                });
            }
        }

        applyBonusAndTax(bookingRows, hasOtherType, workDate, configs);
        rows.push(...bookingRows);
    }

    return rows;
}
