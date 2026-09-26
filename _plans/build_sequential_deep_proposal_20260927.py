"""Build review-only candidates in /tmp; never edit runtime sources."""
from pathlib import Path
import difflib
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/sequential-deep-proposal-20260927')
changes = {}

def baseline(name):
    return subprocess.check_output(['git', 'show', 'bc06814f:' + name], cwd=ROOT).decode()

def read(name):
    return changes.get(name, baseline(name))

def put(name, value):
    changes[name] = value

def replace(name, old, new):
    source = read(name)
    assert old in source, (name, old[:100])
    put(name, source.replace(old, new))

def import_utils(name, *names):
    source = read(name)
    pattern = r"import \{([^}]+)\} from '@/lib/ktvUtils';"
    match = re.search(pattern, source)
    if match:
        values = [v.strip() for v in match[1].split(',')]
        values += [v for v in names if v not in values]
        source = source[:match.start()] + "import { " + ', '.join(values) + " } from '@/lib/ktvUtils';" + source[match.end():]
    else:
        source = "import { " + ', '.join(names) + " } from '@/lib/ktvUtils';\n" + source
    put(name, source)

put('lib/ktvUtils.ts', read('lib/ktvUtils.ts') + '''
/** UI tolerates legacy encoding; mutation handlers must reject invalid shapes. */
export function parseKtvSegments(raw: unknown, strict = false): any[] {
    try {
        for (let i = 0; i < 2 && typeof raw === 'string'; i++) raw = JSON.parse(raw);
        if (strict && raw != null && (!Array.isArray(raw) || raw.some(s => !s || typeof s !== 'object' || Array.isArray(s)))) throw new Error('Dữ liệu chặng không hợp lệ.');
        return Array.isArray(raw) ? raw.filter(s => s && typeof s === 'object' && !Array.isArray(s)) : [];
    } catch (error) { if (strict) throw error; return []; }
}

/** Undefined means absent; an explicit empty string is a saved clear. */
export function ktvMetadataValue(raw: unknown, code: string): string | undefined {
    const entries = Object.entries(parseKtvOptions(raw));
    const key = code.trim().toLowerCase();
    const exact = entries.find(([id]) => id === code);
    const value = (exact || entries.find(([id]) => id.trim().toLowerCase() === key))?.[1];
    return typeof value === 'string' ? value : undefined;
}

/** Retain other employees' values, normalize aliases, and persist explicit clears. */
export function ktvMetadataMap(raw: unknown, rows: any[], field: string): Record<string, string> {
    const result = { ...parseKtvOptions(raw) };
    for (const row of rows) {
        if (!row.ktvId || row[field] === undefined) continue;
        for (const key of Object.keys(result)) {
            if (key.trim().toLowerCase() === row.ktvId.trim().toLowerCase()) delete result[key];
        }
        result[row.ktvId] = String(row[field] ?? '');
    }
    return result;
}

/** A time edit changes the clock within the booking's service run, never its service day. */
export function sequentialClockAt(serviceDay: string, aStartClock: string, bClock: string): string | null {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(serviceDay)
        || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(aStartClock.slice(0, 5))
        || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(bClock)) return null;
    const start = Date.parse(`${serviceDay}T${bClock}:00+07:00`);
    return Number.isFinite(start) ? new Date(start + (bClock < aStartClock.slice(0, 5) ? 86400000 : 0)).toISOString() : null;
}
''')
replace('lib/ktvUtils.ts', "Object.entries(names).find(([id]) => id.trim().toLowerCase() === code?.trim().toLowerCase())?.[1]", "ktvMetadataValue(names, code || '')")

# Safe shape parsing at every employee read path, not only the crashing component.
for name in ['app/ktv/dashboard/_screens/ScreenTimer.tsx', 'app/ktv/dashboard/_screens/ScreenDashboard.tsx',
             'app/ktv/dashboard/KTVDashboard.logic.ts', 'app/api/ktv/booking/_handlers/handleGetBooking.ts',
             'app/api/ktv/booking/_handlers/handleFinishService.ts', 'app/reception/dispatch/useDispatchBoard.logic.ts']:
    import_utils(name, 'parseKtvSegments')
    source = read(name)
    source = re.sub(r"typeof ([\w?.]+)\.segments === 'string'\s*\? JSON\.parse\(\1\.segments\)\s*:\s*\(Array\.isArray\(\1\.segments\) \? \1\.segments : \[\]\)", r'parseKtvSegments(\1.segments)', source)
    source = re.sub(r"typeof ([\w?.]+)\.segments === 'string'\s*\? JSON\.parse\(\1\.segments\)\s*:\s*\(\1\.segments \|\| \[\]\)", r'parseKtvSegments(\1.segments)', source)
    # The optional i/ai predicates sometimes use a different spelling on the RHS.
    source = re.sub(r"typeof (ai)\.segments === 'string'\s*\? JSON\.parse\(ai\.segments\)\s*:\s*\([^;]*?\[\]\)", r'parseKtvSegments(\1.segments)', source)
    source = source.replace('JSON.parse(i.segments)', 'parseKtvSegments(i.segments)')
    source = source.replace('segs = i.segments;', 'segs = parseKtvSegments(i.segments);')
    source = re.sub(r"typeof ([\w]+)\??\.segments === 'string'\s*\? JSON\.parse\(\1\.segments\)\s*:\s*\([^;]*?\[\]\)", r'parseKtvSegments(\1?.segments)', source)
    put(name, source)

