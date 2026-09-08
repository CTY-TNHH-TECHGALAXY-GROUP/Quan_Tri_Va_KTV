/**
 * Kiểm chứng nền mốc giờ mới: giữ nguyên `actualStartTime`, trừ `seg.pauses[]`.
 *
 * Chạy: npx ts-node -O "{\"module\":\"commonjs\"}" scripts/simulate_pause_windows.ts
 */
import assert from 'assert';
import { computeMinutes } from '../lib/services/KtvDLedgerEngine';
import { KtvTypeDTurnService } from '../lib/services/KtvTypeDTurnService';
import { KtvCommissionService } from '../lib/services/KtvCommissionService';
import { pausedMsOf, workedMsOf, expectedEndMs, endedByCounter, scenarioOf } from '../lib/segment-time';
import { canhBaoLechKichBan } from '../lib/ktv-notify-check';
import { ktvMatchesSeg } from '../lib/ktvUtils';

const T = (m: number) => new Date(Date.UTC(2026, 8, 6, 10, m, 0)).toISOString();
const item = (segs: any[]) => ({ segments: JSON.stringify(segs) });
const ok: string[] = [];
function check(label: string, actual: any, expected: any) {
    assert.deepStrictEqual(actual, expected, `${label}: mong ${JSON.stringify(expected)}, nhận ${JSON.stringify(actual)}`);
    ok.push(`✓ ${label} = ${JSON.stringify(actual)}`);
}

// ── 1. Dữ liệu CŨ (không có `pauses`) phải cho kết quả y hệt trước đây ──────
const cu = { ktvId: 'T016', duration: 60, actualStartTime: T(0), actualEndTime: T(50) };
check('cũ · không pauses · computeMinutes', computeMinutes([cu]), { assigned: 60, actual: 50, paid: 50, custom: null });
check('cũ · không pauses · giờ tích luỹ', KtvTypeDTurnService.calculateActualMinutes(item([cu]), 'T016'), 50);

// ── 2. Một lần tạm dừng 10 phút ────────────────────────────────────────────
// bắt đầu 10:00 → dừng 10:20 → tiếp 10:30 → kết thúc 10:60. Làm thực = 50'.
const motLan = {
    ktvId: 'T016', duration: 60,
    actualStartTime: T(0), actualEndTime: T(60),
    pauses: [{ from: T(20), to: T(30) }],
};
check('1 lần dừng 10p · trừ đúng', pausedMsOf(motLan, motLan.actualEndTime) / 60000, 10);
check('1 lần dừng 10p · làm thực', workedMsOf(motLan)! / 60000, 50);
check('1 lần dừng 10p · computeMinutes', computeMinutes([motLan]), { assigned: 60, actual: 50, paid: 50, custom: null });
check('1 lần dừng 10p · giờ tích luỹ', KtvTypeDTurnService.calculateActualMinutes(item([motLan]), 'T016'), 50);
check('1 lần dừng 10p · mốc bắt đầu KHÔNG đổi', motLan.actualStartTime, T(0));

// ── 3. Hai lần tạm dừng ────────────────────────────────────────────────────
const haiLan = {
    ktvId: 'T016', duration: 60,
    actualStartTime: T(0), actualEndTime: T(75),
    pauses: [{ from: T(10), to: T(20) }, { from: T(40), to: T(45) }],
};
check('2 lần dừng 15p · làm thực', workedMsOf(haiLan)! / 60000, 60);
check('2 lần dừng 15p · computeMinutes', computeMinutes([haiLan]), { assigned: 60, actual: 60, paid: 60, custom: null });

// ── 4. Chặn trên tại giờ gán vẫn còn nguyên tác dụng ───────────────────────
const quaGio = { ktvId: 'T016', duration: 60, actualStartTime: T(0), actualEndTime: T(200), pauses: [{ from: T(10), to: T(20) }] };
check('làm quá giờ gán · vẫn chặn tại 60', computeMinutes([quaGio]), { assigned: 60, actual: 60, paid: 60, custom: null });

