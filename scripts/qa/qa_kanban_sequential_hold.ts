/**
 * ================================================================
 * MÔ PHỎNG: thẻ Kanban của MỘT KTV kết thúc, dịch vụ còn người khác làm
 * ================================================================
 * Sự cố 14/09/2026 (đơn 11NDK-005-14092026-B): thẻ người 1 tự sang Chờ đánh
 * giá kéo CẢ dịch vụ sang FEEDBACK trong khi NH021 còn làm.
 *
 * Đi đúng các bước `updateBookingItemStatus` làm: đóng chặng của KTV trong
 * `targetKtvIds` (ghi actualEndTime / feedbackTime), RỒI mới hỏi
 * `shouldHoldItemStatus` có giữ trạng thái dịch vụ không.
 * Không ghi DB.
 *
 * Chạy:
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_kanban_sequential_hold.ts
 */
import { shouldHoldItemStatus, hasOpenKtvSegment, segmentProgress } from '@/lib/dispatch-status';
import { voidSegment, closeOpenPause, markNotStartedOnEarlyLeave } from '@/lib/segment-time';

const T = (iso: string) => new Date(iso).toISOString();

/** Same segment edits as updateBookingItemStatus for finishing statuses. */
function closeTargetSegments(segs: any[], newStatus: string, targetKtvIds?: string[]) {
    const now = T('2026-09-14T09:21:17Z');
    segs.forEach(s => {
        if (targetKtvIds && targetKtvIds.length > 0 && (!s.ktvId || !targetKtvIds.includes(s.ktvId))) return;
        if (!s.actualEndTime) s.actualEndTime = now;
        if (['FEEDBACK', 'DONE'].includes(newStatus) && !s.feedbackTime) s.feedbackTime = now;
    });
    return segs;
}

