/**
 * ================================================================
 * CHẠY THỬ THẬT LUỒNG ĐỔI KTV
 * ================================================================
 * Dựng đơn test riêng, gọi thẳng `swapKtvOnPausedItem`, soì lại DB, rồi tự xoá.
 * Kiểm các nhánh: loại D (theo giờ tích luỹ), loại A (theo sổ tua), và loại C
 * (cộng tác viên — người vào thay KHÔNG có dòng TurnQueue, 14/09/2026).
 *
 * Chạy:
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_swap_ktv_e2e.ts
 *
 * ⚠️ GHI THẬT VÀO DB ĐANG CHẠY. Cố ý không gắn vào `npm run test:qa` vì:
 *   · tạo Bookings / BookingItems / TurnQueue / KtvAssignments / TurnLedger thật
 *     (đều xoá sạch ở khối `finally`, kể cả khi phép thử hỏng);
 *   · đổi TẠM `Staff.work_type` của T011/T014 sang TYPE_A / TYPE_C để thử nhánh
 *     sổ tua, rồi trả lại — trong vài giây đó bảng tua hiện họ sai loại.
 *
 * Chỉ dùng tài khoản test (T0xx), KHÔNG dùng NH0xx — đó là nhân viên đang vận hành.
 * Ngày làm việc đặt ở mốc cũ (01/09) để không lòi lên bảng điều phối hôm nay.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { BookingItemPauseService, pullIncomingKtvToWorking } from '@/lib/services/BookingItemPauseService';
import { gioDongHoVN, laNguoiBiDoiRaKhoiDon } from '@/lib/segment-time';
import { ktvMatchesSeg } from '@/lib/ktvUtils';
import { punishTurnIfIdle } from '@/lib/turn-punish';

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
const LY_DO = 'Khách không hài lòng lực tay, xin đổi người';

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
    const dEnd = new Date(now + 40 * 60000);
    const gioDuKien = `${String(dEnd.getHours()).padStart(2, '0')}:${String(dEnd.getMinutes()).padStart(2, '0')}`;

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
            // ⚠️ Phải giống DỮ LIỆU THẬT: điều phối ghi `endTime` là GIỜ DỰ KIẾN
            // dạng "HH:mm" cho mọi chặng ngay từ đầu. Bản test cũ đặt `null` nên
            // không bắt được lỗi lọc `!seg.endTime` — lỗi đó làm chặng KTV cũ
            // không bao giờ bị tìm thấy, ngoài giao diện thì danh sách chọn rỗng trơn.
            endTime: gioDuKien, duration: DUR, pauses: [{ from: mocDung }],
        }],
    });
    if (eI) throw new Error('tao BookingItems: ' + eI.message);

    return { bookingId, itemId, mocDung };
}

/**
 * @param newKtvCoDong false = người vào thay KHÔNG có dòng TurnQueue hôm đó —
 *   đúng tình trạng loại C (không điểm danh, không bật ở Sổ tua).
 */