name = 'app/reception/dispatch/useDispatchBoard.logic.ts'
import_utils(name, 'ktvMetadataValue')
for code in ['tCode', 't.employee_id']:
    replace(name, f"bi.options?.notesForKtvs?.[{code}] || bi.options?.noteForKtv || ''",
            f"ktvMetadataValue(parsedOptions.notesForKtvs, {code}) ?? parsedOptions.noteForKtv ?? ''")
    replace(name, f"parsedOptions?.serviceNamesForKtvs?.[{code}] ?? ''",
            f"ktvMetadataValue(parsedOptions.serviceNamesForKtvs, {code}) ?? ''")

name = 'app/reception/dispatch/_components/QuickDispatchTable.tsx'
import_utils(name, 'ktvMetadataMap', 'parseKtvOptions')
replace(name, "serviceNamesForKtvs: Object.fromEntries(svc.staffList.filter(row => row.ktvId && row.serviceNameForKtv).map(row => [row.ktvId, row.serviceNameForKtv]))",
        "serviceNamesForKtvs: ktvMetadataMap(parseKtvOptions(svc.options).serviceNamesForKtvs, svc.staffList, 'serviceNameForKtv'),\n      notesForKtvs: ktvMetadataMap(parseKtvOptions(svc.options).notesForKtvs, svc.staffList, 'noteForKtv')")

# Timeline displays the plan and actual clocks separately. No inferred clock from another row.
name = 'app/ktv/dashboard/_screens/ScreenTimer.tsx'
source = read(name)
start = source.index('  const actualStartTime = segments[0]')
end = source.index('\n  return (', start)
source = source[:start] + '''  const clock = (value: any, offset = 0): string => {
    if (!value) return '—';
    if (/^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(String(value))) {
      const [h, m] = String(value).split(':').map(Number);
      const minutes = ((h * 60 + m + offset) % 1440 + 1440) % 1440;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Date(date.getTime() + offset * 60000).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }) : '—';
  };
  // shouldMerge alone is a suggestion until START has persisted the run membership.
  const merged = shouldMerge && segments.length > 1 && segments.every(seg => seg.isMergedRun && seg.actualStartTime)
    && new Set(segments.map(seg => seg.mergedRunId || seg.actualStartTime)).size === 1;
  const displaySegments = merged ? [{ ...segments[0],
    duration: totalAssignedMins || segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0),
    actualEndTime: segments.every(seg => seg.actualEndTime) ? segments[segments.length - 1].actualEndTime : undefined,
    plannedEndAt: segments[segments.length - 1].plannedEndAt,
    endTime: segments[segments.length - 1].endTime,
  }] : segments;
  const segmentsWithTimes = displaySegments.map(seg => ({
    seg,
    displayStartTime: clock(seg.plannedStartAt || seg.startTime),
    displayEndTime: clock(seg.plannedEndAt || seg.endTime),
    actualText: seg.actualStartTime ? `Thực tế ${clock(seg.actualStartTime)} → ${seg.actualEndTime
      ? clock(seg.actualEndTime) : `${clock(seg.actualStartTime, Number(seg.duration) || 0)} (dự kiến kết thúc)`}` : '',
  }));
''' + source[end:]
source = source.replace('if (!segments || segments.length === 0)', 'if (!Array.isArray(segments) || segments.length === 0)')
source = source.replace('segmentsWithTimes.map(({ seg, displayStartTime, displayEndTime }, idx)', 'segmentsWithTimes.map(({ seg, displayStartTime, displayEndTime, actualText }, idx)')
source = source.replace("const isActive = shouldMerge ?", "const isActive = merged ?").replace("const isPast = shouldMerge ?", "const isPast = merged ?")
source = source.replace("{shouldMerge && '(Gộp)'}", "{merged && '(Gộp)'}")
source = source.replace('Phòng {roomLabel(seg.roomId)}', 'Phòng {roomLabel(seg.roomId)}\n                  <span className="ml-2 text-[9px] font-normal">Giờ phân công</span>')
source = source.replace('Giường {seg.bedId?.split', "{actualText && <span className=\"block normal-case\">{actualText}</span>}\n                  Giường {seg.bedId?.split")
put(name, source)

# FINISH cannot fabricate the start of an unstarted service or rewrite another run.
name = 'app/api/ktv/booking/_handlers/handleFinishService.ts'
source = read(name)
source = source.replace("const isMerged = allGlobalSegs.length > 1", "const isMerged = allGlobalSegs.length > 1\n        && allGlobalSegs.every((s: any) => s.seg.actualStartTime && s.seg.isMergedRun)\n        && new Set(allGlobalSegs.map((s: any) => s.seg.mergedRunId || s.seg.actualStartTime)).size === 1")
needle = "    // 📸 UPLOAD HANDOVER PHOTO (if provided)"
source = source.replace(needle, '''    if (!allGlobalSegs.some((s: any) => s.seg.actualStartTime)) {
        return { bookingUpdatePayload: {}, earlyResponse: NextResponse.json({ success: false,
            error: 'Chưa có chặng nào bắt đầu; không thể hoàn thành.' }, { status: 409 }) };
    }
    // Reject malformed mutation input rather than silently treating it as no work.
    if (items.some((item: any) => !parseKtvSegments(item.segments).length)) {
        return { bookingUpdatePayload: {}, earlyResponse: NextResponse.json({ success: false,
            error: 'Dữ liệu chặng không hợp lệ; tải lại đơn.' }, { status: 409 }) };
    }
''' + needle)
source = source.replace("if (opts.mergedIntoId) {", "if (opts.mergedIntoId && !['CANCELLED', 'DONE'].includes(item.status)\n            && !parseKtvSegments(item.segments).some((seg: any) => seg.ktvId && seg.voided !== true && seg.voided !== 'true')) {")
source = source.replace('        let segs = originalItemsData[item.id];', '''        let segs = originalItemsData[item.id];
        if (!segs.some((seg: any) => isLiveKtvSegment(seg, technicianCode) && seg.actualStartTime)) continue;''')
