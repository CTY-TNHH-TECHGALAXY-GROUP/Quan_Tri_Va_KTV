import { NextResponse } from 'next/server';
import { HandlerContext, HandlerResult } from '../_shared/utils';
import { isLiveKtvSegment, parseKtvSegments, parseKtvOptions } from '@/lib/ktvUtils';
import { calculateAccurateEndTimeFromSegments } from '@/lib/time-helper';
import { isTwoSlotSequential } from '@/lib/dispatch-status';

export async function handleStartTimer(ctx: HandlerContext): Promise<HandlerResult> {
    const { supabase, bookingId, technicianCode, action, allItemIdsForThisKTV, body } = ctx;
    const fail = (error: string, status = 409): HandlerResult => ({ bookingUpdatePayload: {},
        earlyResponse: NextResponse.json({ success: false, error }, { status }) });
    const { data: booking, error: bookingError } = await supabase.from('Bookings')
        .select('id, status, rating, timeStart, bookingDate, BookingGuests(id, rating)').eq('id', bookingId).single();
    if (bookingError || !booking) return fail('Không đọc được đơn; tải lại.', 500);
    if (!['START_TIMER', 'NEXT_SEGMENT'].includes(action)) {
        return { bookingUpdatePayload: {}, bookingPersisted: true, bookingData: booking };
    }
    const { data: items, error: itemError } = await supabase.from('BookingItems')
        .select('id, segments, status, itemRating, guest_id, options, handover_status, handover_images, handover_skipped, handover_submitted_at, serviceId')
        .eq('bookingId', bookingId);
    if (itemError || !items?.length) return fail('Không đọc được chặng; tải lại.', 500);
    const snapshots = structuredClone(items);
    const ids = new Set(allItemIdsForThisKTV);
    const work: any[] = [];
    for (const item of items) {
        if (!ids.has(item.id)) continue;
        const segments = parseKtvSegments(item.segments, true);
        if (!segments.length) return fail('Dữ liệu chặng không hợp lệ.');
        for (const seg of segments) {
            if (isLiveKtvSegment(seg, technicianCode)) work.push({ item, seg, segments });
        }
    }
    work.sort((a, b) => String(a.seg.plannedStartAt || a.seg.startTime || '').localeCompare(String(b.seg.plannedStartAt || b.seg.startTime || ''))
        || String(a.seg.id).localeCompare(String(b.seg.id)));
    const index = body.activeSegmentIndex ?? 0;
    if (!Number.isInteger(index) || index < 0) return fail('Chặng làm việc không hợp lệ.', 400);
    const target = body.targetSegmentId ? work.find(s => s.seg.id === body.targetSegmentId) : work[index];
    if (!target || !target.seg.id || target.seg.actualEndTime || ['DONE', 'CANCELLED'].includes(target.item.status)) {
        return fail('Chặng đã thay đổi hoặc đã hoàn tất; tải lại.');
    }
    if (target.item.status === 'PAUSED') return fail('Ca đang tạm dừng; lễ tân cần cho tiếp tục trước khi bắt đầu.');
    if (target.seg.actualStartTime) {
        // Retry after a committed START keeps the stamp and the existing proof URLs.
        return { bookingUpdatePayload: {}, bookingPersisted: true, bookingData: booking };
    }
    const serviceDay = String(booking.bookingDate || '').slice(0, 10);
    const allowedAt = target.seg.plannedStartAt || `${serviceDay}T${target.seg.startTime}:00+07:00`;
    let assignedB = false;
    if (Number(target.seg.sequenceSlot) === 2 && isTwoSlotSequential(target.item.options)) {
        const first = target.segments.find((seg: any) => Number(seg.sequenceSlot) === 1 && seg.voided !== true && seg.voided !== 'true');
        if (!first?.actualStartTime) return fail('Chờ KTV lượt 1 bắt đầu trước khi bắt đầu lượt 2.');
        const { data, error } = await supabase.from('KtvAssignments').select('id')
            .eq('booking_id', bookingId).eq('booking_item_id', target.item.id).eq('segment_id', target.seg.id)
            .eq('employee_id', technicianCode).eq('status', 'ACTIVE').maybeSingle();
        if (error) return fail('Không đọc được phân công B.', 500);
        assignedB = !!data;
        if (!assignedB) return fail('B không còn được gán; tải lại.');
    }
    if (!Number.isFinite(Date.parse(allowedAt))) return fail('Giờ phân công không hợp lệ.');
    if (action === 'START_TIMER' && !assignedB && Date.now() < Date.parse(allowedAt) - 5000) {
        return fail(`Chưa đến giờ bắt đầu ${target.seg.startTime}.`, 403);
    }
    const merge = action === 'START_TIMER' && body.shouldMerge === true;
    const run = merge ? work : [target];
    if (merge && (run.some(s => s.seg.actualStartTime || s.seg.actualEndTime || ['DONE', 'CANCELLED'].includes(s.item.status))
        || new Set(run.map(s => s.seg.roomId)).size !== 1 || !target.seg.roomId)) {
        return fail('Các chặng không còn đủ điều kiện gộp; tải lại.');
    }
    const previous = action === 'NEXT_SEGMENT' ? work[work.indexOf(target) - 1] : null;
    if (action === 'NEXT_SEGMENT' && (!previous?.seg.actualStartTime || previous.item.status === 'CANCELLED')) {
        return fail('Chặng trước chưa bắt đầu; không thể chuyển chặng.');
    }
    const paths: string[] = [];
    const upload = async (raw: unknown, prefix: string) => {
        const match = typeof raw === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw) : null;
        if (!match) throw new Error('Ảnh phải là JPEG, PNG hoặc WEBP.');
        const bytes = Buffer.from(match[2], 'base64');
        const signatures = { jpeg: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
            png: bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
            webp: bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' };
        const mime = match[1].toLowerCase() as keyof typeof signatures;
        if (!bytes.length || bytes.length > 5 * 1024 * 1024 || !signatures[mime]) throw new Error('Ảnh không hợp lệ hoặc quá 5 MB.');
        const { data, error } = await supabase.storage.from('attendance').upload(
            `${prefix}_${crypto.randomUUID()}.${mime === 'jpeg' ? 'jpg' : mime}`, bytes, { contentType: `image/${mime}`, upsert: false });
        if (error || !data?.path) throw error || new Error('Tải ảnh thất bại.');
        paths.push(data.path);
        const { data: url } = supabase.storage.from('attendance').getPublicUrl(data.path);
        if (!url?.publicUrl) throw new Error('Không đọc được URL ảnh.');
        return url.publicUrl;
    };
    let attemptedCommit = false;
    try {
        const slipper = action === 'START_TIMER' ? await upload(body.guestSlipperPhotoBase64, 'slipper') : null;
        const start = action === 'START_TIMER' ? await upload(body.startPhotoBase64 || body.photoBase64, 'start') : null;
        const now = new Date().toISOString();
        for (const entry of run) {
            entry.seg.actualStartTime = now;
            if (merge) { entry.seg.isMergedRun = true; entry.seg.mergedRunId = now; }
            if (start) entry.seg.startPhotoUrl = start;
            if (slipper) entry.seg.guestSlipperPhotoUrl = slipper;
        }
        if (previous && !previous.seg.actualEndTime) previous.seg.actualEndTime = now;
        const changedIds = new Set([...run.map(s => s.item.id), ...(previous ? [previous.item.id] : [])]);
        const updates = [...changedIds].map(id => {
            const entry = work.find(s => s.item.id === id)!;
            const done = entry.segments.filter((s: any) => s.ktvId && s.voided !== true && s.voided !== 'true').every((s: any) => s.actualStartTime && s.actualEndTime);
            return { id, status: done && !isTwoSlotSequential(entry.item.options) ? 'CLEANING' : 'IN_PROGRESS', segments: JSON.stringify(entry.segments) };
        });
        for (const item of items) {
            const parentId = parseKtvOptions(item.options).mergedIntoId;
            if (changedIds.has(parentId) && !changedIds.has(item.id) && !['DONE', 'CANCELLED'].includes(item.status)
                && !parseKtvSegments(item.segments).some(s => s.ktvId && s.voided !== true && s.voided !== 'true')) {
                updates.push({ id: item.id, status: 'IN_PROGRESS', segments: item.segments });
            }
        }
        const clock = new Date(now).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
        const turnPatch = { status: 'working', current_order_id: bookingId, start_time: clock,
            room_id: target.seg.roomId || null, bed_id: target.seg.bedId || null,
            booking_item_id: target.item.id, booking_item_ids: [...new Set(run.map(s => s.item.id))],
            estimated_end_time: calculateAccurateEndTimeFromSegments(run, clock) };
        attemptedCommit = true;
        const { data, error } = await supabase.rpc('ktv_start_service_atomic', {
            p_booking_id: bookingId, p_booking_snapshot: { id: booking.id, status: booking.status, rating: booking.rating, timeStart: booking.timeStart },
            p_item_snapshots: snapshots, p_guest_ratings: booking.BookingGuests || [], p_updates: updates,
            p_employee_id: technicianCode, p_target_segment_id: target.seg.id, p_started_at: now, p_turn_patch: turnPatch,
        });
        if (error) {
            console.error('[KTV START] Atomic commit failed', { bookingId, technicianCode, segmentId: target.seg.id, error });
            if (error.message?.includes('Ca trước chưa bàn giao')) return fail('Ca trước chưa bàn giao xong; hoàn tất bàn giao hoặc nhờ quầy kiểm tra phân công.');
            return fail('Chưa xác nhận được lưu bắt đầu. Tải lại trước khi thử lại.');
        }
        if (!data?.success || !data.booking) return fail('Chưa xác nhận được lưu bắt đầu. Tải lại trước khi thử lại.');
        return { bookingUpdatePayload: {}, bookingPersisted: true, bookingData: data.booking };
    } catch (error: any) {
        // Once an RPC was attempted, a network timeout cannot prove rollback. Do not delete referenced proof photos.
        if (!attemptedCommit && paths.length) {
            const { error: cleanupError } = await supabase.storage.from('attendance').remove(paths);
            if (cleanupError) console.error('Proof cleanup failed', cleanupError);
        }
        return fail(error?.message || 'Chưa lưu được bắt đầu.', 500);
    }
}
