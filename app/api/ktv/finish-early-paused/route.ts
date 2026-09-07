import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { syncTurnsForDate } from '@/lib/turn-sync';
import { recomputeBookingStatus } from '@/lib/dispatch-status';
import { getBusinessDate } from '../booking/_shared/utils';
import { workedMsOf, closeOpenPause } from '@/lib/segment-time';
import { logCounterAction, currentCounterActor } from '@/lib/counter-action-log';

/**
 * ============================================================
 * ⏹️ KẾT THÚC ĐƠN SỚM KHI ĐANG TẠM DỪNG
 * ============================================================
 * Nút "Kết thúc" trên thẻ Kanban của đơn đang tạm dừng.
 *
 * ⏱️ MỐC GIỜ (quyết định tiền công — không được sai):
 *   - Giờ kết thúc lấy `pauseStart` (lúc bấm tạm dừng), KHÔNG lấy giờ hiện tại.
 *     Khoảng từ lúc tạm dừng đến lúc lễ tân bấm kết thúc là thời gian chờ,
 *     KTV không làm nên không được tính tiền.
 *   - Giờ làm thực = (pauseStart − actualStartTime) − Σ(các lần đã tạm dừng trước
 *     đó trong cùng chặng). Dùng workedMsOf() để tính, ĐỪNG trừ tay: từ 06/09/2026
 *     `actualStartTime` không còn bị dời nữa nên các khoảng dừng cũ vẫn nằm trong
 *     hiệu (end − start), tính tay là trả thừa tiền. Xem lib/segment-time.ts.
 *   - Phải ghi `customCommissionDuration`: thiếu nó thì
 *     KtvCommissionService.calculateItemDuration trả về giờ GÁN → trả thừa tiền.
 *   - Chặn trên tại giờ gán, đúng quy tắc của computeMinutes (KtvDLedgerEngine),
 *     để mốc giờ hỏng không đẻ ra tua 24 tiếng.
 *
 * 🔓 KHÔNG giải phóng KTV ở đây — xem ghi chú dài phía dưới. KTV còn phải đi qua
 *   Dọn phòng → Bàn giao rồi mới được nhả tua, giống hệt khi họ tự bấm xong.
 * ============================================================
 */