// ── 5. Chặng bị tước quyền lợi (KTV bị đổi ra) ─────────────────────────────
const bidoi = { ktvId: 'T016', duration: 60, actualStartTime: T(0), actualEndTime: T(25), customCommissionDuration: 25, voided: true };
const nguoiMoi = { ktvId: 'T079', duration: 35, actualStartTime: T(25), actualEndTime: T(60), customCommissionDuration: 35 };
check('bị đổi · mất sạch tiền và giờ', computeMinutes([bidoi]), { assigned: 0, actual: 0, paid: 0, custom: null });
check('bị đổi · giờ tích luỹ = 0', KtvTypeDTurnService.calculateActualMinutes(item([bidoi]), 'T016'), 0);
check('bị đổi · tiền A/B/C = 0', KtvCommissionService.calculateItemDuration(item([bidoi]), 'T016', 60), 0);
check('bị đổi · VẪN giữ số phút đã làm để đối soát', bidoi.customCommissionDuration, 25);
check('người thay · nhận phần còn lại', computeMinutes([nguoiMoi]), { assigned: 35, actual: 35, paid: 35, custom: 35 });

// ── 6. Đồng hồ đếm ngược: hạn kết thúc phải lùi đúng bằng thời gian đã dừng ─
const dangChay = { ktvId: 'T016', duration: 60, actualStartTime: T(0), pauses: [{ from: T(10), to: T(25) }] };
const han = expectedEndMs(dangChay, 60, new Date(T(30)).getTime())!;
check('đồng hồ · hạn kết thúc lùi 15p', (han - new Date(T(0)).getTime()) / 60000, 75);

// ── 7. Đang tạm dừng, chưa bấm tiếp: khoảng hở không được tự phình ─────────
const dangDung = { ktvId: 'T016', duration: 60, actualStartTime: T(0), pauses: [{ from: T(20) }] };
check('đang dừng · đóng tại mốc dừng thì cộng 0', pausedMsOf(dangDung, T(20)) / 60000, 0);
check('đang dừng · tính tới 10:35 thì đã dừng 15p', pausedMsOf(dangDung, T(35)) / 60000, 15);

// ── 8. Quầy chốt hộ: đồng hồ KTV phải dừng ở CẢ BA luồng ───────────────────
// Guard chống ghost-completion trên app KTV chặn theo endedByCounter(). Bản
// trước chỉ nhận 'FINISHED_EARLY_ON_PAUSE' nên nút Huỷ vẫn để đồng hồ chạy.
const ketThucSom = { ktvId: 'T1', duration: 60, actualStartTime: T(0), actualEndTime: T(20), note: 'FINISHED_EARLY_ON_PAUSE' };
const huyMatTrang = { ktvId: 'T1', duration: 60, actualStartTime: T(0), actualEndTime: T(20), note: 'CANCELLED_NO_CREDIT', voided: true };
const huyCoCongGio = { ktvId: 'T1', duration: 60, actualStartTime: T(0), actualEndTime: T(20), pauses: [{ from: T(20), to: T(20), closedBy: 'CANCEL' }] };
const doiKtv = { ktvId: 'T1', duration: 60, actualStartTime: T(0), actualEndTime: T(20), note: 'CHANGED', voided: true };
const ktvTuBam = { ktvId: 'T1', duration: 60, actualStartTime: T(0), actualEndTime: T(60) };

check('quay chot · ket thuc som', endedByCounter(ketThucSom), true);
check('quay chot · huy mat trang', endedByCounter(huyMatTrang), true);
check('quay chot · huy CO cong gio (khong note)', endedByCounter(huyCoCongGio), true);
check('quay chot · doi KTV', endedByCounter(doiKtv), true);
check('KTV tu bam xong -> KHONG phai quay chot', endedByCounter(ktvTuBam), false);