source = source.replace('    const itemSnapshots = structuredClone(bookingItems);', '''    for (const row of bookingItems) parseKtvSegments(row.segments, true);
    const itemSnapshots = structuredClone(bookingItems);''')
source = source.replace('        if (updates.length', '        if (updates.length')
put(name, source)

# The modal edits HH:mm only, retaining the service day on the server.
name = 'app/reception/dispatch/page.tsx'
import_utils(name, 'sequentialClockAt', 'ktvMetadataMap')
replace(name, "plannedHandoffStartAt(selectedDate, segment) || Date.now()", "plannedHandoffStartAt(selectedDate, segment) || NaN")
replace(name, '    const plannedStartAt = new Intl.DateTimeFormat', '''    const reference = (existingB as any)?.plannedStartAt || (Number.isFinite(existingStart) ? existingStart : plannedHandoffStartAt(selectedDate, segment));
    if (!reference || !Number.isFinite(new Date(reference).getTime())) { alert('Chưa có giờ A hợp lệ; sửa và lưu A trước.'); return; }
    const plannedStartAt = new Intl.DateTimeFormat''')
replace(name, "      .format(new Date((existingB as any)?.plannedStartAt || (Number.isFinite(existingStart) ? existingStart : plannedHandoffStartAt(selectedDate, segment) || NaN))).replace(' ', 'T');", "      .format(new Date(reference)).replace(' ', 'T');")
replace(name, '''              <input type="datetime-local" className="mt-1 w-full rounded-lg border p-2" value={liveHandoff.plannedStartAt}
                onChange={e => setLiveHandoff(prev => prev ? { ...prev, plannedStartAt: e.target.value } : null)} />''', '''              <input type="time" className="mt-1 w-full rounded-lg border p-2" value={liveHandoff.plannedStartAt.slice(11, 16)}
                onChange={e => setLiveHandoff(prev => {
                  if (!prev) return null;
                  const svc = orders.find(o => o.id === prev.bookingId)?.services.find(s => s.id === prev.itemId);
                  const a = svc?.staffList.flatMap(row => row.segments).find(seg => Number(seg.sequenceSlot) === 1 || seg.actualStartTime);
                  const iso = a && sequentialClockAt(selectedDate, a.startTime, e.target.value);
                  return { ...prev, plannedStartAt: iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh',
                    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(' ', 'T') : '' };
                })} />
              <p className="mt-1 text-xs text-gray-500">Ngày theo đơn. Giờ qua 0h được tính trong cùng lượt dịch vụ.</p>''')

# More patches appended below before emitting a single unified patch.
put('app/api/ktv/booking/_handlers/handleStartTimer.ts', '''import { NextResponse } from 'next/server';
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
    if (target.seg.actualStartTime) {
        // Retry after a committed START keeps the stamp and the existing proof URLs.
        return { bookingUpdatePayload: {}, bookingPersisted: true, bookingData: booking };
    }
    const serviceDay = String(booking.bookingDate || '').slice(0, 10);
    const allowedAt = target.seg.plannedStartAt || `${serviceDay}T${target.seg.startTime}:00+07:00`;
    let assignedB = false;
    if (Number(target.seg.sequenceSlot) === 2 && isTwoSlotSequential(target.item.options)) {
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
        const match = typeof raw === 'string' ? /^data:image\\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw) : null;
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
        if (error || !data?.success || !data.booking) return fail('Chưa xác nhận được lưu bắt đầu. Tải lại trước khi thử lại.');
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
''')

put('app/api/ktv/booking/_handlers/handleReleaseKTV.ts', '''import { NextResponse } from 'next/server';
import { HandlerContext, HandlerResult } from '../_shared/utils';

/** Work release and cleaning debt are independent; never infer completion from an item ID. */
export async function handleReleaseKTV(ctx: HandlerContext): Promise<HandlerResult> {
    const { supabase, technicianCode, bookingId, body } = ctx;
    const fail = (error: string): HandlerResult => ({ bookingUpdatePayload: {},
        earlyResponse: NextResponse.json({ success: false, error }, { status: 409 }) });
    if (!technicianCode) return fail('Thiếu mã KTV.');
    const inputs = body.photosBase64 ?? [];
    if (!Array.isArray(inputs) || inputs.length > 20) return fail('Danh sách ảnh không hợp lệ.');
    const urls: string[] = [];
    try {
        for (const raw of inputs) {
            const match = typeof raw === 'string' ? /^data:image\\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw) : null;
            if (!match) return fail('Ảnh bàn giao không hợp lệ.');
            const bytes = Buffer.from(match[2], 'base64');
            const mime = match[1].toLowerCase();
            const valid = mime === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
                : mime === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
                : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
            if (!bytes.length || bytes.length > 5 * 1024 * 1024 || !valid) return fail('Ảnh bàn giao sai định dạng hoặc quá 5 MB.');
            const { data, error } = await supabase.storage.from('attendance').upload(
                `handover-photos/${crypto.randomUUID()}.${mime === 'jpeg' ? 'jpg' : mime}`, bytes,
                { contentType: `image/${mime}`, upsert: false });
            if (error || !data?.path) return fail('Chưa tải được đầy đủ ảnh. Ảnh trên thiết bị được giữ lại; thử lại.');
            const { data: url } = supabase.storage.from('attendance').getPublicUrl(data.path);
            if (!url?.publicUrl) return fail('Chưa đọc được URL ảnh.');
            urls.push(url.publicUrl);
        }
        const { data, error } = await supabase.rpc('ktv_release_work_atomic', {
            p_booking_id: bookingId, p_employee_id: technicianCode, p_photo_urls: urls,
            p_item_ids: Array.isArray(body.handoverItemIds) ? body.handoverItemIds : null,
        });
        if (error || !data?.success || !data.booking) return fail('Chưa xác nhận được bàn giao. Tải lại trước khi thử lại; ảnh trên thiết bị được giữ nguyên.');
        return { bookingUpdatePayload: {}, bookingPersisted: true, bookingData: data.booking };
    } catch (error: any) { return fail(error?.message || 'Bàn giao thất bại.'); }
}
''')

