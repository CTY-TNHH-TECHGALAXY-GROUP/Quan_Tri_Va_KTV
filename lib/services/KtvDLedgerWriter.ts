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

const FORMULA_REVISION = 2;

interface QueueEntry {
    booking_item_id: string;
    booking_id?: string | null;
    reason?: string | null;
    attempts?: number | null;
    generation: number;
}

const writerCommit = (): string =>
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local';

async function computeAndCommit(
    supabase: SupabaseClient,
    entries: QueueEntry[],
    ctx?: LedgerContext,
): Promise<RecomputeResult> {
    const itemIds = entries.map(e => e.booking_item_id);
    const context = ctx || await loadContext(supabase);

    const { data: idRows, error: idErr } = await supabase
        .from('BookingItems')
        .select('bookingId')
        .in('id', itemIds);
    if (idErr) throw idErr;

    const bookingIds = [...new Set((idRows || []).map((r: any) => r.bookingId).filter(Boolean))];
    let bookings: any[] = [];
    if (bookingIds.length > 0) {
        const { data, error } = await supabase
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
        if (error) throw error;
        bookings = data || [];
    }

    const live = bookings.filter((b: any) => b.status !== 'CANCELLED');
    const rows = computeRows(live as any, context.staffIds, context.services, context.configs)
        .filter((r: TurnRow) => itemIds.includes(r.booking_item_id));

    const { data, error } = await supabase.rpc('ktvd_commit_recompute', {
        p_formula_revision: FORMULA_REVISION,
        p_writer_commit: writerCommit(),
        p_entries: entries.map(e => ({
            booking_item_id: e.booking_item_id,
            generation: e.generation,
        })),
        p_rows: rows,
    });
    if (error) throw error;
    return data as RecomputeResult;
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

    const { error: enqueueError } = await supabase.rpc('ktvd_enqueue_recompute', {
        p_item_ids: itemIds,
        p_reason: 'DIRECT',
    });
    if (enqueueError) throw enqueueError;

    const { data: queued, error: queueError } = await supabase
        .from('KTVDRecomputeQueue')
        .select('booking_item_id, booking_id, reason, attempts, generation')
        .in('booking_item_id', itemIds);
    if (queueError) throw queueError;
    if (!queued || queued.length !== new Set(itemIds).size) {
        throw new Error('Không thể xếp đủ BookingItem vào hàng đợi tính tiền tua D');
    }

    return computeAndCommit(supabase, queued as QueueEntry[], ctx);
}

/** Số dòng lấy mỗi lượt khi quét hàng đợi. */
const QUEUE_SCAN_PAGE = 500;
/** Số id tối đa nhét vào một mệnh đề `.in()` — dài quá thì URL PostgREST vỡ. */
const IN_CHUNK = 200;

/**
 * Tính rồi commit kết quả và acknowledge đúng generation trong một transaction.
 * Nếu nguồn đổi trong lúc tính, RPC từ chối toàn bộ và hàng đợi vẫn còn nguyên.
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

    try {
        return { result: await computeAndCommit(supabase, entries), failed: 0 };
    } catch (e: any) {
        const { error: markError } = await supabase.rpc('ktvd_mark_recompute_failed', {
            p_formula_revision: FORMULA_REVISION,
            p_entries: entries.map(en => ({
                booking_item_id: en.booking_item_id,
                generation: en.generation,
            })),
            p_error: String(e?.message || e),
        });
        console.error('[KTVD] tính lại lỗi, hàng đợi được giữ nguyên:', e?.message || e,
            markError ? `| không ghi được lỗi: ${markError.message}` : '');
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
                .select('booking_item_id, booking_id, reason, attempts, generation')
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
                .select('booking_item_id, booking_id, reason, attempts, generation')
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
        .select('booking_item_id, booking_id, reason, attempts, generation')
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