let pass = 0, fail = 0;
function kase(name: string, segs: any[], newStatus: string, targetKtvIds: string[] | undefined, expectHold: boolean) {
    const after = closeTargetSegments(JSON.parse(JSON.stringify(segs)), newStatus, targetKtvIds);
    const hold = shouldHoldItemStatus(after, newStatus, targetKtvIds);
    const ok = hold === expectHold;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}\n     → ${hold ? 'GIỮ trạng thái dịch vụ (Đang làm)' : `đổi dịch vụ sang ${newStatus}`}`);
}

const a = (ktvId: string, extra: any = {}) => ({ ktvId, startTime: '15:50', endTime: '16:20', duration: 30, actualStartTime: T('2026-09-14T08:50:00Z'), ...extra });

console.log('\n1KTV-1DV');
kase('một người, thẻ sang Chờ đánh giá', [a('T011')], 'FEEDBACK', ['T011'], false);

console.log('\n1KTV-2DV (gộp — mỗi dịch vụ một chặng của cùng KTV)');
kase('dịch vụ 1 của KTV gộp → Dọn phòng', [a('T011', { isMergedRun: true })], 'CLEANING', ['T011'], false);

console.log('\n2KTV-1DV nối tiếp (sự cố 14/09)');
const nh021 = (extra: any = {}) => ({ ktvId: 'NH021', startTime: '16:20', endTime: '17:20', duration: 60, ...extra });
kase('người 1 xong, NH021 đang làm → Chờ đánh giá', [a('EXT_4EA0CD'), nh021({ actualStartTime: T('2026-09-14T09:20:44Z') })], 'FEEDBACK', ['EXT_4EA0CD'], true);
kase('người 1 xong, NH021 đang làm → Dọn phòng', [a('EXT_4EA0CD'), nh021({ actualStartTime: T('2026-09-14T09:20:44Z') })], 'CLEANING', ['EXT_4EA0CD'], true);
kase('người 1 xong, NH021 CHƯA bắt đầu', [a('EXT_4EA0CD'), nh021()], 'FEEDBACK', ['EXT_4EA0CD'], true);
kase('người 1 xong, người 2 đã bị đổi ra (voided)', [a('EXT_4EA0CD'), nh021({ actualStartTime: T('2026-09-14T09:20:44Z'), voided: true, note: 'CHANGED' })], 'FEEDBACK', ['EXT_4EA0CD'], false);
kase('NH021 xong sau cùng (người 1 đã xong trước)', [a('EXT_4EA0CD', { actualEndTime: T('2026-09-14T09:20:45Z'), feedbackTime: T('2026-09-14T09:21:17Z') }), nh021({ actualStartTime: T('2026-09-14T09:20:44Z') })], 'FEEDBACK', ['NH021'], false);
kase('quầy kéo CẢ thẻ (không targetKtvIds) — chủ động chốt', [a('EXT_4EA0CD'), nh021({ actualStartTime: T('2026-09-14T09:20:44Z') })], 'DONE', undefined, false);
kase('bắt đầu làm (IN_PROGRESS) không bao giờ bị giữ', [a('EXT_4EA0CD'), nh021()], 'IN_PROGRESS', ['NH021'], false);

console.log('\n2KTV-1DV song song (cùng giờ bắt đầu → một thẻ Kanban chung)');
const par = (ktvId: string, extra: any = {}) => ({ ktvId, startTime: '15:00', endTime: '16:00', duration: 60, actualStartTime: T('2026-09-14T08:00:00Z'), ...extra });
kase('thẻ chung chốt cả hai người', [par('T011'), par('T014')], 'CLEANING', ['T011', 'T014'], false);
kase('chỉ chốt người A, B còn đang làm', [par('T011'), par('T014')], 'FEEDBACK', ['T011'], true);
kase('A đã tự xong trên app, thẻ chung chốt nốt B', [par('T011', { actualEndTime: T('2026-09-14T08:55:00Z') }), par('T014')], 'CLEANING', ['T011', 'T014'], false);
kase('B đã bị đổi ra (voided), chốt A', [par('T011'), par('T014', { voided: true, note: 'CHANGED' })], 'FEEDBACK', ['T011'], false);

// ── Thao tác quầy trước khi thẻ chuyển cột ──────────────────────────
// Dựng chặng bằng đúng các bước code thật làm (dùng hàm thật voidSegment / closeOpenPause).
const PAUSE_AT = T('2026-09-14T08:40:00Z');

/** BookingItemPauseService.swapKtvOnPausedItem: đóng chặng người cũ tại mốc tạm dừng + tước (CHANGED); thêm chặng TAKEOVER chưa có actualStartTime. */
function swap(segs: any[], oldKtv: string, newKtv: string, startTime: string) {
    const old = segs.find(s => s.ktvId === oldKtv && !s.actualEndTime);
    if (old) {
        closeOpenPause(old, PAUSE_AT, 'SWAP');
        old.actualEndTime = PAUSE_AT;
        voidSegment(old, PAUSE_AT, 'CHANGED');
    }
    segs.push({ ktvId: newKtv, startTime, endTime: null, duration: 30, customCommissionDuration: 30, note: 'TAKEOVER' });
    return segs;
}
/**
 * finish-early-paused/route.ts (sửa 14/09/2026): người CHƯA bắt đầu → markNotStartedOnEarlyLeave
 * (tước, 0 phút, có mốc đóng; route nhả họ + trừ tua); người đang làm → đóng tại pauseStart.
 */
function earlyFinish(segs: any[]) {
    for (const s of segs) {
        if (s.ktvId && !s.actualStartTime && !s.actualEndTime && s.voided !== true) {
            markNotStartedOnEarlyLeave(s, PAUSE_AT);
            continue;
        }
        if (!s.actualStartTime || s.actualEndTime) continue;
        closeOpenPause(s, PAUSE_AT, 'FINISH');
        s.actualEndTime = PAUSE_AT;
        s.note = 'FINISHED_EARLY_ON_PAUSE';
    }
    return segs;
}

const doneSeg = (ktvId: string, startTime = '15:00') => ({ ktvId, startTime, actualStartTime: T('2026-09-14T08:00:00Z'), actualEndTime: T('2026-09-14T08:30:00Z'), feedbackTime: T('2026-09-14T08:31:00Z') });
const workSeg = (ktvId: string, startTime = '15:00') => ({ ktvId, startTime, actualStartTime: T('2026-09-14T08:10:00Z'), pauses: [{ from: PAUSE_AT }] });
const idleSeg = (ktvId: string, startTime: string) => ({ ktvId, startTime, endTime: '17:00', duration: 60 });

console.log('\nĐổi KTV × nối tiếp / song song');
kase('nối tiếp: A xong, B bị đổi → C chưa bắt đầu; thẻ A → Chờ đánh giá',
    swap([doneSeg('T011'), workSeg('T014', '15:30')], 'T014', 'T079', '15:40'), 'FEEDBACK', ['T011'], true);
kase('nối tiếp: C đã vào làm, thẻ C xong',
    swap([doneSeg('T011'), workSeg('T014', '15:30')], 'T014', 'T079', '15:40')
        .map(s => s.note === 'TAKEOVER' ? { ...s, actualStartTime: T('2026-09-14T08:45:00Z') } : s), 'CLEANING', ['T079'], false);
kase('song song: A đang làm, B bị đổi → C chưa bắt đầu; chỉ chốt A',
    swap([workSeg('T011'), workSeg('T014')], 'T014', 'T079', '15:00'), 'CLEANING', ['T011'], true);
kase('song song: C đã vào làm, thẻ chung A + C xong',
    swap([workSeg('T011'), workSeg('T014')], 'T014', 'T079', '15:00')
        .map(s => s.note === 'TAKEOVER' ? { ...s, actualStartTime: T('2026-09-14T08:45:00Z') } : s), 'CLEANING', ['T011', 'T079'], false);

console.log('\nKết thúc sớm × nối tiếp / song song (sau đó thẻ Dọn phòng → Chờ đánh giá)');
kase('1 người kết thúc sớm', earlyFinish([workSeg('T011')]), 'FEEDBACK', ['T011'], false);
kase('nối tiếp: A xong, B đang làm bị kết thúc sớm; thẻ B', earlyFinish([doneSeg('T011'), workSeg('T014', '15:30')]), 'FEEDBACK', ['T014'], false);
kase('nối tiếp: A bị kết thúc sớm, B CHƯA bắt đầu (bị tước + nhả); thẻ A', earlyFinish([workSeg('T011'), idleSeg('T014', '16:00')]), 'FEEDBACK', ['T011'], false);
kase('song song: cả hai đang làm bị kết thúc sớm; thẻ chung', earlyFinish([workSeg('T011'), workSeg('T014')]), 'FEEDBACK', ['T011', 'T014'], false);
kase('song song: A kết thúc sớm, người kia CHƯA vào (bị tước + nhả); thẻ A — ca đơn thật aa79c2d1', earlyFinish([workSeg('T011'), idleSeg('T014', '15:00')]), 'FEEDBACK', ['T011'], false);

console.log('\nHuỷ');
kase('huỷ đi qua cancelBookingItem (cả dịch vụ) — trạng thái CANCELLED không bao giờ bị giữ',
    [workSeg('T011'), idleSeg('T014', '16:00')], 'CANCELLED', ['T011'], false);

// ── handleFinishService quyết trạng thái bằng segmentProgress (bỏ qua chặng bị tước) ──
console.log('\nhandleFinishService — segmentProgress (mục 9.8)');
const HO = T('2026-09-14T08:50:00Z');
const withHandover = (s: any) => ({ ...s, handoverTime: HO });
function prog(name: string, segs: any[], want: { allSegsDone: boolean; hasUnstartedSegs: boolean; allHandovered: boolean }) {
    const got = segmentProgress(segs);
    const ok = got.allSegsDone === want.allSegsDone && got.hasUnstartedSegs === want.hasUnstartedSegs && got.allHandovered === want.allHandovered;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}\n     → xong=${got.allSegsDone} · còn người chưa bắt đầu=${got.hasUnstartedSegs} · đã bàn giao hết=${got.allHandovered}`);
}
prog('1KTV-1DV: xong + bàn giao', [withHandover(doneSeg('T011'))], { allSegsDone: true, hasUnstartedSegs: false, allHandovered: true });
prog('1KTV-2DV gộp: mỗi dịch vụ một chặng, xong + bàn giao', [withHandover({ ...doneSeg('T011'), isMergedRun: true })], { allSegsDone: true, hasUnstartedSegs: false, allHandovered: true });
prog('2KTV nối tiếp — dữ liệu CŨ: A xong + bàn giao, B chưa bắt đầu (→ trước đây lùi IN_PROGRESS)',
    [withHandover(doneSeg('T011')), idleSeg('T014', '16:00')], { allSegsDone: true, hasUnstartedSegs: true, allHandovered: true });