// ── 9. Nhận diện kịch bản ──────────────────────────────────────────────────
const dungThatRoiTiep = { ktvId: 'T1', duration: 60, actualStartTime: T(0), actualEndTime: T(70), pauses: [{ from: T(10), to: T(20), closedBy: 'RESUME' }] };
check('co bam Tiep -> dem 1 lan tam dung', scenarioOf({ status: 'DONE', segments: [dungThatRoiTiep] }).soLanTamDung, 1);
check('chi chot don -> KHONG dem la tam dung', scenarioOf({ status: 'DONE', segments: [huyCoCongGio] }).soLanTamDung, 0);
const cuKhacDinhDang = { ktvId: 'T1', duration: 60, actualStartTime: T(0), actualEndTime: T(20), pauses: [{ from: '2026-09-06T10:20:00.000Z', to: '2026-09-06T10:20:00+00:00' }] };
check('du lieu cu · so moc gio chu khong so chuoi', scenarioOf({ status: 'DONE', segments: [cuKhacDinhDang] }).soLanTamDung, 0);
check('kich ban huy mat trang', scenarioOf({ status: 'CANCELLED', options: {}, segments: [huyMatTrang] }).scenario, 'A_C4_HUY_MAT_TRANG');
check('kich ban huy co cong gio', scenarioOf({ status: 'CANCELLED', options: { cancelCredit: 'WORKED' }, segments: [huyCoCongGio] }).scenario, 'C3_HUY_CO_CONG_GIO');
check('kich ban ra som', scenarioOf({ status: 'DONE', options: { earlyLeave: true }, segments: [ketThucSom] }).scenario, 'B_RA_SOM');
check('kich ban doi KTV', scenarioOf({ status: 'IN_PROGRESS', options: {}, segments: [doiKtv] }).scenario, 'C2_DOI_KTV');

// ── 10. Chốt chặn bấm nhầm Kết thúc / Huỷ ─────────────────────────────────
// Kết thúc = KTV CÓ tiền có giờ; Huỷ = MẤT sạch. Phân biệt bằng việc KTV có
// bấm báo hay không, nên thao tác đi ngược dữ liệu thì phải cảnh báo.
const coBao = { daBao: true, loai: 'EARLY_EXIT' };
const khongBao = { daBao: false };

check('ket thuc · KTV CHUA bao -> canh bao', canhBaoLechKichBan('FINISH_EARLY', khongBao) !== null, true);
check('ket thuc · KTV DA bao   -> khong canh bao', canhBaoLechKichBan('FINISH_EARLY', coBao), null);
check('huy · KTV DA bao        -> canh bao', canhBaoLechKichBan('CANCEL', coBao) !== null, true);
check('huy · KTV CHUA bao      -> khong canh bao', canhBaoLechKichBan('CANCEL', khongBao), null);

// ── 11. Đổi KTV: tìm chặng của KTV cũ ─────────────────────────────────────
// Dữ liệu thật có chặng GHÉP nhiều người ("Bao - Na") và chữ hoa/thường không
// thống nhất ("NA - BAO"). So `===` là không thấy chặng cũ → nó không bị đóng,
// không bị tước → KTV cũ vẫn ăn đủ tiền mà KTV mới còn được cộng thêm chặng.
check('chang ghep · tim duoc KTV cu', ktvMatchesSeg('Bao - Na', 'NA'), true);
check('chang ghep · khac hoa thuong', ktvMatchesSeg('NA - BAO', 'bao'), true);
check('so === thi truot', ('Bao - Na' as any) === 'NA', false);
check('khong nham KTV khac', ktvMatchesSeg('Bao - Na', 'TOM'), false);
check('chang thuong van dung', ktvMatchesSeg('T016', 'T016'), true);

console.log(ok.join('\n'));
console.log(`\n✅ ${ok.length}/${ok.length} phép thử đạt.`);
