import type { SupabaseClient } from '@supabase/supabase-js';
import { computeRows, TurnRow, TypeDConfigs, EngineService } from './KtvDLedgerEngine';
import { getDayCutoffHours } from '../business-date';

/**
 * ================================================================
 * KtvDLedgerWriter — CỬA GHI DUY NHẤT của sổ cái tua loại D
 * ================================================================
 * `recomputeTurnRows()` idempotent: tự đọc lại DB, tự tính, tự upsert. Gọi
 * bao nhiêu lần với cùng đầu vào cũng ra cùng kết quả.
 *
 * Ba đường gọi vào đây, và cả ba dùng CHUNG hàm này — không có bản sao nào:
 *   · worker rút KTVDRecomputeQueue  (trigger đẩy vào)
 *   · backfill                        (scripts/backfill_ktvd_turn_ledger.ts)
 *   · cron đối soát đêm               (lưới an toàn)
 */

/** Chỉ đọc config một lần cho mỗi lượt chạy. */
export interface LedgerContext {
    configs: TypeDConfigs;
    services: Record<string, EngineService>;
    staffIds: string[];
}

export async function loadContext(supabase: SupabaseClient): Promise<LedgerContext> {
    const cutoffHours = await getDayCutoffHours(supabase);

    const { data: cfgRows } = await supabase.from('SystemConfigs').select('key, value');
    const cfg: Record<string, any> = {};
    (cfgRows || []).forEach((c: any) => {
        let v = c.value;
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* giữ nguyên */ } }
        cfg[c.key] = v;
    });

    const taxFrom = String(cfg['ktv_type_d_tax_effective_from'] ?? '').replace(/"/g, '').trim();

    const { data: staff } = await supabase.from('Staff').select('id').eq('work_type', 'TYPE_D');
    const { data: svc } = await supabase.from('Services').select('id, code, nameVN, is_utility');

    const services: Record<string, EngineService> = {};
    (svc || []).forEach((s: any) => {
        const e = { nameVN: s.nameVN, code: s.code, is_utility: !!s.is_utility };
        if (s.id) services[String(s.id)] = e;
        if (s.code) services[String(s.code)] = e;
    });

    return {
        configs: {
            rateVIP: Number(cfg['ktv_type_d_vip_rate_per_60m']) || 180000,
            ratePT: Number(cfg['ktv_type_d_pt_rate_per_60m']) || 100000,
            ratingDeductions: cfg['ktv_type_d_rating_deduction']
                || { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 },
            cutoffHours,
            taxRate: 0.1,
            taxEffectiveFrom: taxFrom || null,
            // Cùng hai khoá mà ví bonus cũ đang đọc — nay thưởng 4★ đi thẳng
            // vào tiền tua nên engine phải là nơi duy nhất đọc chúng.
            bonusEnabled: cfg['enable_ktv_bonus_TYPE_D'] === true
                || String(cfg['enable_ktv_bonus_TYPE_D']).replace(/"/g, '') === 'true',
            bonusPerGuest: (Number(cfg['ktv_type_d_bonus_points']) || 0)
                * (Number(cfg['ktv_bonus_rate_TYPE_D']) || 0),
        },
        services,
        staffIds: (staff || []).map((s: any) => s.id),
    };
}

export interface RecomputeResult {
    itemsRequested: number;
    rowsWritten: number;
    rowsVoided: number;
    rowsSkippedLocked: number;
}

/**
 * Tính lại sổ cái cho đúng các BookingItem được chỉ định.
 *
 * @param itemIds danh sách `BookingItems.id`
 */
export async function recomputeTurnRows(
    supabase: SupabaseClient,
    itemIds: string[],
    ctx?: LedgerContext,
): Promise<RecomputeResult> {
    const empty: RecomputeResult = { itemsRequested: 0, rowsWritten: 0, rowsVoided: 0, rowsSkippedLocked: 0 };
    if (itemIds.length === 0) return empty;

    const context = ctx || await loadContext(supabase);

    // Tìm các booking chứa những item này, rồi nạp ĐẦY ĐỦ booking đó.
    // Phải nạp cả bill vì hậu tố -A/-B được đánh theo toàn bộ đơn con của
    // bill, không thể tính đúng nếu chỉ nhìn một item.
    const { data: idRows, error: idErr } = await supabase
        .from('BookingItems')
        .select('bookingId')
        .in('id', itemIds);
    if (idErr) throw idErr;

    const bookingIds = [...new Set((idRows || []).map((r: any) => r.bookingId).filter(Boolean))];
    if (bookingIds.length === 0) return { ...empty, itemsRequested: itemIds.length };

    const { data: bookings, error: bErr } = await supabase
        .from('Bookings')
        .select(`
            id, billCode, timeStart, status, rating,
            BookingItems!fk_bookingitems_booking (
                id, serviceId, guest_id, technicianCodes, segments, status, tip,
                itemRating, ktvRatings, options, handover_status, handover_comment
            ),
            BookingGuests ( id, rating, ktv_ratings )
        `)
        .in('id', bookingIds);
    if (bErr) throw bErr;

    // Đơn đã huỷ → không sinh dòng nào; các dòng cũ sẽ bị VOID bên dưới.
    const live = (bookings || []).filter((b: any) => b.status !== 'CANCELLED');
    const produced = computeRows(live as any, context.staffIds, context.services, context.configs)
        // Chỉ giữ dòng thuộc đúng những item được yêu cầu — tránh vô tình ghi
        // đè item khác trong cùng bill mà lần này không được nhắc tới.
        .filter((r: TurnRow) => itemIds.includes(r.booking_item_id));

    // Dòng đã LOCKED thì cấm sửa đè — thay đổi phải đi bằng dòng ADMIN_ADJUST.
    const { data: existing } = await supabase
        .from('KTVDTurnLedger')
        .select('staff_id, booking_item_id, entry_status')
        .in('booking_item_id', itemIds);

    const lockedKeys = new Set(
        (existing || []).filter((r: any) => r.entry_status === 'LOCKED')
            .map((r: any) => `${r.staff_id}|${r.booking_item_id}`));

    const writable = produced.filter(r => !lockedKeys.has(`${r.staff_id}|${r.booking_item_id}`));

    if (writable.length > 0) {
        const payload = writable.map(r => ({ ...r, source: 'EVENT', computed_at: new Date().toISOString() }));
        const { error } = await supabase
            .from('KTVDTurnLedger')
            .upsert(payload, { onConflict: 'staff_id,booking_item_id' });
        if (error) throw error;
    }

    // Dòng còn trong sổ nhưng engine không còn sinh ra nữa → VOID.
    // Xảy ra khi: đổi KTV, huỷ đơn, item lùi về trạng thái chưa tính tiền,
    // hoặc dịch vụ được đổi sang loại tiện ích.
    const producedKeys = new Set(writable.map(r => `${r.staff_id}|${r.booking_item_id}`));
    const toVoid = (existing || []).filter((r: any) =>
        r.entry_status !== 'LOCKED'
        && r.entry_status !== 'VOID'
        && !producedKeys.has(`${r.staff_id}|${r.booking_item_id}`));

    for (const r of toVoid) {
        const { error } = await supabase
            .from('KTVDTurnLedger')
            .update({ entry_status: 'VOID', computed_at: new Date().toISOString() })
            .eq('staff_id', r.staff_id)
            .eq('booking_item_id', r.booking_item_id);
        if (error) throw error;
    }

    return {
        itemsRequested: itemIds.length,
        rowsWritten: writable.length,
        rowsVoided: toVoid.length,
        rowsSkippedLocked: lockedKeys.size,
    };
}

/** Số dòng lấy mỗi lượt khi quét hàng đợi. */
const QUEUE_SCAN_PAGE = 500;
/** Số id tối đa nhét vào một mệnh đề `.in()` — dài quá thì URL PostgREST vỡ. */
const IN_CHUNK = 200;

/** Một dòng hàng đợi, đủ thông tin để dán lại NGUYÊN VẸN nếu tính lỗi. */
interface QueueEntry {
    booking_item_id: string;
    booking_id?: string | null;
    reason?: string | null;
    attempts?: number | null;
}

/**
 * Rút một lô khỏi hàng đợi rồi tính lại — và DÁN LẠI nếu tính lỗi.
 *
 * Xoá trước khi tính là cố ý: một item hỏng kinh niên không được phép nằm lì
 * chặn cả hàng đợi. Nhưng xoá xong mà tính lỗi thì bắt buộc phải nhét lại kèm
 * `attempts + 1`, nếu không item biến mất vĩnh viễn — sổ cái thiếu một tua và
 * không còn ai nhắc lại nữa.
 *
 * ⚠️ Trước đây CHỈ `drainRecomputeQueue` (cron) làm đúng việc dán lại. Hai đường
 * rút lúc ĐỌC thì xoá xong là tính, lỗi bị `catch` ở ngoài nuốt gọn — mất tua
 * không để lại dấu vết nào. Chừng nào cron còn chạy thì trigger sẽ đẩy item vào
 * lại ở lần sửa kế tiếp nên không ai thấy; bỏ cron đi là mất thật. Nay cả ba
 * đường dùng chung đúng hàm này.
 *
 * Không ném lỗi ra ngoài — trả `failed` để nơi gọi tự quyết.
 */
async function takeAndRecompute(
    supabase: SupabaseClient,
    entries: QueueEntry[],
): Promise<{ result: RecomputeResult; failed: number }> {
    const zero: RecomputeResult = {
        itemsRequested: entries.length, rowsWritten: 0, rowsVoided: 0, rowsSkippedLocked: 0,
    };
    if (entries.length === 0) return { result: { ...zero, itemsRequested: 0 }, failed: 0 };

    const itemIds = entries.map(e => e.booking_item_id);
    await supabase.from('KTVDRecomputeQueue').delete().in('booking_item_id', itemIds);

    try {
        return { result: await recomputeTurnRows(supabase, itemIds), failed: 0 };
    } catch (e: any) {
        // Dán lại NGUYÊN VẸN: giữ cả `booking_id` và `reason`, không chỉ mỗi id.
        // Mất `booking_id` là `drainQueueFor()` không còn tìm ra item theo đơn nữa,
        // tức item hỏng mất luôn đường cứu thứ hai.
        await supabase.from('KTVDRecomputeQueue').upsert(
            entries.map(en => ({
                booking_item_id: en.booking_item_id,
                booking_id: en.booking_id ?? null,
                reason: en.reason ?? null,
                attempts: (Number(en.attempts) || 0) + 1,
                last_error: String(e?.message || e).slice(0, 500),
            })),
            { onConflict: 'booking_item_id' },
        );
        console.error(`[KTVD] tính lại lỗi, đã trả ${entries.length} item về hàng đợi:`, e?.message || e);
        return { result: zero, failed: entries.length };
    }
}

/**
 * Tính ngay những item ĐANG NẰM TRONG HÀNG ĐỢI thuộc các booking chỉ định.
 *
 * Dùng lúc ĐỌC: màn lịch sử và ví biết trước danh sách đơn sắp hiển thị nên bó
 * đúng vào đó — chính xác tuyệt đối trong phạm vi đang xem, không phụ thuộc cron.
 *
 * Không ném lỗi ra ngoài: hiển thị chậm một nhịp còn hơn là vỡ màn hình.
 */
export async function drainQueueFor(
    supabase: SupabaseClient,
    bookingIds: string[],
): Promise<number> {
    if (bookingIds.length === 0) return 0;

    try {
        const queued: QueueEntry[] = [];
        for (let i = 0; i < bookingIds.length; i += IN_CHUNK) {
            const { data } = await supabase
                .from('KTVDRecomputeQueue')
                .select('booking_item_id, booking_id, reason, attempts')
                .in('booking_id', bookingIds.slice(i, i + IN_CHUNK))
                .lt('attempts', 5);
            if (data) queued.push(...(data as QueueEntry[]));
        }
        if (queued.length === 0) return 0;

        const { failed } = await takeAndRecompute(supabase, queued);
        return queued.length - failed;
    } catch (e: any) {
        console.error('[KTVD] drainQueueFor lỗi, bỏ qua:', e?.message || e);
        return 0;
    }
}

/**
 * Rút hàng đợi cho đúng những KTV đang được xem, không cần biết booking nào.
 *
 * `drainQueueFor()` yêu cầu biết trước bookingId — màn thứ tự tua và màn giờ tích
 * luỹ chỉ có staffId với tháng, nên không dùng được. Hàm này lật ngược lại: quét
 * hàng đợi rồi giữ những item có KTV nằm trong danh sách đang xem.
 *
 * ⚠️ Quét TOÀN BỘ hàng đợi, không phải "một lô nhỏ cũ nhất". Bản cũ lấy 100 dòng
 * cũ nhất RỒI mới lọc theo KTV — hàng đợi càng tồn đọng thì cửa sổ 100 đó càng
 * lùi về quá khứ, tới mức tua vừa xong không bao giờ lọt vào. Đo tối 10/09/2026:
 * hàng đợi 135 dòng, dòng thứ 101 trở đi nằm ngoài tầm với; KTV phải bấm tải lại
 * nhiều lần cho đống cũ vơi dần thì hai tua của mình mới hiện — trễ 46 phút. Mà
 * `net_hours` là khoá xếp thứ tự nhận khách, nên bảng điều phối trễ theo. Lọc
 * phải theo ĐÚNG thứ cần tìm, không theo thứ tự ngẫu nhiên của hàng đợi.
 *
 * Không ném lỗi ra ngoài: hiển thị chậm một nhịp còn hơn là vỡ màn hình.
 */
export async function drainQueueForStaff(
    supabase: SupabaseClient,
    staffIds: string[],
    maxScan = 2000,
): Promise<number> {
    if (staffIds.length === 0) return 0;
    const wanted = new Set(staffIds.map(s => String(s).toLowerCase()));

    try {
        const queued: QueueEntry[] = [];
        for (let page = 0; queued.length < maxScan; page++) {
            const { data } = await supabase
                .from('KTVDRecomputeQueue')
                .select('booking_item_id, booking_id, reason, attempts')
                .lt('attempts', 5)
                .order('enqueued_at', { ascending: true })
                .range(page * QUEUE_SCAN_PAGE, (page + 1) * QUEUE_SCAN_PAGE - 1);
            if (!data || data.length === 0) break;
            queued.push(...(data as QueueEntry[]));
            if (data.length < QUEUE_SCAN_PAGE) break;
        }
        if (queued.length === 0) return 0;

        // `technicianCodes` là mảng text và dữ liệu cũ có cả chữ hoa lẫn chữ
        // thường, nên phải so ở JS chứ không lọc thẳng trong truy vấn.
        const byId = new Map(queued.map(q => [q.booking_item_id, q]));
        const ids = [...byId.keys()];

        const mine: QueueEntry[] = [];
        for (let i = 0; i < ids.length; i += IN_CHUNK) {
            const { data: items } = await supabase
                .from('BookingItems')
                .select('id, technicianCodes')
                .in('id', ids.slice(i, i + IN_CHUNK));
            (items || []).forEach((it: any) => {
                const cuaHo = (it.technicianCodes || [])
                    .some((t: string) => wanted.has(String(t).toLowerCase()));
                const entry = byId.get(it.id);
                if (cuaHo && entry) mine.push(entry);
            });
        }
        if (mine.length === 0) return 0;

        const { failed } = await takeAndRecompute(supabase, mine);
        return mine.length - failed;
    } catch (e: any) {
        console.error('[KTVD] drainQueueForStaff lỗi, bỏ qua:', e?.message || e);
        return 0;
    }
}

/**
 * Dọn phần hàng đợi CÒN LẠI — thứ không thuộc KTV nào đang được xem.
 *
 * Trigger đẩy vào hàng đợi MỌI `BookingItems`, kể cả item của KTV loại A/B/C và
 * của KTV loại D mà không ai đang mở màn hình. Những dòng đó không đường rút-lúc-
 * đọc nào chạm tới, nên nếu chỉ dựa vào rút-lúc-đọc thì hàng đợi vẫn phình vô hạn
 * và cửa sổ quét lại nghẹt y như cũ — chỉ là ở ngưỡng cao hơn.
 *
 * Gọi trong `after()` của Next: chạy SAU khi response đã trả nên không làm chậm
 * màn hình. Mỗi lượt đọc gánh một ít; hàng đợi rỗng thì chỉ tốn một truy vấn trả
 * về 0 dòng.
 *
 * Nhờ hàm này, cron `/api/cron/ktvd-recompute` lùi về đúng vai lưới an toàn cho
 * ban đêm — cron chết cũng không ai phải ngồi chờ.
 */
export async function drainQueueBackground(
    supabase: SupabaseClient,
    batchSize = 200,
): Promise<void> {
    try {
        await drainRecomputeQueue(supabase, batchSize);
    } catch (e: any) {
        console.error('[KTVD] dọn hàng đợi nền lỗi, bỏ qua:', e?.message || e);
    }
}

export interface DrainResult extends RecomputeResult {
    queueTaken: number;
    queueRemaining: number;
    failed: number;
}

/**
 * Rút hàng đợi và tính lại — lô cũ nhất trước.
 *
 * Dùng chung `takeAndRecompute()` với hai đường rút lúc đọc, nên luật xoá-rồi-
 * dán-lại giống hệt nhau ở cả ba nơi.
 */
export async function drainRecomputeQueue(
    supabase: SupabaseClient,
    batchSize = 200,
): Promise<DrainResult> {
    const { data: queued, error } = await supabase
        .from('KTVDRecomputeQueue')
        .select('booking_item_id, booking_id, reason, attempts')
        .lt('attempts', 5)                       // bỏ qua item hỏng kinh niên
        .order('enqueued_at', { ascending: true })
        .limit(batchSize);
    if (error) throw error;

    const entries = (queued || []) as QueueEntry[];
    if (entries.length === 0) {
        const { count } = await supabase
            .from('KTVDRecomputeQueue')
            .select('booking_item_id', { count: 'exact', head: true });
        return {
            queueTaken: 0, queueRemaining: count || 0, failed: 0,
            itemsRequested: 0, rowsWritten: 0, rowsVoided: 0, rowsSkippedLocked: 0,
        };
    }

    const { result, failed } = await takeAndRecompute(supabase, entries);

    const { count } = await supabase
        .from('KTVDRecomputeQueue')
        .select('booking_item_id', { count: 'exact', head: true });

    return { ...result, queueTaken: entries.length, queueRemaining: count || 0, failed };
}
