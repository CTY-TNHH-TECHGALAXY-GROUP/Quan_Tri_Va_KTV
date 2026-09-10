/**
 * ================================================================
 * CHẠY THỬ THẬT LUỒNG ĐỔI KTV
 * ================================================================
 * Dựng đơn test riêng, gọi thẳng `swapKtvOnPausedItem`, soì lại DB, rồi tự xoá.
 * Kiểm cả hai nhánh: loại D (theo giờ tích luỹ) và loại A (theo sổ tua).
 *
 * Chạy:
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_swap_ktv_e2e.ts
 *
 * ⚠️ GHI THẬT VÀO DB ĐANG CHẠY. Cố ý không gắn vào `npm run test:qa` vì:
 *   · tạo Bookings / BookingItems / TurnQueue / KtvAssignments / TurnLedger thật
 *     (đều xoá sạch ở khối `finally`, kể cả khi phép thử hỏng);
 *   · đổi TẠM `Staff.work_type` của T011/T014 sang TYPE_A để thử nhánh sổ tua,
 *     rồi trả lại — trong vài giây đó bảng tua hiện họ sai loại.
 *
 * Chỉ dùng tài khoản test (T0xx), KHÔNG dùng NH0xx — đó là nhân viên đang vận hành.
 * Ngày làm việc đặt ở mốc cũ (01/09) để không lòi lên bảng điều phối hôm nay.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { BookingItemPauseService } from '@/lib/services/BookingItemPauseService';

const env = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
let url = '', key = '';
env.split('\n').forEach(l => {
    if (l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = l.split('=')[1].trim();
    if (l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) key = l.split('=')[1].trim();
});
const sb = createClient(url, key);

const DATE = '2026-09-01';
const SERVICE = 'NHS0002';   // Tinh dầu, 70 phút
const DUR = 70;

let pass = 0, fail = 0;
function check(ten: string, dat: boolean, chiTiet = '') {
    if (dat) { pass++; console.log(`  OK   ${ten}${chiTiet ? '  ' + chiTiet : ''}`); }
    else { fail++; console.log(`  FAIL ${ten}${chiTiet ? '  ' + chiTiet : ''}`); }
}

async function dungDon(tag: string, oldKtv: string) {
    const now = Date.now();
    const bookingId = `TEST-SWAP-${tag}-${now}`;
    const itemId = `${bookingId}-item1`;
    const batDau = new Date(now - 30 * 60000).toISOString();   // bắt đầu 30' trước
    const mocDung = new Date(now - 5 * 60000).toISOString();   // bấm dừng 5' trước → làm thực 25'

    const { error: eB } = await sb.from('Bookings').insert({
        id: bookingId, billCode: bookingId, branchName: 'Ngan Ha Spa',
        bookingDate: `${DATE}T10:00:00`, timeStart: `${DATE}T10:00:00`,
        customerName: 'KHACH TEST SWAP', customerPhone: `TEST-${now}`,
        status: 'IN_PROGRESS', totalAmount: 0, guestCount: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    if (eB) throw new Error('tao Bookings: ' + eB.message);

    const { error: eI } = await sb.from('BookingItems').insert({
        id: itemId, bookingId, serviceId: SERVICE, quantity: 1, price: 0,
        status: 'PAUSED', pauseStart: mocDung, technicianCodes: [oldKtv],
        segments: [{
            ktvId: oldKtv, startTime: batDau, actualStartTime: batDau,
            endTime: null, duration: DUR, pauses: [{ from: mocDung }],
        }],
    });
    if (eI) throw new Error('tao BookingItems: ' + eI.message);

    return { bookingId, itemId, mocDung };
}

async function dungHangDoi(bookingId: string, itemId: string, oldKtv: string, newKtv: string) {
    await sb.from('TurnQueue').delete().eq('date', DATE).in('employee_id', [oldKtv, newKtv]);
    await sb.from('TurnQueue').insert([
        { employee_id: oldKtv, date: DATE, status: 'working', current_order_id: bookingId, booking_item_id: itemId, booking_item_ids: [itemId], turns_completed: 0, check_in_order: 1, queue_position: 3 },
        { employee_id: newKtv, date: DATE, status: 'waiting', turns_completed: 0, check_in_order: 2, queue_position: 7 },
    ]);
    await sb.from('KtvAssignments').delete().eq('business_date', DATE).in('employee_id', [oldKtv, newKtv]);
    await sb.from('KtvAssignments').insert({
        employee_id: oldKtv, business_date: DATE, booking_id: bookingId,
        booking_item_id: itemId, status: 'ACTIVE', dispatch_source: 'TEST',
    });
    await sb.from('TurnLedger').delete().eq('date', DATE).in('employee_id', [oldKtv, newKtv]);
    await sb.from('TurnLedger').insert({ date: DATE, booking_id: bookingId, employee_id: oldKtv, source: 'TEST' });
}

async function don(bookingId: string, itemId: string, ktvs: string[]) {
    await sb.from('KtvAssignments').delete().eq('business_date', DATE).in('employee_id', ktvs);
    await sb.from('TurnLedger').delete().eq('date', DATE).in('employee_id', ktvs);
    await sb.from('TurnQueue').delete().eq('date', DATE).in('employee_id', ktvs);
    await sb.from('BookingItems').delete().eq('id', itemId);
    await sb.from('Bookings').delete().eq('id', bookingId);
    await sb.from('KTVDRecomputeQueue').delete().eq('booking_id', bookingId);
}

async function chay(tenKichBan: string, oldKtv: string, newKtv: string, theoSoTua: boolean) {
    console.log(`\n═══ ${tenKichBan}:  ${oldKtv} → ${newKtv} ═══`);
    const { bookingId, itemId } = await dungDon(theoSoTua ? 'AB' : 'D', oldKtv);
    try {
        await dungHangDoi(bookingId, itemId, oldKtv, newKtv);

        await BookingItemPauseService.swapKtvOnPausedItem(
            sb as any, itemId, oldKtv, newKtv, 0, DATE, false, 0
        );

        // ── Soi lại ──────────────────────────────────────────────
        const { data: it } = await sb.from('BookingItems').select('technicianCodes, segments').eq('id', itemId).single();
        let segs: any = (it as any).segments;
        if (typeof segs === 'string') segs = JSON.parse(segs);

        const segCu = segs.find((s: any) => s.ktvId === oldKtv);
        const segMoi = segs.find((s: any) => s.ktvId === newKtv);

        check('chặng KTV cũ bị tước (voided)', segCu?.voided === true);
        check('ghi chú CHANGED', segCu?.note === 'CHANGED');
        check('giữ số phút đã làm để đối soát', segCu?.customCommissionDuration === 25, `= ${segCu?.customCommissionDuration}p`);
        check('khoảng dừng đóng bằng SWAP', segCu?.pauses?.[0]?.closedBy === 'SWAP');
        check('KTV cũ VẪN nằm trong đơn', (it as any).technicianCodes?.includes(oldKtv));
        check('chặng KTV mới là TAKEOVER', segMoi?.note === 'TAKEOVER');
        check('KTV mới nhận phần còn lại 45p', segMoi?.customCommissionDuration === 45, `= ${segMoi?.customCommissionDuration}p`);

        const { data: tq } = await sb.from('TurnQueue').select('employee_id, status, current_order_id, queue_position').eq('date', DATE).in('employee_id', [oldKtv, newKtv]);
        const qCu = (tq || []).find((t: any) => t.employee_id === oldKtv) as any;
        const qMoi = (tq || []).find((t: any) => t.employee_id === newKtv) as any;
        check('KTV cũ về waiting', qCu?.status === 'waiting', `status=${qCu?.status}`);
        check('KTV cũ nhả đơn', qCu?.current_order_id === null);
        check('giữ nguyên vị trí bảng tua (3)', qCu?.queue_position === 3, `= ${qCu?.queue_position}`);
        check('KTV mới lên working', qMoi?.status === 'working', `status=${qMoi?.status}`);

        const { data: as } = await sb.from('KtvAssignments').select('employee_id, status, booking_item_id').eq('business_date', DATE).in('employee_id', [oldKtv, newKtv]);
        const aCu = (as || []).find((a: any) => a.employee_id === oldKtv) as any;
        const aMoi = (as || []).find((a: any) => a.employee_id === newKtv) as any;
        check('phiếu phân công cũ đóng (CANCELLED)', aCu?.status === 'CANCELLED', `status=${aCu?.status}`);
        check('KTV mới CÓ phiếu ACTIVE', aMoi?.status === 'ACTIVE', `status=${aMoi?.status ?? 'KHÔNG CÓ DÒNG'}`);

        const { data: tl } = await sb.from('TurnLedger').select('employee_id, is_punished, source').eq('date', DATE).in('employee_id', [oldKtv, newKtv]);
        const lCu = (tl || []).find((r: any) => r.employee_id === oldKtv) as any;
        const lMoi = (tl || []).find((r: any) => r.employee_id === newKtv) as any;

        if (theoSoTua) {
            check('KTV cũ bị tước tua (is_punished)', lCu?.is_punished === true, `= ${lCu?.is_punished}`);
            check('KTV mới ĐƯỢC cộng tua', !!lMoi, lMoi ? `source=${lMoi.source}` : 'KHÔNG CÓ DÒNG');
        } else {
            check('loại D: KHÔNG tước tua (vô nghĩa)', lCu?.is_punished !== true, `= ${lCu?.is_punished}`);
            check('loại D: KHÔNG đẻ tua ma cho người mới', !lMoi, lMoi ? 'CÓ DÒNG — SAI' : 'không có dòng');
        }
    } finally {
        await don(bookingId, itemId, [oldKtv, newKtv]);
    }
}

(async () => {
    // ── Kịch bản 1: loại D (đúng loại thật của tài khoản test) ──
    await chay('LOẠI D', 'T016', 'T079', false);

    // ── Kịch bản 2: loại A — đổi tạm work_type rồi trả lại ──
    const { data: goc } = await sb.from('Staff').select('id, work_type').in('id', ['T011', 'T014']);
    try {
        await sb.from('Staff').update({ work_type: 'TYPE_A' }).in('id', ['T011', 'T014']);
        await chay('LOẠI A', 'T011', 'T014', true);
    } finally {
        for (const g of goc || []) {
            await sb.from('Staff').update({ work_type: (g as any).work_type }).eq('id', (g as any).id);
        }
        const { data: sau } = await sb.from('Staff').select('id, work_type').in('id', ['T011', 'T014']);
        console.log('\nTrả lại work_type:', JSON.stringify(sau));
    }

    console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass}/${pass + fail} phép thử đạt.`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
