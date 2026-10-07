/**
 * QA #21 — Nhãn "Khách cũ / Đã từng tới / Khách mới" + tỉ lệ huỷ: MỘT công thức cho CRM và bảng điều phối.
 *
 * Bối cảnh 06/10/2026: khách tohjenny76@yahoo.com.sg là "Khách cũ" ở CRM nhưng "Khách mới" trên thẻ điều phối
 * vì 4 nơi dùng 4 công thức. Kịch bản này KHÔNG chạm DB: mock đơn, gọi đúng hai đường mà code thật gọi
 *   - Thẻ điều phối: computeCustomerVisit(rows, { excludeBookingId, before: bookingDate, profileCreatedAt })
 *   - CRM / kiosk:   computeProfileVisit(rows, profileCreatedAt, now)
 * và in bảng so sánh 2 phía (CLAUDE.md 4.3).
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_21_customer_visit_status.ts
 */
import { computeCustomerVisit, computeProfileVisit, formatCancelRate, startOfTodayVN, type VisitBookingRow } from '@/lib/services/CustomerVisitService';
import { finish, fatal } from './_exit';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

// "Bây giờ" cố định: 06/10/2026 22:00 giờ VN (= 15:00Z).
const NOW = new Date('2026-10-06T15:00:00Z');
const row = (id: string, status: string, bookingDate: string, source = 'STANDARD_WALK_IN', parent: string | null = null): VisitBookingRow =>
    ({ id, status, source, parent_booking_id: parent, bookingDate, createdAt: bookingDate });

interface Case { name: string; rows: VisitBookingRow[]; today: string; profile: string | null; expect: string }

const CASES: Case[] = [
    { name: 'Jenny: walk-in 04/06 kẹt NEW, đơn hôm nay', profile: '2026-06-04T13:58:39',
      rows: [row('11NDK-016-04062026', 'NEW', '2026-06-04T13:58:40'), row('11NDK-003-06102026', 'NEW', '2026-10-06T13:12:44')],
      today: '11NDK-003-06102026', expect: 'VISITED' },
    { name: 'Web đặt 01/09 chưa check-in (NEW), hồ sơ tạo hôm nay', profile: '2026-10-06T09:00:00',
      rows: [row('WB-1', 'NEW', '2026-09-01T10:00:00', 'WEB_BOOKING'), row('T-1', 'PREPARING', '2026-10-06T09:00:00')],
      today: 'T-1', expect: 'NEW' },
    { name: 'Web đặt 01/09 đã check-in (PREPARING) rồi huỷ giữa chừng? → không, đang mở', profile: '2026-10-06T09:00:00',
      rows: [row('WB-2', 'PREPARING', '2026-09-01T10:00:00', 'WEB_BOOKING'), row('T-2', 'NEW', '2026-10-06T09:00:00')],
      today: 'T-2', expect: 'VISITED' },
    { name: 'Lượt cũ tách A/B, chỉ B DONE → 1 lượt hoàn tất', profile: '2026-08-01T09:00:00',
      rows: [row('P', 'SPLIT', '2026-08-01T09:00:00'), row('P-A', 'CANCELLED', '2026-08-01T09:00:00', 'STANDARD_WALK_IN', 'P'),
             row('P-B', 'DONE', '2026-08-01T09:00:00', 'STANDARD_WALK_IN', 'P'), row('T-3', 'NEW', '2026-10-06T10:00:00')],
      today: 'T-3', expect: 'RETURNING' },
    { name: 'Khách lần đầu đang làm hôm nay, hồ sơ tạo hôm nay', profile: '2026-10-06T08:00:00',
      rows: [row('T-4', 'IN_PROGRESS', '2026-10-06T08:00:00')], today: 'T-4', expect: 'NEW' },
    { name: 'Hồ sơ tạo 10/09, chưa đơn nào trước hôm nay', profile: '2026-09-10T08:00:00',
      rows: [row('T-5', 'NEW', '2026-10-06T08:00:00')], today: 'T-5', expect: 'VISITED' },
    { name: 'Chỉ có lượt cũ bị huỷ', profile: '2026-10-06T07:00:00',
      rows: [row('C-1', 'CANCELLED', '2026-09-20T10:00:00'), row('T-6', 'NEW', '2026-10-06T07:00:00')], today: 'T-6', expect: 'NEW' },
];