name = 'app/api/ktv/booking/route.ts'
replace(name, "        if (status === 'IN_PROGRESS' || action === 'NEXT_SEGMENT_PREPARE') {", "        if (action === 'RELEASE_KTV') {\n            result = await handleReleaseKTV(ctx);\n        } else if (status === 'IN_PROGRESS' || action === 'NEXT_SEGMENT_PREPARE') {")
replace(name, '''        // ─── 7. RELEASE_KTV (runs after booking update, independent) ───
        if (action === 'RELEASE_KTV' && technicianCode) {
            await handleReleaseKTV(ctx);
        }
''', '')

# Keep client pictures on failure; target the post-service booking even if another booking has been promoted.
name = 'app/ktv/dashboard/KTVDashboard.logic.ts'
replace(name, "action: 'RELEASE_KTV',", "action: 'RELEASE_KTV',\n                handoverItemIds: itemIds,")
replace(name, '✅ Đã nộp ảnh bàn giao. Bạn hết nợ phòng này rồi!', 'Đã lưu ảnh bàn giao; đang chờ duyệt. Nếu ảnh bị trả lại, phòng sẽ hiện nợ lại.')

# Proposal migration is emitted below. It is a new forward migration; no historical SQL files are edited.
name = 'app/reception/dispatch/page.tsx'
source = read(name)
for key, field in [('notesForKtvs', 'noteForKtv'), ('serviceNamesForKtvs', 'serviceNameForKtv')]:
    pattern = rf"{key}: Object\.fromEntries\(\s*svc\.staffList\s*\.filter\(r => r\.ktvId && r\.{field}\)\s*\.map\(r => \[r\.ktvId, r\.{field}\]\)\s*\)"
    source, count = re.subn(pattern, f"{key}: ktvMetadataMap(parseKtvOptions(svc.options).{key}, svc.staffList, '{field}')", source)
    assert count == 2, (key, count)
source = re.sub(r"serviceNamesForKtvs: Object\.fromEntries\(\(item\?\.staffList \|\| \[\]\)\.filter\(row => row\.ktvId\)\s*\.map\(row => \[row\.ktvId, row\.serviceNameForKtv \?\? parseKtvOptions\(item\?\.options\)\.serviceNamesForKtvs\?\.\[row\.ktvId\] \?\? ''\]\)\)",
                "serviceNamesForKtvs: ktvMetadataMap(parseKtvOptions(item.options).serviceNamesForKtvs, item.staffList, 'serviceNameForKtv')", source)
source = re.sub(r"notesForKtvs: Object\.fromEntries\(\(item\?\.staffList \|\| \[\]\)\.filter\(row => row\.ktvId\)\s*\.map\(row => \[row\.ktvId, row\.noteForKtv \?\? ''\]\)\)",
                "notesForKtvs: ktvMetadataMap(parseKtvOptions(item.options).notesForKtvs, item.staffList, 'noteForKtv')", source)
put(name, source)

name = 'app/reception/dispatch/actions.ts'
replace(name, "import { ensureTurnRowsAtEnd } from '@/lib/services/TurnQueueRowService';\n", '')
replace(name, "const { data: currentGuests } = await supabase.from('BookingGuests').select('id').eq('booking_id', bookingId);",
        "const { data: currentGuests, error: guestsError } = await supabase.from('BookingGuests').select('id').eq('booking_id', bookingId);\n    if (guestsError) throw guestsError;")
replace(name, '    const updatesToApply: { itemId: string, guestId: string }[] = [];',
        '    const updatesToApply: { itemId: string, guestId: string }[] = [];\n    const newGuests: any[] = [];')
replace(name, "                    await supabase.from('BookingGuests').insert({", "                    newGuests.push({")
replace(name, '    return updatesToApply;', '    return { updatesToApply, newGuests };')
replace(name, "        const { data: currentBooking } = await supabase.from('Bookings').select('status').eq('id', bookingId).single();",
        "        const { data: currentBooking, error: currentBookingError } = await supabase.from('Bookings').select('status').eq('id', bookingId).single();\n        if (currentBookingError || !currentBooking) throw currentBookingError || new Error('Không đọc được đơn.');")
replace(name, '''        if (dispatchData.guestCount) {
            await supabase.from('Bookings').update({ guestCount: dispatchData.guestCount }).eq('id', bookingId);
        }
''', '')
replace(name, "const { data: existingItemsBefore } = await supabase.from('BookingItems').select('id, segments, guest_id').eq('bookingId', bookingId);",
        "const { data: existingItemsBefore, error: existingItemsError } = await supabase.from('BookingItems').select('id, segments, guest_id').eq('bookingId', bookingId);\n        if (existingItemsError || !existingItemsBefore) throw existingItemsError || new Error('Không đọc được dịch vụ.');")