async function dungHangDoi(bookingId: string, itemId: string, oldKtv: string, newKtv: string, newKtvCoDong = true) {
    await sb.from('TurnQueue').delete().eq('date', DATE).in('employee_id', [oldKtv, newKtv]);
    const rows: any[] = [
        { employee_id: oldKtv, date: DATE, status: 'working', current_order_id: bookingId, booking_item_id: itemId, booking_item_ids: [itemId], turns_completed: 0, check_in_order: 1, queue_position: 3 },
    ];
    if (newKtvCoDong) rows.push({ employee_id: newKtv, date: DATE, status: 'waiting', turns_completed: 0, check_in_order: 2, queue_position: 7 });
    await sb.from('TurnQueue').insert(rows);
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

type Ctx = { bookingId: string; itemId: string; oldKtv: string; newKtv: string };
type ChayOpts = {
    newKtvCoDong?: boolean;
    /** Chạy sau khi dựng hàng đợi, TRƯỚC khi đổi. */
    truocKhiDoi?: (ctx: Ctx) => Promise<void>;
    /** Chạy sau mọi phép soi chung, trước khi dọn. */
    sauKhiDoi?: (ctx: Ctx) => Promise<void>;
    /** Mã KTV khác mà kịch bản có đụng tới — dọn chung ở `finally`. */
    donThem?: string[];
};

async function chay(tenKichBan: string, oldKtv: string, newKtv: string, theoSoTua: boolean, opts: ChayOpts = {}) {
    console.log(`\n═══ ${tenKichBan}:  ${oldKtv} → ${newKtv} ═══`);
    const { bookingId, itemId } = await dungDon(theoSoTua ? 'AB' : 'D', oldKtv);
    const ctx: Ctx = { bookingId, itemId, oldKtv, newKtv };
    try {
        await dungHangDoi(bookingId, itemId, oldKtv, newKtv, opts.newKtvCoDong ?? true);
        if (opts.truocKhiDoi) await opts.truocKhiDoi(ctx);

        await BookingItemPauseService.swapKtvOnPausedItem(
            sb as any, itemId, oldKtv, newKtv, 0, DATE, false, 0, LY_DO
        );
        // Route /api/ktv/pause-swap-resume gọi tiếp resumeItem ngay sau khi đổi,
        // và ghi nhật ký thành "Gửi người mới" kèm mã. Phải truyền y hệt ở đây,
        // vì chính resumeItem mới là chỗ từng gán nhầm khoảng dừng cho chặng của
        // người vào thay.
        await BookingItemPauseService.resumeItem(sb as any, itemId, {
            action: 'SWAP_SEND', note: newKtv,
        });

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
        check('endTime vẫn là giờ đồng hồ HH:mm', /^\d{2}:\d{2}$/.test(String(segCu?.endTime)), `= ${segCu?.endTime}`);
        // Server chạy UTC — `getHours()` ra lệch 7 tiếng. Giờ đồng hồ phải là giờ VN
        // (lỗi thật 11/09/2026: T069 vào 03:52 mà thẻ hiện "20:52 → 21:50").
        check('endTime người cũ là GIỜ VN', segCu?.endTime === gioDongHoVN(segCu?.actualEndTime),
            `lưu ${segCu?.endTime}, đúng ra ${gioDongHoVN(segCu?.actualEndTime)}`);
        check('lý do đổi lưu ở chặng bị tước', segCu?.lyDoDoi === LY_DO, `= ${JSON.stringify(segCu?.lyDoDoi)}`);
        check('KTV cũ VẪN nằm trong đơn', (it as any).technicianCodes?.includes(oldKtv));
        // Người bị đổi ra đánh giá khách xong là về — KHÔNG dọn phòng. Người vào
        // thay thì vẫn phải dọn như thường.
        const itemsDon = [{ segments: segs }];
        check('người bị đổi ra: KHÔNG phải dọn phòng', laNguoiBiDoiRaKhoiDon(itemsDon, oldKtv, ktvMatchesSeg) === true);
        check('người vào thay: vẫn phải dọn phòng', laNguoiBiDoiRaKhoiDon(itemsDon, newKtv, ktvMatchesSeg) === false);
        check('chặng KTV mới là TAKEOVER', segMoi?.note === 'TAKEOVER');
        const gioVnBayGio = gioDongHoVN(Date.now());
        const lechPhut = (() => {
            const [a, b] = String(segMoi?.startTime || '').split(':').map(Number);
            const [c, d] = gioVnBayGio.split(':').map(Number);
            return Math.abs((a * 60 + b) - (c * 60 + d));
        })();
        check('startTime người mới là GIỜ VN', lechPhut <= 2, `lưu ${segMoi?.startTime}, giờ VN hiện tại ${gioVnBayGio}`);
        check('KTV mới nhận phần còn lại 45p', segMoi?.customCommissionDuration === 45, `= ${segMoi?.customCommissionDuration}p`);
        // Đồng hồ KTV cộng bù mọi khoảng dừng (expectedEndMs = bắt đầu + giờ gán +
        // thời gian dừng). Chặng của người vào thay được tạo TRONG lúc đơn đang
        // tạm ngưng nên nó KHÔNG được mang khoảng dừng nào — nếu không, quầy gán
        // 5 phút mà máy KTV đếm 16 phút (lỗi thật 10/09/2026, đơn WB-10092026-016).
        const dungCuaNguoiMoi = Array.isArray(segMoi?.pauses) ? segMoi.pauses : [];
        // Chốt 10/09/2026: server KHÔNG đóng dấu giờ bắt đầu thay KTV mới nữa.
        // Khách chờ tới lúc họ tự bấm Bắt đầu; `handleStartTimer` mới đóng dấu,
        // kèm ảnh xác nhận đã vào phòng. Đóng dấu sớm là KTV mất trắng mấy phút
        // đi bộ sang phòng.
        check('chặng người vào thay CHƯA có giờ bắt đầu', !segMoi?.actualStartTime,
            segMoi?.actualStartTime ? `đã bị đóng dấu ${segMoi.actualStartTime}` : 'chưa đóng dấu');
        check('chặng người vào thay KHÔNG mang khoảng dừng', dungCuaNguoiMoi.length === 0,
            dungCuaNguoiMoi.length ? `có ${dungCuaNguoiMoi.length} khoảng — đồng hồ sẽ cộng bù sai` : 'không có');

        const { data: tq } = await sb.from('TurnQueue').select('employee_id, status, current_order_id, queue_position').eq('date', DATE).in('employee_id', [oldKtv, newKtv]);
        const qCu = (tq || []).find((t: any) => t.employee_id === oldKtv) as any;
        const qMoi = (tq || []).find((t: any) => t.employee_id === newKtv) as any;
        check('KTV cũ về waiting', qCu?.status === 'waiting', `status=${qCu?.status}`);
        check('KTV cũ nhả đơn', qCu?.current_order_id === null);
        check('giữ nguyên vị trí bảng tua (3)', qCu?.queue_position === 3, `= ${qCu?.queue_position}`);
        check('KTV mới lên working', qMoi?.status === 'working', `status=${qMoi?.status ?? 'KHÔNG CÓ DÒNG'}`);

        const { data: as } = await sb.from('KtvAssignments').select('employee_id, status, booking_item_id').eq('business_date', DATE).in('employee_id', [oldKtv, newKtv]);
        const aCu = (as || []).find((a: any) => a.employee_id === oldKtv) as any;
        const aMoi = (as || []).find((a: any) => a.employee_id === newKtv) as any;
        check('phiếu phân công cũ đóng (CANCELLED)', aCu?.status === 'CANCELLED', `status=${aCu?.status}`);
        check('KTV mới CÓ phiếu ACTIVE', aMoi?.status === 'ACTIVE', `status=${aMoi?.status ?? 'KHÔNG CÓ DÒNG'}`);

        // Nhật ký quầy phải truy được ai ra ai vào, và dòng cuối phải nói đơn đã
        // sang tay ai — không phải "Tiếp tục" chung chung.
        const { data: itLog } = await sb.from('BookingItems').select('options').eq('id', itemId).single();
        let optsLog: any = (itLog as any).options;
        if (typeof optsLog === 'string') { try { optsLog = JSON.parse(optsLog); } catch { optsLog = {}; } }
        const nhatKy: any[] = Array.isArray(optsLog?.counterLog) ? optsLog.counterLog : [];
        const dongDoi = nhatKy.find((r: any) => r.action === 'SWAP_KTV');
        const dongCuoi = nhatKy[nhatKy.length - 1];
        check('nhật ký ghi rõ đổi từ ai sang ai + lý do', dongDoi?.note === `${oldKtv} → ${newKtv} · ${LY_DO}`, `note=${JSON.stringify(dongDoi?.note)}`);
        check('dòng cuối là "Gửi người mới" kèm mã', dongCuoi?.action === 'SWAP_SEND' && dongCuoi?.note === newKtv,
            `${dongCuoi?.action} note=${JSON.stringify(dongCuoi?.note)}`);

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

        if (opts.sauKhiDoi) await opts.sauKhiDoi(ctx);
    } catch (e: any) {
        check(`kịch bản chạy hết không ném lỗi`, false, e?.message || String(e));
    } finally {
        await don(bookingId, itemId, [oldKtv, newKtv, ...(opts.donThem || [])]);
    }
}

// ── Loại C: dòng TurnQueue người vào thay + các bộ lọc luồng khác đọc dòng đó ──
async function soiDongLoaiC({ bookingId, itemId, newKtv }: Ctx) {
    const { data: q } = await sb.from('TurnQueue')
        .select('date, status, current_order_id, booking_item_ids, queue_position')
        .eq('date', DATE).eq('employee_id', newKtv).maybeSingle();
    const r = q as any;
    check('loại C: CÓ dòng TurnQueue sau khi đổi', !!r, r ? '' : 'KHÔNG CÓ DÒNG — quầy sẽ thấy "Sẵn sàng"');
    check('loại C: dòng ghi đúng ngày làm việc', r?.date === DATE, `= ${r?.date}`);
    check('loại C: status working (KHÔNG assigned)', r?.status === 'working', `= ${r?.status}`);
    check('loại C: ôm đúng đơn', r?.current_order_id === bookingId);
    check('loại C: booking_item_ids = [item]', JSON.stringify(r?.booking_item_ids) === JSON.stringify([itemId]), `= ${JSON.stringify(r?.booking_item_ids)}`);
    check('loại C: queue_position thật (không 999, không NaN)', Number.isFinite(r?.queue_position) && r.queue_position > 0 && r.queue_position < 999, `= ${r?.queue_position}`);

    // Đúng bộ lọc mà các luồng quầy dùng để tìm KTV của đơn — gọi thẳng hàm thì bị
    // `requirePermission` chặn, nên soi bằng câu truy vấn y hệt.
    const { data: huyDon } = await sb.from('TurnQueue').select('employee_id, status')
        .eq('current_order_id', bookingId).eq('date', DATE);          // cancelBooking
    const cHuyDon = (huyDon || []).find((t: any) => t.employee_id === newKtv) as any;
    check('huỷ cả đơn: tìm thấy C', !!cHuyDon);
    check('huỷ cả đơn: C KHÔNG ở assigned (không bị xoá tua khi "có công")', cHuyDon?.status !== 'assigned', `= ${cHuyDon?.status}`);

    const { data: huyDv } = await sb.from('TurnQueue').select('employee_id')
        .eq('current_order_id', bookingId).contains('booking_item_ids', [itemId]);   // cancelBookingItem
    check('huỷ 1 dịch vụ: tìm thấy C', (huyDv || []).some((t: any) => t.employee_id === newKtv));

    const { data: hoanTat } = await sb.from('TurnQueue').select('employee_id')
        .eq('current_order_id', bookingId).overlaps('booking_item_ids', [itemId]).eq('date', DATE);  // updateBookingItemStatus
    check('quầy Hoàn tất: tìm thấy C để nhả', (hoanTat || []).some((t: any) => t.employee_id === newKtv));
}

(async () => {
    // ── Kịch bản 1: loại D (đúng loại thật của tài khoản test) ──
    await chay('LOẠI D', 'T016', 'T079', false);

    const { data: goc } = await sb.from('Staff').select('id, work_type').in('id', ['T011', 'T014']);
    try {
        // ── Kịch bản 2: loại A — đổi tạm work_type rồi trả lại ──
        await sb.from('Staff').update({ work_type: 'TYPE_A' }).in('id', ['T011', 'T014']);
        await chay('LOẠI A', 'T011', 'T014', true);

        // ── Kịch bản 3–4: người vào thay loại C, KHÔNG có dòng TurnQueue ──
        await sb.from('Staff').update({ work_type: 'TYPE_C' }).eq('id', 'T014');

        await chay('LOẠI C vào thay — huỷ không công', 'T011', 'T014', true, {
            newKtvCoDong: false,
            donThem: ['T016'],
            truocKhiDoi: async ({ bookingId, itemId }) => {
                // 2KTV-1DV: một KTV khác cũng đang ôm đơn này — không được bị đụng (rule 9.4).
                await sb.from('TurnQueue').delete().eq('date', DATE).eq('employee_id', 'T016');
                await sb.from('TurnQueue').insert({ employee_id: 'T016', date: DATE, status: 'working', current_order_id: bookingId, booking_item_id: `${itemId}-khac`, booking_item_ids: [`${itemId}-khac`], turns_completed: 0, queue_position: 5 });
            },
            sauKhiDoi: async (ctx) => {
                await soiDongLoaiC(ctx);

                const { data: dongChung } = await sb.from('TurnQueue').select('status, current_order_id, queue_position').eq('date', DATE).eq('employee_id', 'T016').maybeSingle();
                check('2KTV-1DV: KTV cùng đơn KHÔNG bị đụng', (dongChung as any)?.status === 'working' && (dongChung as any)?.current_order_id === ctx.bookingId && (dongChung as any)?.queue_position === 5,
                    JSON.stringify(dongChung));

                // Huỷ không công: cancelBookingItem đặt dịch vụ CANCELLED rồi gọi punishTurnIfIdle
                // cho mọi KTV nó tìm thấy (C đã tìm thấy ở trên).
                const { data: truoc } = await sb.from('TurnLedger').select('is_punished').eq('date', DATE).eq('employee_id', ctx.newKtv).maybeSingle();
                check('trước khi huỷ: C đang được tính tua', (truoc as any)?.is_punished !== true, `= ${(truoc as any)?.is_punished}`);
                await sb.from('BookingItems').update({ status: 'CANCELLED' }).eq('id', ctx.itemId);
                const daTuoc = await punishTurnIfIdle(sb as any, { bookingId: ctx.bookingId, employeeId: ctx.newKtv, date: DATE });
                const { data: sau } = await sb.from('TurnLedger').select('is_punished').eq('date', DATE).eq('employee_id', ctx.newKtv).maybeSingle();
                check('huỷ không công: C MẤT tua (giống A/B)', daTuoc === true && (sau as any)?.is_punished === true, `tước=${daTuoc}, is_punished=${(sau as any)?.is_punished}`);
            },
        });

        await chay('LOẠI C vào thay — rồi bị đổi ra lại', 'T011', 'T014', true, {
            newKtvCoDong: false,
            donThem: ['T079'],
            sauKhiDoi: async ({ itemId }) => {
                await sb.from('TurnQueue').delete().eq('date', DATE).eq('employee_id', 'T079');
                // Quầy bấm Tạm dừng rồi Đổi C → T079 (loại D on-call, KHÔNG có dòng).
                await BookingItemPauseService.pauseItem(sb as any, itemId);
                await BookingItemPauseService.swapKtvOnPausedItem(sb as any, itemId, 'T014', 'T079', 0, DATE, false, 0, 'Đổi lại lần 2');
                await BookingItemPauseService.resumeItem(sb as any, itemId, { action: 'SWAP_SEND', note: 'T079' });

                const { data: qC } = await sb.from('TurnQueue').select('status, current_order_id, booking_item_ids').eq('date', DATE).eq('employee_id', 'T014').maybeSingle();
                check('C bị đổi ra: về waiting', (qC as any)?.status === 'waiting', `= ${(qC as any)?.status ?? 'KHÔNG CÓ DÒNG'}`);
                check('C bị đổi ra: nhả đơn', (qC as any)?.current_order_id === null, `= ${(qC as any)?.current_order_id}`);
                const { data: aC } = await sb.from('KtvAssignments').select('status').eq('business_date', DATE).eq('employee_id', 'T014').eq('booking_item_id', itemId).maybeSingle();
                check('C bị đổi ra: phiếu CANCELLED', (aC as any)?.status === 'CANCELLED', `= ${(aC as any)?.status}`);
                const { data: qD } = await sb.from('TurnQueue').select('id').eq('date', DATE).eq('employee_id', 'T079');
                check('D on-call chưa có dòng: KHÔNG bị tạo dòng', (qD || []).length === 0, `${(qD || []).length} dòng`);
            },
        });
    } finally {
        for (const g of goc || []) {
            await sb.from('Staff').update({ work_type: (g as any).work_type }).eq('id', (g as any).id);
        }
        const { data: sau } = await sb.from('Staff').select('id, work_type').in('id', ['T011', 'T014']);
        console.log('\nTrả lại work_type:', JSON.stringify(sau));
    }

    // ── Kịch bản 5: gọi thẳng pullIncomingKtvToWorking ──
    console.log('\n═══ pullIncomingKtvToWorking — race / D on-call / đã có dòng ═══');
    const HANG = ['T079', 'T016'];
    try {
        await sb.from('TurnQueue').delete().eq('date', DATE).in('employee_id', HANG);
        const base = { businessDate: DATE, bookingId: 'TEST-PULL', bookingItemId: 'TEST-PULL-item1' };
        const kq = await Promise.all([
            pullIncomingKtvToWorking(sb as any, { ...base, employeeId: 'T079', isTypeC: true }),
            pullIncomingKtvToWorking(sb as any, { ...base, employeeId: 'T079', isTypeC: true }),
        ]);
        const { data: rows } = await sb.from('TurnQueue').select('id').eq('date', DATE).eq('employee_id', 'T079');
        check('race 2 lệnh cùng lúc: chỉ 1 dòng', (rows || []).length === 1, `${(rows || []).length} dòng, kết quả ${JSON.stringify(kq)}`);
        check('đã có dòng: đi nhánh update', await pullIncomingKtvToWorking(sb as any, { ...base, employeeId: 'T079', isTypeC: true }) === 'updated');
        check('không phải loại C, chưa có dòng: skipped', await pullIncomingKtvToWorking(sb as any, { ...base, employeeId: 'T016', isTypeC: false }) === 'skipped');
        const { data: d } = await sb.from('TurnQueue').select('id').eq('date', DATE).eq('employee_id', 'T016');
        check('không phải loại C: KHÔNG tạo dòng', (d || []).length === 0);
    } finally {
        await sb.from('TurnQueue').delete().eq('date', DATE).in('employee_id', HANG);
    }

    console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass}/${pass + fail} phép thử đạt.`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