async function main() {
    console.log(`\n=== Nhãn: thẻ điều phối vs CRM (now = ${NOW.toISOString()}, đầu ngày VN = ${startOfTodayVN(NOW)}) ===`);
    const table = CASES.map(c => {
        const today = c.rows.find(r => r.id === c.today)!;
        const card = computeCustomerVisit(c.rows, { excludeBookingId: c.today, before: today.bookingDate, profileCreatedAt: c.profile }).status;
        const crm = computeProfileVisit(c.rows, c.profile, NOW).status;
        return { ca: c.name, mong_doi: c.expect, the_dieu_phoi: card, crm, khop: card === crm ? '✓' : '✗' };
    });
    console.table(table);
    table.forEach((t, i) => {
        check(t.the_dieu_phoi === CASES[i].expect, `thẻ điều phối đúng nhãn: ${t.ca}`, t.the_dieu_phoi);
        check(t.khop === '✓', `CRM = thẻ điều phối: ${t.ca}`, `${t.crm} vs ${t.the_dieu_phoi}`);
    });

    console.log('\n=== Ca đêm: đơn tạo 04:22 sáng 07/10 VN (ngày làm việc 06/10) — lỗi thấy khi test UI 07/10 ===');
    {
        // Đúng như createQuickBooking: bookingDate = ngày làm việc (06/10) + giờ đồng hồ; hồ sơ tạo cùng lúc (UTC 06/10 21:22).
        const NIGHT = new Date('2026-10-06T21:22:00Z'); // = 07/10 04:22 VN
        const rows = [row('NIGHT-1', 'NEW', '2026-10-06T04:22:00')];
        const card = computeCustomerVisit(rows, { excludeBookingId: 'NIGHT-1', before: rows[0].bookingDate, profileCreatedAt: '2026-10-06T21:22:00' }).status;
        const crm = computeProfileVisit(rows, '2026-10-06T21:22:00', NIGHT).status;
        check(startOfTodayVN(NIGHT) === '2026-10-06T00:00:00', 'mốc CRM = đầu ngày làm việc 06/10 (không phải nửa đêm 07/10)', startOfTodayVN(NIGHT));
        check(card === 'NEW' && crm === 'NEW', 'khách mới ca đêm: CRM = thẻ điều phối = Khách mới', `${crm} vs ${card}`);
    }

    console.log('\n=== Không tính lượt đang xem; đơn con của lượt đang xem cũng bị loại ===');
    {
        const rows = [row('X', 'SPLIT', '2026-10-06T10:00:00'), row('X-A', 'DONE', '2026-10-06T10:00:00', 'STANDARD_WALK_IN', 'X'),
                      row('X-B', 'IN_PROGRESS', '2026-10-06T10:00:00', 'STANDARD_WALK_IN', 'X')];
        const v = computeCustomerVisit(rows, { excludeBookingId: 'X-B', before: '2026-10-06T10:00:00' });
        check(v.status === 'NEW' && v.completedVisits === 0, 'thẻ X-B không tự tính X-A (cùng lượt) là lượt trước', v.status);
    }

    console.log('\n=== Tỉ lệ huỷ ===');
    {
        const rows: VisitBookingRow[] = [
            ...['D1', 'D2', 'D3', 'D4', 'D5'].map((id, i) => row(id, 'DONE', `2026-0${i + 3}-01T10:00:00`)),
            row('C1', 'CANCELLED', '2026-08-01T10:00:00'), row('C2', 'CANCELLED', '2026-08-02T10:00:00'),
            row('O1', 'NEW', '2026-09-01T10:00:00'),
        ];
        const v = computeCustomerVisit(rows);
        check(formatCancelRate(v) === '2/7 · 29%', '2 huỷ + 5 hoàn tất + 1 đang mở → 2/7 · 29%', formatCancelRate(v));
        check(formatCancelRate(computeCustomerVisit([row('O2', 'NEW', '2026-09-01T10:00:00')])) === '—', 'chưa lượt nào kết thúc → —');
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG'} — ${failures} loi (TZ=${process.env.TZ || 'local'}) ===`);
    finish(failures);
}

main().catch(fatal);
