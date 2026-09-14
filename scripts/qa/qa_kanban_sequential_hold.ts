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
import { shouldHoldItemStatus, hasOpenKtvSegment } from '@/lib/dispatch-status';

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