source = read(name)
start = source.index('        // 🔥 ĐỒNG BỘ GUEST_ID TỪ UI GỘP DỊCH VỤ CŨ', source.index('const oldKtvIds'))
end = source.index('        // GỌI RPC MỚI', start)
source = source[:start] + '''        const guestPlan = await resolveGuestIdsForUpdate(supabase, bookingId, dispatchData.itemUpdates || [], existingItemsBefore);
        const guestIds = new Map(guestPlan.updatesToApply.map(update => [update.itemId, update.guestId]));
        dispatchData.itemUpdates = dispatchData.itemUpdates?.map(item => guestIds.has(item.id)
            ? { ...item, guest_id: guestIds.get(item.id) } : item);

''' + source[end:]
source = source.replace("            ...dispatchData, status: dispatchData.status || 'PREPARING',", "            ...dispatchData, status: dispatchData.status || 'PREPARING',\n            newGuests: guestPlan.newGuests, turnStaffIds: ktvIdsWithoutTurnRow,")
source = source.replace("        if (data && !data.success) {", "        if (!data?.success) {")
source = source.replace("            console.error('❌ [Server] RPC failed internally:', data.error);", "            console.error('❌ [Server] RPC failed internally:', data?.error);")
source = source.replace("throw new Error(data.error || 'Lỗi khi lưu dữ liệu điều phối');", "throw new Error(data?.error || 'Máy chủ chưa xác nhận lưu điều phối');")
start = source.index('        // 3.8 Xử lý cập nhật Guest sau khi RPC hoàn tất thành công')
end = source.index('\n        //', start + 20)
source = source[:start] + "        // Guest writes now share the dispatch revision transaction.\n" + source[end:]
# Draft has the same resolver: remove its guest prewrites too.
source = source.replace('        let currentGuests: any[] | null = null;', '        let currentGuests: any[] | null = null;\n        let newGuests: any[] = [];')
start = source.index('            // 🔥 ĐỒNG BỘ GUEST_ID TỪ UI GỘP DỊCH VỤ CŨ', source.index('let newGuests: any[]'))
end = source.index('\n            if (currentItems)', start)
source = source[:start] + '''            const guestPlan = await resolveGuestIdsForUpdate(supabase, bookingId, dispatchData.itemUpdates, currentItems || []);
            newGuests = guestPlan.newGuests;
            const resolvedGuestIds = new Map(guestPlan.updatesToApply.map(update => [update.itemId, update.guestId]));
            dispatchData.itemUpdates = dispatchData.itemUpdates.map(item => resolvedGuestIds.has(item.id)
                ? { ...item, guest_id: resolvedGuestIds.get(item.id) } : item);
''' + source[end:]
source = source.replace('                let targetGuestId = undefined;', '                let targetGuestId = (item as any).guest_id;')
source = source.replace('                if (isChild && currentItems)', '                if (!targetGuestId && isChild && currentItems)')
source = source.replace('                } else if (currentItems) {', '                } else if (!targetGuestId && currentItems) {')
source = source.replace('            ...dispatchData, itemUpdates: finalItemUpdates', '            ...dispatchData, newGuests, itemUpdates: finalItemUpdates')
put(name, source)

