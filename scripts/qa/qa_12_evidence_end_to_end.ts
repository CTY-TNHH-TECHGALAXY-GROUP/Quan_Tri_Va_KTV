/**
 * QA #12 — Ảnh minh chứng: admin ghi → DB → KTV xem lại ĐÚNG ảnh của ĐÚNG lỗi.
 *
 * Đây là kịch bản đi TRỌN đường, không phải kiểm bằng mắt trên source:
 *   ghi  : `resolvePhotosPerCriteria` + `buildDeductRows` — đúng hai hàm mà
 *          `POST /api/admin/ktv-office/deduct` đang gọi;
 *   đọc  : `officeBonusTimeline` (thẻ Ví Điểm) và `markSharedPhotosWithinDay`
 *          (đường mà `/api/ktv/office-score` dùng cho Dashboard).
 * Chỉ mỗi khâu đẩy file lên storage là thay bằng link giả — chỗ đó chưa bao giờ
 * là nguồn lỗi, và không nên rác hoá bucket thật mỗi lần chạy test.
 *
 *   E1. Ba lỗi, mỗi lỗi ảnh riêng  → KTV thấy đúng ảnh dưới đúng lỗi.
 *   E2. Không lỗi nào mượn ảnh của lỗi khác.
 *   E3. Không còn ảnh lặp trong ngày.
 *   E4. Lỗi bắt buộc ảnh mà thiếu ảnh RIÊNG thì bị chặn, dù lỗi khác đã có ảnh.
 *   E5. Rổ ảnh dùng chung bị chặn khi tích nhiều lỗi; vẫn cho khi đúng một lỗi.
 *   E6. Trần ảnh áp cho TỪNG lỗi.
 *   E7. Dữ liệu CŨ (một ảnh dính nhiều lỗi): KTV vẫn xem được ảnh ở MỌI lỗi,
 *       kèm nhãn 'ảnh dùng chung' — không tấm nào bị giấu đi.
 *   E8. GHI CHÚ cũng của riêng từng lỗi, không dùng chung một câu cho tất cả.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_12_evidence_end_to_end.ts
 *
 * CÓ GHI DB — phiếu trừ ngày 2019-03-11/12 (trước khi hệ thống tồn tại), xoá ở finally.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import {
    resolvePhotosPerCriteria, resolveNotesPerCriteria, buildDeductRows, MAX_PHOTOS_PER_CRITERIA,
} from '../../lib/services/KtvOfficeEvidenceService';
import { officeBonusTimeline, markSharedPhotosWithinDay } from '../../lib/services/KtvOfficeBonusService';
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

const DAY = '2019-03-11';
const DAY_LEGACY = '2019-03-12';
const MONTH = '2019-03';

async function main() {
    console.log('\n=== QA #12 · Anh minh chung: admin ghi -> KTV xem lai ===\n');

    const { data: staffRows } = await supabase
        .from('Staff').select('id, full_name')
        .eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id').limit(1);
    if (!staffRows?.length) { console.log('  (khong co KTV loai D)'); return finish(1); }
    const staffId = staffRows[0].id;

    // Ba tiêu chí thật: hai cái BẮT BUỘC ảnh (nhóm III), một cái không.
    const { data: critAll } = await supabase
        .from('KTVOfficeCriteria')
        .select('id, label, points, requires_photo').eq('is_active', true);
    const needPhoto = (critAll || []).filter((c: any) => c.requires_photo).slice(0, 2);
    const noPhoto = (critAll || []).find((c: any) => !c.requires_photo);
    if (needPhoto.length < 2 || !noPhoto) {
        console.log('  (can it nhat 2 tieu chi bat buoc anh + 1 tieu chi khong)');
        return finish(1);
    }
    const [c1, c2] = needPhoto;
    const c3 = noPhoto;
    console.log(`KTV: ${staffId}`);
    console.log(`Loi: ${c1.id} "${c1.label}" · ${c2.id} "${c2.label}" · ${c3.id} "${c3.label}"\n`);

    const clean = async () => {
        await supabase.from('KTVOfficeScoreLog')
            .delete().eq('staff_id', staffId).in('work_date', [DAY, DAY_LEGACY]);
    };

    // Link giả, phân biệt được bằng mắt để biết tấm nào của lỗi nào.
    const P = (tag: string, n: number) => `https://qa.invalid/${tag}-${n}.jpg`;

    try {
        await clean();

        // ══ E5/E6/E4: các cửa chặn trước khi ghi ═════════════════════
        console.log('--- E5: ro anh DUNG CHUNG ---');
        const shared = resolvePhotosPerCriteria(
            [c1, c2, c3] as any, undefined, [P('chung', 1), P('chung', 2)]);
        check(!shared.ok && shared.code === 'PHOTOS_MUST_BE_PER_CRITERIA',
            'Tich NHIEU loi ma gui ro chung => CHAN',
            shared.ok ? 'KHONG chan!' : shared.error);

        const oneOnly = resolvePhotosPerCriteria([c1] as any, undefined, [P('chung', 1)]);
        check(oneOnly.ok && oneOnly.perCriteria[c1.id].length === 1,
            'Tich DUNG MOT loi thi ro chung van duoc (khong the nhap nhang)');

        console.log('\n--- E4: thieu anh RIENG cho loi bat buoc ---');
        // c1 có ảnh, c2 (cũng bắt buộc) không → phải chặn, không được "mượn" của c1.
        const missing = resolvePhotosPerCriteria(
            [c1, c2] as any, { [c1.id]: [P('c1', 1)] });
        check(!missing.ok && missing.code === 'MISSING_REQUIRED_PHOTO',
            'Loi bat buoc anh KHONG duoc muon anh cua loi khac',
            missing.ok ? 'LOT!' : missing.error);
        check(!missing.ok && missing.error.includes(c2.label),
            'Thong bao goi dich danh loi con thieu', missing.ok ? '' : missing.error);

        console.log('\n--- E6: tran anh ap cho TUNG loi ---');
        const many = Array.from({ length: MAX_PHOTOS_PER_CRITERIA + 3 }, (_, i) => P('nhieu', i));
        const capped = resolvePhotosPerCriteria(
            [c1, c2] as any, { [c1.id]: many, [c2.id]: many });
        check(capped.ok
            && capped.perCriteria[c1.id].length === MAX_PHOTOS_PER_CRITERIA
            && capped.perCriteria[c2.id].length === MAX_PHOTOS_PER_CRITERIA,
            `Moi loi duoc rieng ${MAX_PHOTOS_PER_CRITERIA} anh, khong chia nhau mot tran`,
            capped.ok ? `${capped.perCriteria[c1.id].length} + ${capped.perCriteria[c2.id].length}` : '');

        // ══ E1/E2/E3: ghi thật rồi đọc lại bằng đường của KTV ════════
        console.log('\n--- E1/E2/E3: ghi that roi doc lai bang duong cua KTV ---');
        const wanted: Record<string, string[]> = {
            [c1.id]: [P('c1', 1), P('c1', 2)],
            [c2.id]: [P('c2', 1)],
            [c3.id]: [],
        };
        const resolved = resolvePhotosPerCriteria([c1, c2, c3] as any, wanted);
        if (!resolved.ok) { check(false, 'Dung phieu hop le', resolved.error); return finish(failures); }

        // Mỗi lỗi một câu ghi chú khác nhau — để biết câu nào rơi vào lỗi nào.
        const notesWanted: Record<string, string> = {
            [c1.id]: 'QA-AUTOTEST ghi chu cua LOI 1',
            [c2.id]: 'QA-AUTOTEST ghi chu cua LOI 2',
            [c3.id]: '',
        };
        const notesOf = resolveNotesPerCriteria([c1, c2, c3] as any, notesWanted);

        const rows = buildDeductRows({
            staffId, workDate: DAY, criteria: [c1, c2, c3] as any,
            urlsOf: resolved.perCriteria,          // that ra la link sau khi upload
            notesOf, createdBy: staffId, createdByName: 'QA',
        });
        const { error: insErr } = await supabase.from('KTVOfficeScoreLog').insert(rows);
        if (insErr) throw new Error(`Khong ghi duoc phieu QA: ${insErr.message}`);
        console.log(`  Da ghi ${rows.length} phieu cho ngay ${DAY}`);

        // Đọc lại đúng như thẻ Ví Điểm của KTV.
        const timeline = await officeBonusTimeline(supabase, staffId, MONTH);
        const day = timeline.find(d => d.date === DAY);
        check(!!day, `KTV thay ngay ${DAY} trong lich su`);

        const seen = new Map<string, string[]>();
        for (const h of day!.hits) seen.set(h.label, h.photoUrls);
        console.table(day!.hits.map(h => ({
            loi: h.label.slice(0, 26), so_anh: h.photoCount,
            anh: h.photoUrls.map(u => u.split('/').pop()).join(' ') || '(khong)',
        })));

        check((seen.get(c1.label) || []).join() === wanted[c1.id].join(),
            `"${c1.label}" hien DUNG anh cua no`, (seen.get(c1.label) || []).join(' '));
        check((seen.get(c2.label) || []).join() === wanted[c2.id].join(),
            `"${c2.label}" hien DUNG anh cua no`, (seen.get(c2.label) || []).join(' '));
        check((seen.get(c3.label) || []).length === 0,
            `"${c3.label}" khong co anh thi KHONG muon cua loi khac`);

        // ── E8: ghi chú theo từng lỗi ─────────────────────────────────
        console.log('\n--- E8: ghi chu cua RIENG tung loi ---');
        const noteOf = new Map<string, string | null>();
        for (const h of day!.hits) noteOf.set(h.label, h.note);
        console.table(day!.hits.map(h => ({
            loi: h.label.slice(0, 26), ghi_chu: h.note ?? '(khong)',
        })));
        check(noteOf.get(c1.label) === notesWanted[c1.id],
            `"${c1.label}" mang DUNG ghi chu cua no`, String(noteOf.get(c1.label)));
        check(noteOf.get(c2.label) === notesWanted[c2.id],
            `"${c2.label}" mang DUNG ghi chu cua no`, String(noteOf.get(c2.label)));
        check(noteOf.get(c3.label) === null,
            `"${c3.label}" khong ghi chu thi de TRONG, khong muon cau cua loi khac`);
        check(new Set(day!.hits.map(h => h.note).filter(Boolean)).size
            === day!.hits.filter(h => h.note).length,
            'Khong hai loi nao dung chung mot cau ghi chu');

        // Đường CŨ (một ô ghi chú chung) chỉ còn nhận khi tích ĐÚNG MỘT lỗi.
        const chungNhieu = resolveNotesPerCriteria([c1, c2] as any, undefined, 'ghi chu chung');
        check(chungNhieu[c1.id] === '' && chungNhieu[c2.id] === '',
            'Nhieu loi ma chi co ghi chu chung => KHONG rai cho ca hai',
            `${JSON.stringify(chungNhieu)}`);
        const chungMot = resolveNotesPerCriteria([c1] as any, undefined, 'ghi chu chung');
        check(chungMot[c1.id] === 'ghi chu chung',
            'Dung MOT loi thi ghi chu chung van duoc (khong the nham lan)');

        // E2 — không tấm nào xuất hiện dưới hai lỗi.
        const owner = new Map<string, string[]>();
        for (const h of day!.hits) for (const u of h.photoUrls) {
            if (!owner.has(u)) owner.set(u, []);
            owner.get(u)!.push(h.label);
        }
        const sharedUrls = [...owner.entries()].filter(([, ls]) => ls.length > 1);
        check(sharedUrls.length === 0,
            'Khong tam anh nao dinh vao hai loi',
            sharedUrls.map(([u, ls]) => `${u.split('/').pop()} @ ${ls.join(' + ')}`).join(' | '));

        // E3 — tổng số lượt hiện = đúng số ảnh đã tải.
        const totalShown = day!.hits.reduce((a, h) => a + h.photoCount, 0);
        const totalUploaded = Object.values(wanted).flat().length;
        check(totalShown === totalUploaded,
            'So luot anh hien ra = so anh da tai len',
            `${totalShown} / ${totalUploaded}`);

        // ══ E7: dữ liệu CŨ — một ảnh dính nhiều lỗi ══════════════════
        console.log('\n--- E7: du lieu CU (mot anh dinh nhieu loi) ---');
        const legacyUrl = P('cu', 1);
        const legacyRows = [c1, c2, c3].map(c => ({
            staff_id: staffId, work_date: DAY_LEGACY,
            criteria_id: c.id, criteria_label: c.label,
            points_deducted: Number(c.points) || 0,
            note: 'QA-AUTOTEST-LEGACY',
            photo_urls: [legacyUrl],          // dung y het cach ghi cu
            created_by: staffId, created_by_name: 'QA',
        }));
        const { error: legErr } = await supabase.from('KTVOfficeScoreLog').insert(legacyRows);
        if (legErr) throw new Error(`Khong ghi duoc phieu cu QA: ${legErr.message}`);

        const tl2 = await officeBonusTimeline(supabase, staffId, MONTH);
        const dayOld = tl2.find(d => d.date === DAY_LEGACY)!;

        // ⚠️ Ban dau cho nay XOA anh trung, va do la sai lam: tren du lieu that
        // (T016 ngay 05/09, 1 anh dinh 8 loi) KTV mat sach bang chung o 7/8 loi.
        // Voi nguoi bi tru diem, "khong co anh" te hon han "anh dung chung".
        const coAnh = dayOld.hits.filter(h => h.photoCount > 0).length;
        check(coAnh === 3,
            'Phieu cu: CA BA loi van xem duoc anh, khong loi nao bi giau',
            `${coAnh}/3 loi con anh`);
        check(dayOld.hits.every(h => h.photoUrls.includes(legacyUrl)),
            'Moi loi van tro toi dung tam anh da chup');
        check(dayOld.hits.every(h => h.sharedPhotos === true),
            'Ca ba deu duoc gan co "anh dung chung" de man hinh giai thich cho lap');

        // Phiếu ghi theo đường mới (ngày DAY) thì không được gắn cờ.
        const dayNew = tl2.find(d => d.date === DAY)!;
        check(dayNew.hits.every(h => h.sharedPhotos === false),
            'Phieu ghi theo duong moi khong bi gan co dung chung');

        console.log(`\n  (Ghi chu: du lieu that dang co 3 ngay bi dinh canh nay — T016 ngay`);
        console.log(`   04/09, 05/09, 08/09. Rieng 05/09 mot tam anh dinh vao 8 loi.`);
        console.log(`   Phieu ghi tu bay gio khong con nhu vay; phieu cu duoc va o tang doc.)`);

    } finally {
        await clean();
        console.log('\n  (da don du lieu QA)');
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