prog('2KTV nối tiếp — SAU sửa: A bị kết thúc sớm rồi bàn giao, B bị tước',
    earlyFinish([workSeg('T011'), idleSeg('T014', '16:00')]).map(s => s.ktvId === 'T011' ? withHandover(s) : s),
    { allSegsDone: true, hasUnstartedSegs: false, allHandovered: true });
prog('2KTV song song — SAU sửa: A bị kết thúc sớm rồi bàn giao, người kia bị tước',
    earlyFinish([workSeg('T011'), idleSeg('T014', '15:00')]).map(s => s.ktvId === 'T011' ? withHandover(s) : s),
    { allSegsDone: true, hasUnstartedSegs: false, allHandovered: true });
prog('2KTV song song: cả hai xong, mới A bàn giao', [withHandover(doneSeg('T011')), doneSeg('T014')], { allSegsDone: true, hasUnstartedSegs: false, allHandovered: false });
prog('Đổi KTV: người cũ bị tước (không bàn giao), người thay xong + bàn giao',
    [{ ...doneSeg('T014'), voided: true, note: 'CHANGED' }, withHandover({ ...doneSeg('T079', '15:40'), note: 'TAKEOVER' })],
    { allSegsDone: true, hasUnstartedSegs: false, allHandovered: true });