export async function POST(req: Request) {
    try {
        await requirePermission('dispatch_board');

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const body = await req.json().catch(() => ({}));
        const bookingId = body.bookingId;
        const itemIds = body.itemIds || [];

        if (!bookingId || !Array.isArray(itemIds) || itemIds.length === 0) {
            return NextResponse.json({ success: false, error: 'Thiếu thông tin đơn hàng (bookingId hoặc itemIds)' }, { status: 400 });
        }

        const { data: itemsToProcess, error: itemsError } = await supabase
            .from('BookingItems')
            .select('id, bookingId, status, pauseStart, segments, options, "technicianCodes"')
            .in('id', itemIds);

        if (itemsError) throw itemsError;
        if (!itemsToProcess || itemsToProcess.length === 0) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy dịch vụ' }, { status: 404 });
        }

        const pausedItems = itemsToProcess.filter(it => it.status === 'PAUSED');
        if (pausedItems.length === 0) {
            return NextResponse.json({ success: false, error: 'Không có dịch vụ nào đang tạm dừng để kết thúc' }, { status: 400 });
        }

        const affectedKtvIds = new Set<string>();
        const finishedItemIds: string[] = [];

        for (const it of pausedItems) {
            // Mốc kết thúc = lúc bấm tạm dừng. Chỉ khi thiếu pauseStart (dữ liệu cũ) mới đành lấy giờ hiện tại.
            const effectiveEnd = it.pauseStart || new Date().toISOString();

            let segs = it.segments;
            if (typeof segs === 'string') {
                try { segs = JSON.parse(segs); } catch { segs = []; }
            }

            // Nhãn "ra sớm": đơn kết thúc trước giờ vì khách xuống sớm, không phải
            // lỗi KTV. Kanban dựa vào cờ này để hiện nhãn và để BỎ QUA bước Chờ đánh
            // giá khi dọn phòng xong — khách đã về thì không còn ai chấm sao.
            let opts = it.options;
            if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { opts = {}; } }
            opts = opts || {};
            opts.earlyLeave = true;

            const payload: any = {
                status: 'CLEANING',
                pauseStart: null,          // gỡ cờ tạm dừng, nếu không UI vẫn coi đơn đang dừng
                timeEnd: effectiveEnd,     // khớp với actualEndTime của chặng
                options: opts,
            };

            if (Array.isArray(segs)) {
                for (const seg of segs) {
                    if (!seg.actualStartTime || seg.actualEndTime) continue;

                    // ⚠️ Phải dùng workedMsOf: nó trừ các lần đã tạm dừng TRƯỚC ĐÓ trong
                    // cùng chặng. Tính tay (end − start) sẽ tính luôn cả những khoảng
                    // ngồi chờ đó thành giờ làm, trả thừa tiền.
                    const workedMs = workedMsOf(seg, effectiveEnd);
                    let workedMins = workedMs === null ? 0 : Math.round(workedMs / 60000);

                    // Chặn trên tại giờ gán — mốc hỏng không được đẻ ra giờ làm ảo.
                    const assignedMins = Number(seg.duration) || 0;
                    if (assignedMins > 0 && workedMins > assignedMins) workedMins = assignedMins;

                    closeOpenPause(seg, effectiveEnd, 'FINISH');

                    seg.actualEndTime = effectiveEnd;
                    seg.customCommissionDuration = workedMins;
                    seg.note = 'FINISHED_EARLY_ON_PAUSE';

                    if (seg.ktvId) affectedKtvIds.add(String(seg.ktvId));
                }
                payload.segments = JSON.stringify(segs);
            }

            if (Array.isArray(it.technicianCodes)) {
                it.technicianCodes.filter(Boolean).forEach((k: string) => affectedKtvIds.add(String(k)));
            }

            const { error: updErr } = await supabase.from('BookingItems').update(payload).eq('id', it.id);
            if (updErr) throw updErr;
            finishedItemIds.push(it.id);
        }

        const actor = await currentCounterActor();
        await logCounterAction(supabase, finishedItemIds, {
            action: 'FINISH_EARLY',
            by: actor.id,
            byName: actor.name,
            note: 'chốt tại mốc tạm dừng',
        });

        // ─── Tính lại trạng thái Booking (cả đơn cha lẫn đơn con) ───
        const { data: booking, error: bookingErr } = await supabase
            .from('Bookings')
            .select('id, parent_booking_id')
            .eq('id', bookingId)
            .maybeSingle();
        if (bookingErr) throw bookingErr;

        const parentId = booking?.parent_booking_id || bookingId;
        const { data: childBookings } = await supabase
            .from('Bookings')
            .select('id')
            .eq('parent_booking_id', parentId);

        const allBookingIds = Array.from(new Set([parentId, bookingId, ...(childBookings?.map(b => b.id) || [])]));

        const { data: allBookingItems } = await supabase
            .from('BookingItems')
            .select('status')
            .in('bookingId', allBookingIds);

        if (allBookingItems && allBookingItems.length > 0) {
            let bStatus = recomputeBookingStatus(allBookingItems.map(i => i.status));
            if (bStatus === 'DONE') bStatus = 'CLEANING'; // items vừa chuyển sang CLEANING
            const { error: bUpdErr } = await supabase.from('Bookings').update({ status: bStatus }).in('id', allBookingIds);
            if (bUpdErr) throw bUpdErr;
        }

        // ─── KHÔNG giải phóng KTV ở đây ───
        // ⚠️ ĐỪNG xoá TurnQueue.current_order_id hay đóng KtvAssignments tại bước này.
        // Màn KTV tìm đơn của mình theo thứ tự: item IN_PROGRESS → TurnQueue.current_order_id
        // → KtvAssignments QUEUED/READY (handleGetBooking). Item vừa chuyển sang CLEANING
        // nên nhánh đầu đã trượt; cắt nốt hai nhánh sau thì API trả `data: null` và KTV bị
        // đá thẳng về Dashboard, MẤT luôn bước Dọn phòng → Bàn giao (không có ảnh bàn giao,
        // đơn nằm lại CLEANING).
        //
        // Luồng chuẩn khi KTV tự bấm xong cũng không đụng TurnQueue: handleFinishService chỉ
        // đổi trạng thái item, việc nhả tua để handleReleaseKTV làm SAU khi bàn giao xong.
        // Kết thúc hộ từ quầy phải đi đúng đường đó.
        //
        // Trường hợp KTV bỏ khách, không có ai bàn giao → dùng luồng HUỶ đơn (luồng đó mới
        // giải phóng tua), xem plans/plan_tam_dung_huy_ket_thuc_som.md.
        const businessDate = getBusinessDate();
        await syncTurnsForDate(businessDate);

        return NextResponse.json({
            success: true,
            // KTV chưa được nhả tua ở đây — họ còn phải đi qua Dọn phòng → Bàn giao.
            data: { itemIdsFinished: finishedItemIds, ktvIds: Array.from(affectedKtvIds) },
        });
    } catch (e: any) {
        const msg = e?.message || 'Server error';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('finish-early-paused error:', e);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