migration = '''-- Forward fixes proposed against bc06814f. Apply to an isolated DB before rollout.
CREATE OR REPLACE FUNCTION jsonb_unwrap_string(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE i integer;
BEGIN
  FOR i IN 1..2 LOOP
    EXIT WHEN jsonb_typeof(p) IS DISTINCT FROM 'string';
    p := (p #>> '{}')::jsonb;
  END LOOP;
  RETURN p;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;

-- The same ordering as lib/dispatch-status.ts; utility filtering matches isUtilityService.
CREATE OR REPLACE FUNCTION dispatch_recompute_booking_status(p_booking_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE statuses text[]; computed text; b "Bookings"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.status::text IN ('CANCELLED','SPLIT') THEN RETURN; END IF;
  SELECT array_agg(bi.status::text) INTO statuses FROM "BookingItems" bi
    LEFT JOIN "Services" svc ON svc.id = bi."serviceId"
    WHERE bi."bookingId" = p_booking_id
      AND NOT (COALESCE(svc.is_utility,false) OR COALESCE(bi."serviceId" = 'NHS0900',false)
        OR (lower(COALESCE(svc."nameVN",'')) ~ '(phòng riêng|phong rieng)' AND COALESCE(svc."nameVN",'') NOT LIKE '%+%'));
  IF statuses IS NULL THEN
    SELECT array_agg(status::text) INTO statuses FROM "BookingItems" WHERE "bookingId" = p_booking_id;
  END IF;
  computed := CASE
    WHEN statuses IS NULL THEN 'NEW'
    WHEN statuses && ARRAY['IN_PROGRESS','PAUSED'] THEN 'IN_PROGRESS'
    WHEN statuses && ARRAY['PREPARING','WAITING','NEW'] AND statuses && ARRAY['IN_PROGRESS','PAUSED','COMPLETED','DONE','CANCELLED','FEEDBACK','CLEANING'] THEN 'IN_PROGRESS'
    WHEN statuses && ARRAY['CLEANING','COMPLETED'] THEN 'CLEANING'
    WHEN 'FEEDBACK' = ANY(statuses) THEN 'FEEDBACK'
    WHEN statuses <@ ARRAY['DONE','CANCELLED'] THEN 'DONE'
    WHEN 'PREPARING' = ANY(statuses) THEN 'PREPARING'
    ELSE 'NEW' END;
  SELECT * INTO b FROM jsonb_populate_record(b,jsonb_build_object('status',computed));
  UPDATE "Bookings" SET status = b.status, "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
END $$;

CREATE OR REPLACE FUNCTION ktv_start_service_atomic(
  p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb, p_guest_ratings jsonb,
  p_updates jsonb, p_employee_id text, p_target_segment_id text, p_started_at timestamptz, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b "Bookings"%ROWTYPE; t "TurnQueue"%ROWTYPE; result jsonb; service_day date;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b."timeStart" IS DISTINCT FROM NULLIF(p_booking_snapshot->>'timeStart','')::timestamptz
     OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'START snapshot changed; reload'; END IF;
  service_day := b."bookingDate"::date;
  IF service_day IS NULL OR p_started_at IS NULL OR COALESCE(p_employee_id,'') = '' THEN RAISE EXCEPTION 'Invalid START'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) patch,
    jsonb_array_elements(jsonb_unwrap_string(patch->'segments')) seg
    WHERE seg->>'id' = p_target_segment_id AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\\s+-\\s+'))
      AND COALESCE(seg->>'voided','false') <> 'true' AND NULLIF(seg->>'actualStartTime','')::timestamptz = p_started_at) THEN
    RAISE EXCEPTION 'Invalid START target';
  END IF;
  -- Reuse the proven snapshot lock and item commit. Nested calls remain in this transaction.
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id)
     OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}' THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

CREATE OR REPLACE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item "BookingItems"%ROWTYPE; a "KtvAssignments"%ROWTYPE; segments jsonb; live_done jsonb;
  seg jsonb; images jsonb; changed_dates date[] := '{}'; day date; count_done integer := 0;
  now_at timestamptz := clock_timestamp(); b "Bookings"%ROWTYPE; promotion jsonb;
  opts jsonb; all_done boolean; all_handed boolean; rated boolean; next_status text;
BEGIN
  IF COALESCE(p_employee_id,'') = '' OR jsonb_typeof(p_photo_urls) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_photo_urls) > 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_photo_urls) v WHERE jsonb_typeof(v) <> 'string')
    OR (p_item_ids IS NOT NULL AND jsonb_typeof(p_item_ids) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid RELEASE payload';
  END IF;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
  PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
  FOR item IN SELECT * FROM "BookingItems" WHERE "bookingId" = p_booking_id
    AND (p_item_ids IS NULL OR p_item_ids ? id) ORDER BY id LOOP
    segments := jsonb_unwrap_string(item.segments);
    IF jsonb_typeof(segments) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid RELEASE segments'; END IF;
    SELECT COALESCE(jsonb_agg(s),'[]') INTO live_done FROM jsonb_array_elements(segments) s
      WHERE COALESCE(s->>'voided','false') <> 'true'
        AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\\s+-\\s+'))
        AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> '';
    IF jsonb_array_length(live_done) = 0 THEN CONTINUE; END IF;
    IF jsonb_array_length(p_photo_urls) = 0 AND item.handover_status IS DISTINCT FROM 'SKIPPED'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) s WHERE COALESCE(s->>'handoverTime','') <> '') THEN
      RAISE EXCEPTION 'Submit photos or use existing skip quota before release';
    END IF;
    count_done := count_done + 1;
    SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
      THEN s || jsonb_build_object('feedbackTime',COALESCE(NULLIF(s->>'feedbackTime',''),now_at::text)) ELSE s END ORDER BY ord)
      INTO segments FROM jsonb_array_elements(segments) WITH ORDINALITY v(s,ord);
    IF jsonb_array_length(p_photo_urls) > 0 THEN
      SELECT COALESCE(jsonb_object_agg(p_employee_id || ' · Ảnh ' || ord::text,value),'{}') INTO images
        FROM jsonb_array_elements(p_photo_urls) WITH ORDINALITY v(value,ord);
      SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
        THEN s || jsonb_build_object('handoverTime',now_at,'handoverPhotoUrls',p_photo_urls) ELSE s END ORDER BY ord)
        INTO segments FROM jsonb_array_elements(segments) WITH ORDINALITY v(s,ord);
      UPDATE "BookingItems" SET segments = segments, handover_images = (CASE WHEN jsonb_typeof(item.handover_images) = 'object' THEN item.handover_images
        WHEN jsonb_typeof(item.handover_images) = 'array' THEN (SELECT COALESCE(jsonb_object_agg('Ảnh cũ ' || ord::text,value),'{}')
          FROM jsonb_array_elements(item.handover_images) WITH ORDINALITY v(value,ord)) ELSE '{}' END) || images,
        handover_status = 'PENDING', handover_skipped = false, handover_submitted_at = now_at WHERE id = item.id;
    END IF;
    opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
    SELECT bool_and(COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''),
      bool_and(COALESCE(s->>'handoverTime','') <> '') INTO all_done,all_handed FROM jsonb_array_elements(segments) s
      WHERE COALESCE(s->>'ktvId','') <> '' AND COALESCE(s->>'voided','false') <> 'true';
    IF opts->>'sequentialSlots' = '2' AND opts->>'finishedAfterA' IS DISTINCT FROM 'true'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(segments) s
        WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'voided','false') <> 'true'
          AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> '') THEN all_done := false; END IF;
    rated := item."itemRating" IS NOT NULL OR b.rating IS NOT NULL OR EXISTS (
      SELECT 1 FROM "BookingGuests" WHERE id = item.guest_id AND rating IS NOT NULL);
    next_status := CASE WHEN item.status IN ('DONE','CANCELLED') THEN item.status::text
      WHEN NOT COALESCE(all_done,false) THEN 'IN_PROGRESS'
      WHEN rated AND all_handed THEN 'DONE' ELSE 'FEEDBACK' END;
    SELECT * INTO item FROM jsonb_populate_record(item,jsonb_build_object('status',next_status));
    UPDATE "BookingItems" SET segments = segments, status = item.status WHERE id = item.id;
    -- Skip preserves SKIPPED/debt and does not fabricate physical handoverTime.
    FOR a IN SELECT * FROM "KtvAssignments" WHERE booking_id = p_booking_id
      AND booking_item_id = item.id AND employee_id = p_employee_id AND status IN ('ACTIVE','QUEUED','READY')
      ORDER BY business_date, segment_id FOR UPDATE LOOP
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = a.segment_id)
        OR (a.segment_id IS NULL AND jsonb_array_length(live_done) = 1 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(segments) s WHERE COALESCE(s->>'voided','false') <> 'true'
          AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\\s+-\\s+'))
          AND COALESCE(s->>'actualEndTime','') = '')) THEN
        UPDATE "KtvAssignments" SET status = 'COMPLETED', updated_at = now_at
          WHERE employee_id = a.employee_id AND booking_item_id = a.booking_item_id AND segment_id IS NOT DISTINCT FROM a.segment_id;
        changed_dates := array_append(changed_dates,a.business_date);
      END IF;
    END LOOP;
  END LOOP;
  IF count_done = 0 THEN RAISE EXCEPTION 'No completed live work to release'; END IF;
  FOR day IN SELECT DISTINCT unnest(changed_dates) LOOP
    -- Repaying an old debt must never promote/clear another booking currently being served.
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id = p_employee_id AND business_date = day AND status = 'ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = day
        AND current_order_id IS NOT NULL AND current_order_id <> p_booking_id) THEN
      promotion := promote_next_assignment(p_employee_id,day);
      IF promotion ? 'success' AND NOT COALESCE((promotion->>'success')::boolean,false) THEN RAISE EXCEPTION 'Promotion failed'; END IF;
    END IF;
  END LOOP;
  PERFORM dispatch_recompute_booking_status(p_booking_id);
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;
'''