prog('Ca qua nửa đêm: A 23:30–00:10 xong + bàn giao, B 00:10 đang làm',
    [withHandover({ ktvId: 'T011', startTime: '23:30', actualStartTime: T('2026-09-14T16:30:00Z'), actualEndTime: T('2026-09-14T17:10:00Z') }),
     { ktvId: 'T014', startTime: '00:10', actualStartTime: T('2026-09-14T17:10:00Z') }],
    { allSegsDone: false, hasUnstartedSegs: false, allHandovered: false });

console.log('\nCa qua nửa đêm');
kase('người 1 23:30–00:10, người 2 00:10–01:10 đang làm', [
    { ktvId: 'T011', startTime: '23:30', endTime: '00:10', actualStartTime: T('2026-09-14T16:30:00Z') },
    { ktvId: 'T014', startTime: '00:10', endTime: '01:10', actualStartTime: T('2026-09-14T17:10:00Z') },
], 'FEEDBACK', ['T011'], true);

console.log('\nhasOpenKtvSegment — biên');
const edge = (name: string, v: boolean, want: boolean) => { const ok = v === want; ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name} → ${v}`); };
edge('mảng rỗng', hasOpenKtvSegment([]), false);
edge('không phải mảng', hasOpenKtvSegment(null as any), false);
edge('chặng không có KTV', hasOpenKtvSegment([{ startTime: '10:00' }]), false);
edge('voided dạng chuỗi "true"', hasOpenKtvSegment([{ ktvId: 'T011', voided: 'true' }]), false);

console.log(`\n${pass} đạt · ${fail} hỏng`);
process.exit(fail ? 1 : 0);
