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

/**
 * Tính ngay những item ĐANG NẰM TRONG HÀNG ĐỢI thuộc các booking chỉ định.
 *
 * Dùng lúc ĐỌC: tua vừa xong có thể còn chờ worker (chạy 5 phút/lần), nên
 * màn hình lịch sử / ví gọi hàm này để KTV thấy tua vừa làm mà không phải
 * chờ. Bó hẹp trong đúng các đơn đang xem — không quét cả hàng đợi.
 *
 * Không ném lỗi ra ngoài: hiển thị chậm một nhịp còn hơn là vỡ màn hình.
 */
export async function drainQueueFor(
    supabase: SupabaseClient,
    bookingIds: string[],
): Promise<number> {
    if (bookingIds.length === 0) return 0;

    const { data: queued } = await supabase
        .from('KTVDRecomputeQueue')
        .select('booking_item_id')
        .in('booking_id', bookingIds)
        .limit(500);

    const itemIds = (queued || []).map((q: any) => q.booking_item_id);
    if (itemIds.length === 0) return 0;

    await supabase.from('KTVDRecomputeQueue').delete().in('booking_item_id', itemIds);
    await recomputeTurnRows(supabase, itemIds);
    return itemIds.length;
}

/**
 * Rút hàng đợi cho đúng những KTV đang được xem, không cần biết booking nào.
 *
 * `drainQueueFor()` yêu cầu biết trước bookingId — màn thứ tự tua chỉ có staffId
 * và tháng, nên không dùng được. Hàm này lấy một lô nhỏ trong hàng đợi rồi giữ
 * lại các item có KTV nằm trong danh sách đang xem.
 *
 * Nhờ vậy giờ tích lũy cập nhật ngay khi KTV mở màn hình, không phải chờ cron
 * 5 phút. Cron vẫn giữ vai trò lưới an toàn cho những KTV không ai đang xem.
 *
 * Không ném lỗi ra ngoài: hiển thị chậm một nhịp còn hơn là vỡ màn hình.
 */
export async function drainQueueForStaff(
    supabase: SupabaseClient,
    staffIds: string[],
    max = 100,
): Promise<number> {
    if (staffIds.length === 0) return 0;
    const wanted = new Set(staffIds.map(s => String(s).toLowerCase()));

    try {
        const { data: queued } = await supabase
            .from('KTVDRecomputeQueue')
            .select('booking_item_id')
            .lt('attempts', 5)
            .order('enqueued_at', { ascending: true })
            .limit(max);

        const ids = (queued || []).map((q: any) => q.booking_item_id);
        if (ids.length === 0) return 0;

        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, technicianCodes')
            .in('id', ids);

        const mine = (items || [])
            .filter((i: any) => (i.technicianCodes || [])
                .some((t: string) => wanted.has(String(t).toLowerCase())))
            .map((i: any) => i.id);
        if (mine.length === 0) return 0;

        await supabase.from('KTVDRecomputeQueue').delete().in('booking_item_id', mine);
        await recomputeTurnRows(supabase, mine);
        return mine.length;
    } catch (e) {
        console.error('[KTVD] drainQueueForStaff lỗi, bỏ qua:', e);
        return 0;
    }
}

export interface DrainResult extends RecomputeResult {
    queueTaken: number;
    queueRemaining: number;
    failed: number;
}

/**
 * Rút hàng đợi và tính lại.
 *
 * Xoá khỏi hàng đợi TRƯỚC khi tính. Nếu tính lỗi thì nhét lại kèm `last_error`
 * và tăng `attempts` — an toàn hơn là giữ nguyên rồi tính lại mãi một item hỏng
 * làm nghẽn cả hàng đợi.
 */
export async function drainRecomputeQueue(
    supabase: SupabaseClient,
    batchSize = 200,
): Promise<DrainResult> {
    const { data: queued, error } = await supabase
        .from('KTVDRecomputeQueue')
        .select('booking_item_id, attempts')
        .lt('attempts', 5)                       // bỏ qua item hỏng kinh niên
        .order('enqueued_at', { ascending: true })
        .limit(batchSize);
    if (error) throw error;

    const itemIds = (queued || []).map((q: any) => q.booking_item_id);
    if (itemIds.length === 0) {
        const { count } = await supabase
            .from('KTVDRecomputeQueue')
            .select('booking_item_id', { count: 'exact', head: true });
        return {
            queueTaken: 0, queueRemaining: count || 0, failed: 0,
            itemsRequested: 0, rowsWritten: 0, rowsVoided: 0, rowsSkippedLocked: 0,
        };
    }

    await supabase.from('KTVDRecomputeQueue').delete().in('booking_item_id', itemIds);

    let result: RecomputeResult;
    let failed = 0;
    try {
        result = await recomputeTurnRows(supabase, itemIds);
    } catch (e: any) {
        failed = itemIds.length;
        const attemptsBy: Record<string, number> = {};
        (queued || []).forEach((q: any) => { attemptsBy[q.booking_item_id] = Number(q.attempts) || 0; });
        await supabase.from('KTVDRecomputeQueue').upsert(
            itemIds.map(id => ({
                booking_item_id: id,
                attempts: (attemptsBy[id] || 0) + 1,
                last_error: String(e?.message || e).slice(0, 500),
            })),
            { onConflict: 'booking_item_id' },
        );
        result = { itemsRequested: itemIds.length, rowsWritten: 0, rowsVoided: 0, rowsSkippedLocked: 0 };
    }

    const { count } = await supabase
        .from('KTVDRecomputeQueue')
        .select('booking_item_id', { count: 'exact', head: true });

    return { ...result, queueTaken: itemIds.length, queueRemaining: count || 0, failed };
}