# Override only the affected functions using existing definitions, keeping unrelated guard/audit code intact.
base = baseline('supabase/migrations/20260925120000_live_sequential_handoff.sql')
def sql_function(source, name):
    start = source.index('CREATE OR REPLACE FUNCTION ' + name + '(')
    end = source.index('$$;', start) + 3
    return source[start:end] + '\n'

assign = sql_function(base, 'dispatch_assign_sequential_slot_b')
assign = assign.replace('    v_end_at timestamptz;', '    v_end_at timestamptz;\n    v_service_day date;\n    v_expected_at timestamptz;')
assign = assign.replace('    SELECT * INTO v_item FROM "BookingItems"', '''    SELECT "bookingDate"::date INTO v_service_day FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF v_service_day IS NULL THEN RAISE EXCEPTION 'Missing service day'; END IF;
    SELECT * INTO v_item FROM "BookingItems"''', 1)
assign = assign.replace("    IF v_reference IS NULL THEN", '''    v_expected_at := (v_service_day + (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < (v_a->>'startTime')::time THEN
        v_expected_at := v_expected_at + interval '1 day';
    END IF;
    IF p_planned_start_at IS DISTINCT FROM v_expected_at OR v_a_assignment.business_date <> v_service_day THEN
        RAISE EXCEPTION 'B must follow the booking service day; reload plan';
    END IF;
    IF v_reference IS NULL THEN''')
# Reject conflicting ACTIVE windows even when stale rows have a different business_date.
assign = assign.replace('    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);', '''    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id = p_to_ktv
      AND ka.status = 'ACTIVE' AND (ka.booking_item_id <> p_item_id OR ka.segment_id IS DISTINCT FROM v_b->>'id')
      AND ka.planned_start_time < v_end_at AND ka.planned_end_time > p_planned_start_at) THEN
        RAISE EXCEPTION 'KTV B has another overlapping assignment';
    END IF;''')
migration += '\n' + assign

after_a = sql_function(base, 'dispatch_finish_sequential_after_a')
after_a = after_a.replace('    SELECT * INTO v_item FROM "BookingItems"', '''    PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
    SELECT * INTO v_item FROM "BookingItems"''', 1)
after_a = after_a.replace("    RETURN jsonb_build_object('success', true);", "    PERFORM dispatch_recompute_booking_status(p_booking_id);\n    RETURN jsonb_build_object('success', true);")
migration += '\n' + after_a

dispatch = sql_function(baseline('supabase/migrations/20260926120000_dispatch_edit_history.sql'), 'dispatch_apply_edit')
dispatch = dispatch.replace("  live_ids text[] := ARRAY[]::text[];", '''  live_ids text[] := ARRAY[]::text[];
  service_day date;
  guest_patch jsonb;
  guest_row "BookingGuests"%ROWTYPE;
  staff_id text;
  next_position integer;
  next_checkin integer;''')
