/**
 * QA 30 — Khách chấm sao trước khi KTV bấm Kết thúc (ca T027 10/10/2026).
 *
 * Đối chiếu 2 phía trên cùng fixture segments (đúng định dạng DB):
 *   - Quản trị: `segmentProgress` (lib/dispatch-status.ts) → finish handler DONE khi
 *     alreadyRated && allSegsDone && allHandovered && !hasUnstartedSegs.
 *   - WRB: `customerRatingMayCloseItem` (web_noi_bo/wrb-noi-bo-dev /src/lib/serviceWorkFinished.ts).
 * Kỳ vọng: WRB chỉ được DONE khi phía Quản trị cũng sẽ DONE (hoặc không có chặng KTV).
 *
 * Chạy: npx tsx scripts/qa/qa_30_khach_cham_sao_truoc_ktv_ket_thuc.ts   (thêm TZ=UTC để kiểm múi giờ)
 */
import { segmentProgress } from '../../lib/dispatch-status';
import { customerRatingMayCloseItem, serviceWorkProgress } from '../../../web_noi_bo/wrb-noi-bo-dev /src/lib/serviceWorkFinished';

type Seg = Record<string, unknown>;
const seg = (ktvId: string, extra: Seg = {}): Seg => ({ id: `seg-${ktvId}-${Math.random().toString(36).slice(2, 6)}`,
    ktvId, roomId: 'V1', bedId: 'V1-1', startTime: '16:57', endTime: '18:07', duration: 70, ...extra });
const START = '2026-10-10T10:07:40.472Z', END = '2026-10-10T11:19:47.000Z', HANDOVER = '2026-10-10T11:40:00.000Z';

const cases: { name: string; segments: unknown; status?: string; adminDone: boolean; wrbMayClose: boolean }[] = [
    { name: 'Item đã CANCELLED (huỷ sau khi bắt đầu), khách vẫn chấm sao', status: 'CANCELLED', segments: [seg('T027', { actualStartTime: START, actualEndTime: END, handoverTime: HANDOVER })], adminDone: false, wrbMayClose: false },
    { name: '1KTV-1DV: khách chấm TRƯỚC Kết thúc (ca T027)', segments: [seg('T027', { actualStartTime: START })], adminDone: false, wrbMayClose: false },
    { name: '1KTV-1DV: chấm SAU Kết thúc, CHƯA bàn giao', segments: [seg('T027', { actualStartTime: START, actualEndTime: END })], adminDone: false, wrbMayClose: false },
    { name: '1KTV-1DV: chấm SAU bàn giao (luồng bình thường)', segments: [seg('T027', { actualStartTime: START, actualEndTime: END, handoverTime: HANDOVER })], adminDone: true, wrbMayClose: true },
    { name: '1KTV-1DV: chưa bắt đầu (khách chấm nhầm sớm)', segments: [seg('T027')], adminDone: false, wrbMayClose: false },
    { name: '2KTV-1DV: A xong+bàn giao, B đang làm', segments: [seg('A', { actualStartTime: START, actualEndTime: END, handoverTime: HANDOVER }), seg('B', { actualStartTime: START })], adminDone: false, wrbMayClose: false },
    { name: '2KTV-1DV: A xong+bàn giao, B chưa bắt đầu (nối tiếp)', segments: [seg('A', { actualStartTime: START, actualEndTime: END, handoverTime: HANDOVER }), seg('B')], adminDone: false, wrbMayClose: false },
    { name: '2KTV-1DV: cả hai xong + bàn giao', segments: [seg('A', { actualStartTime: START, actualEndTime: END, handoverTime: HANDOVER }), seg('B', { actualStartTime: START, actualEndTime: END, handoverTime: HANDOVER })], adminDone: true, wrbMayClose: true },
    { name: 'Đổi KTV: chặng cũ voided (đang làm dở), người mới xong + bàn giao', segments: [seg('OLD', { actualStartTime: START, voided: true, note: 'CHANGED' }), seg('NEW', { actualStartTime: START, actualEndTime: END, handoverTime: HANDOVER })], adminDone: true, wrbMayClose: true },
    { name: 'Huỷ không công: voided + CANCELLED_NO_CREDIT, có end nhưng chưa bàn giao', segments: [seg('T027', { actualStartTime: START, actualEndTime: END, voided: true, note: 'CANCELLED_NO_CREDIT' })], adminDone: false, wrbMayClose: true },
    { name: 'Dịch vụ không có KTV (Phòng riêng / DV sau đã gộp, segments [])', segments: [], adminDone: false, wrbMayClose: true },
    { name: 'segments là chuỗi JSON (dữ liệu cũ trước trigger chuẩn hoá)', segments: JSON.stringify([seg('T027', { actualStartTime: START })]), adminDone: false, wrbMayClose: false },
    { name: 'Ca đêm qua nửa đêm: start 23:40 VN, end 00:50 VN hôm sau, đã bàn giao', segments: [seg('T027', { startTime: '23:40', endTime: '00:50', actualStartTime: '2026-10-10T16:40:00.000Z', actualEndTime: '2026-10-10T17:50:00.000Z', handoverTime: '2026-10-10T18:00:00.000Z' })], adminDone: true, wrbMayClose: true },
];

let fail = 0;
console.log(`TZ=${process.env.TZ || '(local)'} — ${cases.length} ca\n`);
for (const c of cases) {
    const parsed = typeof c.segments === 'string' ? JSON.parse(c.segments) : c.segments;
    const admin = segmentProgress(parsed as any[]);
    // Cùng công thức newItemStatus của handleFinishService khi alreadyRated = true
    const adminDone = c.status !== 'CANCELLED' && !admin.hasUnstartedSegs && admin.allSegsDone && admin.allHandovered;
    const wrb = serviceWorkProgress(c.segments);
    const wrbMayClose = customerRatingMayCloseItem(c.segments, c.status);
    const ok = adminDone === c.adminDone && wrbMayClose === c.wrbMayClose && (!wrbMayClose || wrb.noKtvWork || adminDone);
    if (!ok) fail++;
    console.log(`${ok ? '✅' : '❌'} ${c.name}`);
    console.log(`     Quản trị: allSegsDone=${admin.allSegsDone} allHandovered=${admin.allHandovered} unstarted=${admin.hasUnstartedSegs} → DONE=${adminDone}`);
    console.log(`     WRB     : noKtvWork=${wrb.noKtvWork} allSegsDone=${wrb.allSegsDone} allHandovered=${wrb.allHandovered} → được DONE=${wrbMayClose}`);
}
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${cases.length - fail}/${cases.length} khớp 2 phía`);
process.exit(fail ? 1 : 0);
