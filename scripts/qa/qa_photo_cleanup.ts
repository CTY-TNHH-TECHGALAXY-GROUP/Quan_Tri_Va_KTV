/**
 * QA — PhotoCleanupService: hàm lọc tên ảnh chấm công và gom link ảnh của đơn.
 * Thuần, KHÔNG đụng DB.
 * Chạy: npx tsx scripts/qa/qa_photo_cleanup.ts
 */
import { isAttendancePhotoName, storagePathFromUrl, collectItemPhotoPaths, isItemPhotoDeletable } from '@/lib/services/PhotoCleanupService';

let failures = 0;
const check = (ten: string, thuc: unknown, mongDoi: unknown) => {
    const ok = JSON.stringify(thuc) === JSON.stringify(mongDoi);
    if (!ok) failures++;
    console.log(`  ${ok ? 'DAT ' : 'HONG'} | ${ten}: ${JSON.stringify(thuc)}${ok ? '' : ` (mong doi ${JSON.stringify(mongDoi)})`}`);
};
const URL = (p: string) => `https://x.supabase.co/storage/v1/object/public/attendance/${p}`;

console.log('\nA. Ten anh cham cong');
for (const n of ['NH014_1779940272128_0.jpeg', 'T016_1788516536274_0.jpeg', 'NH001_1785376080993_2.jpeg', 'T007_1789724716904.jpg'])
    check(`chon ${n}`, isAttendancePhotoName(n), true);
for (const n of ['selfie_11NDK-005-11062026_NH011_1781163816545.jpeg', 'handover_11NDK-005_T021_1790000000000.jpeg',
    'reject_item1_1790000000000_ab12c.jpeg', 'start_1790000000000_x9y8z7.jpeg', 'slipper_1790000000000_k3j2.jpeg',
    'handover-photos', 'office-evidence', 'NH014_17799402_0.jpeg'])
    check(`bo ${n}`, isAttendancePhotoName(n), false);

console.log('\nB. Link -> path');
check('attendance', storagePathFromUrl(URL('handover-photos/a.jpg')), 'handover-photos/a.jpg');
check('office-evidence khong bao gio', storagePathFromUrl(URL('office-evidence/T1/2026-09-04/1_0.jpg')), null);
check('bucket khac', storagePathFromUrl('https://x.supabase.co/storage/v1/object/public/avatars/a.jpg'), null);
check('co query string', storagePathFromUrl(URL('start_1.jpeg?t=1')), 'start_1.jpeg');
check('rac', storagePathFromUrl(123), null);

console.log('\nC. Gom anh cua item (dinh dang segments that)');
const item = {
    status: 'DONE', handover_status: 'PENDING', commission_locked: false,
    handover_images: JSON.stringify([URL('handover-photos/h1.jpg')]),
    handover_reject_images: null,
    segments: JSON.stringify([
        { ktvId: 'T021', startPhotoUrl: URL('start_1.jpeg'), guestSlipperPhotoUrl: URL('slipper_1.jpeg'),
          handoverPhotoUrls: [URL('handover-photos/h2.jpg'), URL('handover-photos/h1.jpg')] },
        { ktvId: 'T027', handoverPhotoUrl: URL('handover_x.jpeg'), selfiePhotoUrl: URL('selfie_old.jpeg'),
          evidence: URL('office-evidence/T027/a.jpg') },
    ]),
};
check('gom du, khong trung, khong office-evidence', collectItemPhotoPaths(item).sort(),
    ['handover-photos/h1.jpg', 'handover-photos/h2.jpg', 'handover_x.jpeg', 'selfie_old.jpeg', 'slipper_1.jpeg', 'start_1.jpeg']);

console.log('\nD. Item du dieu kien don anh');
check('DONE + PENDING', isItemPhotoDeletable({ status: 'DONE', handover_status: 'PENDING' }), true);
check('DONE + APPROVED', isItemPhotoDeletable({ status: 'DONE', handover_status: 'APPROVED' }), true);
check('DONE + SKIPPED', isItemPhotoDeletable({ status: 'DONE', handover_status: 'SKIPPED' }), true);
check('DONE + REJECTED -> giu', isItemPhotoDeletable({ status: 'DONE', handover_status: 'REJECTED' }), false);
check('DONE + commission_locked -> giu', isItemPhotoDeletable({ status: 'DONE', handover_status: 'APPROVED', commission_locked: true }), false);
for (const st of ['CLEANING', 'FEEDBACK', 'COMPLETED', 'IN_PROGRESS', 'CANCELLED'])
    check(`${st} -> giu`, isItemPhotoDeletable({ status: st, handover_status: 'APPROVED' }), false);

console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG (' + failures + ')'} ===`);
process.exit(failures ? 1 : 0);