needle = "  PERFORM set_config('app.dispatch_action', p_action, true);"
dispatch = dispatch.replace(needle, '''  -- All revision checks above must pass before guest/count/queue business writes.
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id = p_booking_id;
  IF service_day IS NULL THEN RAISE EXCEPTION 'Missing booking service day'; END IF;
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'date' AND NULLIF(p_payload->>'date','')::date IS DISTINCT FROM service_day THEN
      RAISE EXCEPTION 'Dispatch date differs from booking service day';
    END IF;
    p_payload := p_payload || jsonb_build_object('date',service_day);
    IF p_payload ? 'guestCount' THEN
      IF (p_payload->>'guestCount')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid guest count'; END IF;
      UPDATE "Bookings" SET "guestCount" = (p_payload->>'guestCount')::integer WHERE id = p_booking_id;
    END IF;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'newGuests','[]')) LOOP
      IF guest_patch->>'booking_id' IS DISTINCT FROM p_booking_id OR COALESCE(guest_patch->>'id','') = '' THEN
        RAISE EXCEPTION 'Invalid new guest';
      END IF;
      INSERT INTO "BookingGuests" (id,booking_id,guest_index,guest_label,status)
        VALUES (guest_patch->>'id',p_booking_id,(guest_patch->>'guest_index')::integer,guest_patch->>'guest_label','PENDING');
    END LOOP;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      IF edit ? 'guest_id' THEN
        IF NOT EXISTS (SELECT 1 FROM "BookingGuests" WHERE id = edit->>'guest_id' AND booking_id = p_booking_id) THEN
          RAISE EXCEPTION 'Guest does not belong to booking';
        END IF;
        UPDATE "BookingItems" SET guest_id = edit->>'guest_id' WHERE id = edit->>'id' AND "bookingId" = p_booking_id;
      END IF;
    END LOOP;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'guestUpdates','[]')) LOOP
      SELECT * INTO guest_row FROM "BookingGuests" WHERE id = guest_patch->>'id' AND booking_id = p_booking_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Guest update target changed'; END IF;
      guest_patch := (guest_patch - 'id') ||
        CASE WHEN guest_patch ? 'bedId' THEN jsonb_build_object('bed_id',guest_patch->'bedId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'roomId' THEN jsonb_build_object('room_id',guest_patch->'roomId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'focusArea' THEN jsonb_build_object('focus_area',guest_patch->'focusArea') ELSE '{}' END;
      SELECT * INTO guest_row FROM jsonb_populate_record(guest_row,guest_patch - ARRAY['bedId','roomId','focusArea']);
      UPDATE "BookingGuests" SET bed_id = guest_row.bed_id, room_id = guest_row.room_id,
        status = guest_row.status, notes = guest_row.notes, focus_area = guest_row.focus_area WHERE id = guest_row.id;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND jsonb_array_length(COALESCE(p_payload->'turnStaffIds','[]')) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('TurnQueue-tail:' || service_day::text));
    SELECT COALESCE(max(queue_position),0),COALESCE(max(check_in_order),0) INTO next_position,next_checkin FROM "TurnQueue" WHERE date = service_day;
    FOR staff_id IN SELECT DISTINCT value FROM jsonb_array_elements_text(p_payload->'turnStaffIds') ORDER BY value LOOP
      next_position := next_position + 1; next_checkin := next_checkin + 1;
      INSERT INTO "TurnQueue" (employee_id,date,status,queue_position,check_in_order,turns_completed)
        VALUES (staff_id,service_day,'waiting',next_position,next_checkin,0) ON CONFLICT (employee_id,date) DO NOTHING;
    END LOOP;
  END IF;
''' + needle)
migration += '\n' + dispatch
for signature in ['dispatch_recompute_booking_status(text)', 'ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb)',
                  'ktv_release_work_atomic(text,text,jsonb,jsonb)']:
    migration += f'REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION {signature} TO service_role;\n'
put('supabase/migrations/20260927120000_sequential_operational_consistency.sql', migration)
release_start = migration.index('CREATE OR REPLACE FUNCTION ktv_release_work_atomic(')
release_end = migration.index('\nCREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(', release_start)
release_sql = migration[release_start:release_end]
release_sql = re.sub(r'\bsegments\b', 'v_segments', release_sql)
# Column and JSON key names must remain unchanged; only the PL/pgSQL variable is renamed.
release_sql = release_sql.replace('item.v_segments','item.segments').replace("SET v_segments = v_segments", "SET segments = v_segments")
migration = migration[:release_start] + release_sql + migration[release_end:]
put('supabase/migrations/20260927120000_sequential_operational_consistency.sql', migration)

OUT.mkdir(parents=True, exist_ok=True)
patches = []
for name, value in changes.items():
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)
    original = baseline(name) if name != 'supabase/migrations/20260927120000_sequential_operational_consistency.sql' else ''
    if original == value:
        continue
    patches.append('diff --git a/' + name + ' b/' + name + '\n' + ('new file mode 100644\n' if not original else '') + ''.join(difflib.unified_diff(
        original.splitlines(True), value.splitlines(True), fromfile='a/' + name if original else '/dev/null', tofile='b/' + name)))
(ROOT / '_plans/sequential_deep_fixes_20260927.patch').write_text(''.join(patches))
# A read-only overlay makes full-project TypeScript checks possible without applying the patch.
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
for name in tracked:
    if not name or name.startswith(('_plans/', '.git', 'node_modules/')):
        continue
    path = OUT / name
    if not path.exists() and (ROOT / name).is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(ROOT / name)
if not (OUT / 'node_modules').exists():
    (OUT / 'node_modules').symlink_to(ROOT.parents[1] / 'node_modules')
print(f'Wrote proposal patch for {len(patches)} files; candidates: {OUT}')
