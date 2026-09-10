/**
 * QA #11 — Ba phát hiện khi test tay vòng 2.
 *
 * A. ẢNH MINH CHỨNG THEO TỪNG MỤC (hạng mục 1)
 *    A1. Rổ ảnh dùng chung bị CHẶN khi tích nhiều lỗi.
 *    A2. Mỗi lỗi có trần ảnh RIÊNG, không chia nhau một trần chung.
 *    A3. Lỗi bắt buộc ảnh phải có ảnh CỦA CHÍNH NÓ, không mượn của lỗi khác.
 *    A4. Phiếu cũ dùng chung ảnh: ĐÁNH DẤU, không xoá — KTV không mất bằng chứng.
 *
 * B. XẾP HẠNG GIỜ (hạng mục 3)
 *    B1. Chưa điểm danh trong tháng thì CHƯA CÓ HẠNG (rank = null).
 *    B2. Chưa ai điểm danh thì bảng xếp hạng rỗng.
 *    B3. Hoà giờ chốt bằng MÃ nhân viên — quầy và KTV ra CÙNG một thứ tự.
 *
 * C. BẬT/TẮT TÍNH NĂNG (hạng mục 5)
 *    C1. Tắt "nhận đơn ngoài giờ" KHÔNG được khoá điểm danh / tan ca.
 *    C2. Nút Điểm Office đi qua CÙNG một cửa với trang Ví.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_11_round2_findings.ts
 * CHỈ ĐỌC — không ghi gì vào DB.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
    currentMonthVn, attendedStaffOfMonth, assignRanks, KtvOfficeScoreService, monthRange,
} from '../../lib/services/KtvOfficeScoreService';
import { canSeeOfficePoints, markSharedPhotosWithinDay } from '../../lib/services/KtvOfficeBonusService';
import { resolveStaffFlag } from '../../lib/featureFlags';
import { resolvePhotosPerCriteria, buildDeductRows } from '../../lib/services/KtvOfficeEvidenceService';
import { WalletAccessService } from '../../lib/services/WalletAccessService';
import { finish, fatal } from './_exit';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

const src = (rel: string) => fs.readFileSync(path.join(__dirname, '../../', rel), 'utf8');

async function main() {
    const month = currentMonthVn();
    console.log(`\n=== QA #11 · Ba phat hien vong 2 · thang ${month} ===\n`);

    // ══ A. Ảnh minh chứng theo từng mục ══════════════════════════════
    console.log('--- A: anh minh chung theo TUNG MUC ---');
    const deduct = src('app/api/admin/ktv-office/deduct/route.ts');

    check(/photosByCriteria/.test(deduct),
        'A0. Route nhan anh theo tung loi (`photosByCriteria`)');

    // A1–A3 kiểm HÀNH VI bằng chính hai hàm route đang gọi, không grep chuỗi
    // trong source: đợt refactor vừa rồi dời code sang service là mấy phép grep
    // cũ do ngay, trong khi san pham van dung. Test bam vao hinh dang cua code
    // thi no bao dong moi lan don dep, va im khi hanh vi thay doi that.
    // Kich ban di tron duong (ghi -> DB -> KTV doc) nam o `qa_12`.
    const CRIT = [
        { id: 'X1', label: 'Loi bat buoc anh', points: 3, requires_photo: true },
        { id: 'X2', label: 'Loi bat buoc anh 2', points: 6, requires_photo: true },
        { id: 'X3', label: 'Loi khong can anh', points: 5, requires_photo: false },
    ];
    const rShared = resolvePhotosPerCriteria(CRIT, undefined, ['u1', 'u2']);
    check(!rShared.ok && rShared.code === 'PHOTOS_MUST_BE_PER_CRITERIA',
        'A1. Ro anh dung chung bi CHAN khi tich nhieu loi',
        rShared.ok ? 'KHONG chan' : '');

    const rOk = resolvePhotosPerCriteria(CRIT, { X1: ['a1'], X2: ['b1', 'b2'] });
    const builtRows = rOk.ok ? buildDeductRows({
        staffId: 'QA', workDate: '2019-01-01', criteria: CRIT,
        urlsOf: rOk.perCriteria, createdBy: 'QA', createdByName: 'QA',
    }) : [];
    check(builtRows.length === 3
        && builtRows[0].photo_urls.join() === 'a1'
        && builtRows[1].photo_urls.join() === 'b1,b2'
        && builtRows[2].photo_urls.length === 0,
        'A2. Moi dong phieu chi mang anh CUA RIENG loi do',
        builtRows.map(r => `${r.criteria_id}:[${r.photo_urls.join(' ')}]`).join(' '));

    const rMissing = resolvePhotosPerCriteria(CRIT.slice(0, 2), { X1: ['a1'] });
    check(!rMissing.ok && rMissing.code === 'MISSING_REQUIRED_PHOTO',
        'A3. Loi bat buoc anh phai co anh cua chinh no, khong muon cua loi khac',
        rMissing.ok ? 'LOT' : '');

    const adminLogic = src('app/admin/ktv-office/AdminKtvOffice.logic.ts');
    check(/MAX_PHOTOS - photosOf\(criteriaId\)\.length/.test(adminLogic),
        'A2b. Tran anh tinh RIENG cho tung loi, khong chia nhau tran chung');
    check(!/sheetState\.photos\b/.test(adminLogic) && !/sheetState\.photos\b/.test(src('app/admin/ktv-office/page.tsx')),
        'A2c. Khong con ro anh dung chung nao sot lai trong giao dien');

    // A4 — phiếu CŨ dùng chung ảnh: đánh dấu, KHÔNG được xoá.
    //
    // ⚠️ Ban dau ham nay di XOA anh trung. Tren du lieu that (T016 ngay 05/09,
    // 1 anh dinh 8 loi) no lam 7/8 loi hien "0 anh" — KTV dang xem duoc bang
    // chung thi mat sach. Voi nguoi bi tru diem, "khong co anh" te hon han
    // "anh dung chung". Nay giu nguyen anh, chi gan co de man hinh giai thich.
    const legacy = [
        { label: 'Đồng phục', points: 3, photoUrls: ['u1', 'u2'], photoCount: 2 },
        { label: 'Ngoại hình', points: 6, photoUrls: ['u1', 'u2'], photoCount: 2 },
        { label: 'Tác phong', points: 6, photoUrls: ['u1', 'u2', 'u3'], photoCount: 3 },
    ];
    const marked = markSharedPhotosWithinDay(legacy);
    const luotTruoc = legacy.reduce((a, h) => a + h.photoUrls.length, 0);
    const luotSau = marked.reduce((a, h) => a + h.photoUrls.length, 0);
    check(luotSau === luotTruoc,
        'A4. KHONG mat luot xem anh nao cua phieu cu',
        `${luotTruoc} → ${luotSau}`);
    check(marked.every(h => h.photoUrls.length > 0),
        'A4b. Moi loi van giu duoc anh cua no de KTV doi chieu');
    check(marked[0].sharedPhotos && marked[1].sharedPhotos && marked[2].sharedPhotos,
        'A4c. Anh dung chung duoc GAN CO de man hinh noi ro');
    // u3 chỉ thuộc một lỗi → không phải ảnh dùng chung, nhưng lỗi đó vẫn có u1/u2
    // dùng chung nên cờ vẫn bật. Phiếu ghi theo đường MỚI thì cờ phải tắt hẳn.
    const fresh = [
        { label: 'Đồng phục', points: 3, photoUrls: ['a1'], photoCount: 1 },
        { label: 'Ngoại hình', points: 6, photoUrls: ['b1', 'b2'], photoCount: 2 },
    ];
    const freshMarked = markSharedPhotosWithinDay(fresh);
    check(freshMarked.every(h => h.sharedPhotos === false),
        'A4d. Phieu ghi theo duong moi khong bi gan co dung chung');
    check(freshMarked.every((h, i) => h.photoUrls.join() === fresh[i].photoUrls.join()),
        'A4e. Phieu moi giu nguyen anh, khong bi dung toi');

    // ══ B. Xếp hạng giờ ══════════════════════════════════════════════
    console.log('\n--- B: xep hang gio ---');
    const { data: staffRows } = await supabase
        .from('Staff').select('id, full_name, status')
        .eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id');
    const staff = staffRows || [];
    const ids = staff.map(s => s.id);

    const attended = await attendedStaffOfMonth(supabase, ids, month);
    const hours = await KtvOfficeScoreService.hoursBreakdown(supabase, ids, monthRange(month));
    const base = staff.map(s => ({ id: s.id, name: s.full_name || s.id, net: hours.get(s.id)!.net }));

    const ranked = assignRanks(base, attended);
    console.table(ranked.map(r => ({
        id: r.id, gio: r.net, da_diem_danh: attended.has(r.id) ? 'co' : 'chua', hang: r.rank ?? '—',
    })));

    const noRank = ranked.filter(r => !r.ranked);
    check(noRank.every(r => r.rank === null),
        'B1. Chua diem danh thi rank = null',
        `${noRank.length} nguoi chua diem danh: ${noRank.map(r => r.id).join(', ') || 'khong co'}`);
    check(ranked.filter(r => r.ranked).every(r => attended.has(r.id)),
        'B1b. Chi nguoi da diem danh moi co hang');

    // B2 — chưa ai điểm danh thì bảng rỗng.
    const emptyCase = assignRanks(base, new Set<string>());
    check(emptyCase.every(r => r.rank === null),
        'B2. Chua ai diem danh => khong ai co hang',
        `${emptyCase.length} nguoi, ${emptyCase.filter(r => r.rank !== null).length} co hang`);

    // B3 — hoà giờ: quầy và KTV phải ra cùng thứ tự.
    const tie = [
        { id: 'T027', name: 'Sunny', net: 0 },
        { id: 'T002', name: 'NHI', net: 0 },
        { id: 'T011', name: 'Yully', net: 0 },
    ];
    const allIn = new Set(tie.map(t => t.id));
    const order = assignRanks(tie, allIn).map(r => r.id).join(',');
    check(order === 'T002,T011,T027',
        'B3. Hoa gio chot bang MA nhan vien, khong phai ten', order);

    const ktvRoute = src('app/api/ktv/hours-ranking/route.ts');
    const admRoute = src('app/api/admin/ktv-office/hours-ranking/route.ts');
    check(/assignRanks/.test(ktvRoute) && /assignRanks/.test(admRoute),
        'B3b. Ca hai man deu goi CHUNG mot ham xep hang');
    check(!/localeCompare\(b\.name, 'vi'\)/.test(ktvRoute),
        'B3c. Man KTV khong con chot bang TEN');
    const admHoursLogic = src('app/admin/ktv-office/hours/AdminKtvHours.logic.ts');
    check(!/\.map\(\(r, i\) => \(\{ \.\.\.r, rank: i \+ 1 \}\)\)/.test(admHoursLogic),
        'B3d. Client admin khong tu danh so lai, giu thu hang cua server');

    // ══ C. Bật/tắt tính năng ═════════════════════════════════════════
    console.log('\n--- C: bat/tat tinh nang ---');
    const att = src('app/ktv/attendance/_components/AttendanceTypeD.tsx');
    check(!/if \(!state\?\.allow_on_call\) \{\s*return \(/.test(att),
        'C1. Tat nhan don ngoai gio KHONG con return som ca man hinh',
        /Tính năng không khả dụng/.test(att) ? 'van con man chan "Tinh nang khong kha dung"' : '');
    check(/canOnCall && \(/.test(att) || /\{canOnCall &&/.test(att),
        'C1b. Chi cum "Bat Nhan Don" nam sau co');
    // Điểm danh và tan ca phải nằm NGOÀI mọi điều kiện canOnCall.
    const helloIdx = att.indexOf('Oria Xin chào');
    const thanksIdx = att.indexOf('Oria Xin cảm ơn');
    check(helloIdx > 0 && thanksIdx > 0,
        'C1c. Nut "Oria Xin chao" va "Oria Xin cam on" van con trong man hinh');

    // C2 — nút Điểm Office cùng cửa với ví.
    const officeRoute = src('app/api/ktv/office-score/route.ts');
    check(/canSeeOfficePoints/.test(officeRoute),
        'C2. Route diem Office di qua cua chung `canSeeOfficePoints`');

    console.log('\n  Doi chieu tren tung tai khoan that:');
    const rows: any[] = [];
    for (const s of staff) {
        const { data: full } = await supabase
            .from('Staff').select('feature_flags').eq('id', s.id).maybeSingle();
        const flags = (full as any)?.feature_flags;
        const { ok: bonusWallet } = await WalletAccessService.isEnabled(supabase, s.id, 'BONUS');
        const dashboard = await canSeeOfficePoints(supabase, s.id);
        const wallet = bonusWallet;   // dieu kien that cua trang Vi (da gop 1 co)
        rows.push({ id: s.id, vi_diem: bonusWallet, dashboard, vi: wallet });
        if (dashboard !== wallet) {
            check(false, `${s.id}: dashboard va vi LECH nhau`, `dashboard=${dashboard} vi=${wallet}`);
        }
    }
    console.table(rows);
    check(rows.every(r => r.dashboard === r.vi),
        'C2b. Moi tai khoan: nut Dashboard va trang Vi cung an hoac cung hien');

    // ══ D. 0 ngày công thì "chưa có dữ liệu" ═════════════════════════
    console.log('\n--- D: 0 ngay cong => chua co du lieu, khong phai 100 diem ---');
    const scores = await KtvOfficeScoreService.computeMonth(supabase, ids, month);
    const noWork = ids.filter(id => scores.get(id)!.workDays === 0);
    const withWork = ids.filter(id => scores.get(id)!.workDays > 0);

    console.log(`  Chua co ngay cong: ${noWork.join(', ') || 'khong ai'}`);
    console.log(`  Da co ngay cong  : ${withWork.join(', ') || 'khong ai'}`);

    check(noWork.every(id => scores.get(id)!.hasData === false),
        'D1. Ai 0 ngay cong deu co hasData = false');
    check(withWork.every(id => scores.get(id)!.hasData === true),
        'D2. Ai co ngay cong deu co hasData = true');

    // Con số 100 vẫn còn để phép tính không vỡ — nhưng phải kèm cờ để màn hình
    // biết đừng vẽ nó ra.
    if (noWork.length > 0) {
        const m0 = scores.get(noWork[0])!;
        check(m0.hasData === false,
            `D3. ${noWork[0]}: 0 ngay cong ma avg=${m0.avg}, fundDue=${m0.fundDue} — CO co canh bao`,
            'man hinh phai doc hasData truoc khi ve');
    } else {
        console.log('  (thang nay ai cung da di lam — khong kich hoat duoc D3)');
    }

    // Mọi màn hình hiển thị điểm/quỹ đều phải soi cờ này.
    const surfaces: Array<[string, string]> = [
        ['Vi Diem (trang Vi)', 'app/ktv/wallet/page.tsx'],
        ['O Diem Office (Dashboard)', 'app/ktv/dashboard/_screens/ScreenDashboard.tsx'],
        ['Modal Diem Office', 'app/ktv/dashboard/_components/modals.tsx'],
        ['The KTV (trang Cham diem)', 'app/admin/ktv-office/page.tsx'],
    ];
    for (const [name, rel] of surfaces) {
        check(/hasData/.test(src(rel)), `D4. ${name} co kiem hasData`);
    }
    // Và API phải trả cờ ra thì màn hình mới soi được.
    const apis: Array<[string, string]> = [
        ['/api/ktv/office-score', 'app/api/ktv/office-score/route.ts'],
        ['/api/ktv/wallet/bonus/balance', 'lib/services/KtvOfficeBonusService.ts'],
        ['/api/admin/ktv-office/summary', 'app/api/admin/ktv-office/summary/route.ts'],
        ['/api/admin/ktv-office/staff/[id]', 'app/api/admin/ktv-office/staff/[id]/route.ts'],
    ];
    for (const [name, rel] of apis) {
        check(/hasData/.test(src(rel)), `D5. ${name} tra ra hasData`);
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
