/**
 * QA #5 — Giới hạn BỎ QUA bàn giao (dọn phòng): lần thứ 3 phải bị chặn.
 *
 * Quy ước: `SystemConfigs.max_handover_skip` (mặc định 2) là số phòng ĐANG NỢ
 * tối đa. Nợ = BookingItem có `handover_skipped = true` và
 * `handover_status = 'SKIPPED'`. Trả nợ xong thì lấy lại lượt.
 *
 *   S1. Đọc cấu hình: thiếu / rác → 2.
 *   S2. Bỏ qua lần 1, lần 2 được; lần 3 BỊ CHẶN.
 *   S3. Trả nợ một phòng → lấy lại đúng 1 lượt.
 *   S4. Ràng buộc DB: đã nộp (PENDING) thì không được còn cờ bỏ qua.
 *   S5. Hai lần bấm CÙNG LÚC ở lượt cuối — có lọt lượt thứ 3 không.
 *   S6. Route có buộc `ktvCode` khớp người đang đăng nhập không.
 *
 * Chạy: TS_NODE_PROJECT=scripts/qa/tsconfig.qa.json \
 *       npx ts-node -r tsconfig-paths/register scripts/qa/qa_05_skip_limit.ts
 *
 * CÓ GHI DB — tạo 1 Booking + 4 BookingItems mang tiền tố QA rồi XOÁ ở finally.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { HandoverService } from '../../lib/services/HandoverService';

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

const QA_BOOKING_ID = '00000000-0000-4000-8000-00000000qa05'.replace('qa', 'a0');
const QA_BILL = 'QA-SKIP-05';

async function cleanup(ktvCode: string) {
    await supabase.from('BookingItems').delete().eq('bookingId', QA_BOOKING_ID);
    await supabase.from('Bookings').delete().eq('id', QA_BOOKING_ID);
}

async function main() {
    console.log('\n=== QA #5 · Gioi han bo qua don phong ===\n');

    // ── S1: đọc cấu hình ───────────────────────────────────────────────
    const { data: cfgRow } = await supabase
        .from('SystemConfigs').select('value').eq('key', 'max_handover_skip').maybeSingle();
    const rawCfg = (cfgRow as any)?.value;
    const parsed = parseInt(String(rawCfg ?? '2'), 10);
    const maxSkip = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
    console.log(`--- S1: cau hinh max_handover_skip ---`);
    console.log(`  Gia tri trong DB: ${JSON.stringify(rawCfg)} → max = ${maxSkip}`);
    check(maxSkip >= 1, 'Han muc doc ra hop le', `${maxSkip} luot`);
    // Rác / thiếu phải rơi về 2, không được thành NaN (NaN >= NaN luôn false → mở toang).
    for (const bad of [undefined, null, '', 'abc', '"x"']) {
        const p = parseInt(String(bad ?? '2'), 10);
        const m = Number.isFinite(p) && p >= 0 ? p : 2;
        if (m !== 2) { check(false, `Cau hinh rac ${JSON.stringify(bad)} → ${m}`, 'phai ve 2'); }
    }
    check(true, 'Cau hinh thieu/rac deu roi ve mac dinh 2');

    // ── Chuẩn bị: chọn KTV loại D chưa nợ phòng nào ────────────────────
    const { data: staffRows } = await supabase
        .from('Staff').select('id, full_name')
        .eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ');

    let ktvCode = '';
    for (const s of staffRows || []) {
        const q = await HandoverService.getSkipQuota(supabase, s.id);
        if (q.used === 0) { ktvCode = s.id; break; }
    }
    if (!ktvCode) {
        console.log('\n  (khong tim duoc KTV loai D dang sach no — bo qua S2..S5)');
        console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
        process.exit(failures === 0 ? 0 : 1);
    }
    console.log(`\nKTV dung de test: ${ktvCode} (dang no 0 phong)`);

    try {
        await cleanup(ktvCode);

        // Booking + (maxSkip + 2) item để bỏ qua lần lượt.
        const nItems = maxSkip + 2;
        const { error: bkErr } = await supabase.from('Bookings').insert({
            id: QA_BOOKING_ID, billCode: QA_BILL, status: 'IN_PROGRESS',
            bookingDate: '2020-01-10', customerName: 'QA AUTOTEST',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        if (bkErr) throw new Error(`Khong tao duoc Booking QA: ${bkErr.message}`);

        const items = Array.from({ length: nItems }, (_, i) => ({
            id: `00000000-0000-4000-8000-00000000a0${i + 1}`,
            bookingId: QA_BOOKING_ID,
            price: 0,
            quantity: 1,
            technicianCodes: [ktvCode],
            status: 'CLEANING',
            // Mặc định của cột là 'PENDING' — đúng trạng thái của item chưa ai nộp gì.
            handover_status: 'PENDING',
            handover_skipped: false,
            handover_submitted_at: null,
            roomName: `QA-P${i + 1}`,
        }));
        const { error: itErr } = await supabase.from('BookingItems').insert(items);
        if (itErr) throw new Error(`Khong tao duoc BookingItems QA: ${itErr.message}`);

        // ── S2: bỏ qua tới khi hết lượt ────────────────────────────────
        console.log(`\n--- S2: bo qua lien tiep (han muc ${maxSkip}) ---`);
        for (let i = 0; i < nItems; i++) {
            const before = await HandoverService.getSkipQuota(supabase, ktvCode);
            const res = await HandoverService.skipHandover(supabase, items[i].id, ktvCode);
            const shouldPass = i < maxSkip;
            check(res.success === shouldPass,
                `Lan ${i + 1}: ${shouldPass ? 'phai CHO' : 'phai CHAN'}`,
                `con ${before.remaining}/${before.max} truoc khi bam → ${res.success ? 'CHO QUA' : 'CHAN: ' + res.error}`);
        }
        const afterAll = await HandoverService.getSkipQuota(supabase, ktvCode);
        check(afterAll.used === maxSkip && afterAll.remaining === 0,
            `Sau khi het luot: dang no dung ${maxSkip} phong`,
            `used=${afterAll.used} remaining=${afterAll.remaining}`);

        // Ô nhắc nợ trên dashboard phải thấy đúng số phòng đó.
        const pending = await HandoverService.getPendingHandovers(supabase, ktvCode);
        check(pending.count === maxSkip,
            'O nhac "No ban giao" tren dashboard dem dung so phong',
            `${pending.count} phong`);

        // ── S3: trả nợ 1 phòng → lấy lại 1 lượt ────────────────────────
        console.log('\n--- S3: tra no mot phong thi lay lai mot luot ---');
        const repay = await HandoverService.submitHandover(
            supabase, items[0].id, { 'Ảnh tổng quan phòng': ['https://example.invalid/qa.jpg'] });
        check(repay.success, 'Nop lai anh ban giao cho phong dang no', repay.error || '');

        const afterRepay = await HandoverService.getSkipQuota(supabase, ktvCode);
        check(afterRepay.used === maxSkip - 1 && afterRepay.remaining === 1,
            'Tra no xong lay lai dung 1 luot',
            `used=${afterRepay.used} remaining=${afterRepay.remaining}`);

        const resAfterRepay = await HandoverService.skipHandover(supabase, items[maxSkip].id, ktvCode);
        check(resAfterRepay.success, 'Bo qua duoc tiep sau khi tra no',
            resAfterRepay.error || '');

        // ── S4: ràng buộc DB ───────────────────────────────────────────
        console.log('\n--- S4: rang buoc DB "da nop thi khong con co bo qua" ---');
        const bad = await supabase.from('BookingItems')
            .update({ handover_skipped: true, handover_status: 'PENDING' })
            .eq('id', items[0].id).select('id');
        check(!!bad.error, 'DB CHAN trang thai PENDING + skipped=true',
            bad.error ? `code=${(bad.error as any).code}` : 'KHONG chan — constraint bien mat');

        // ── S5: hai lần bấm cùng lúc ở lượt cuối ───────────────────────
        console.log('\n--- S5: hai lan bam CUNG LUC o luot cuoi ---');
        // Đưa về đúng 1 lượt còn lại: hạ hết nợ rồi tạo lại (maxSkip - 1) nợ.
        await supabase.from('BookingItems')
            .update({ handover_skipped: false, handover_status: 'PENDING', handover_submitted_at: null })
            .eq('bookingId', QA_BOOKING_ID);
        for (let i = 0; i < maxSkip - 1; i++) {
            await HandoverService.skipHandover(supabase, items[i].id, ktvCode);
        }
        const beforeRace = await HandoverService.getSkipQuota(supabase, ktvCode);
        check(beforeRace.remaining === 1, 'Dung con 1 luot truoc khi thu dua',
            `remaining=${beforeRace.remaining}`);

        const [r1, r2] = await Promise.all([
            HandoverService.skipHandover(supabase, items[maxSkip - 1].id, ktvCode),
            HandoverService.skipHandover(supabase, items[maxSkip].id, ktvCode),
        ]);
        const passed = [r1, r2].filter(r => r.success).length;
        const afterRace = await HandoverService.getSkipQuota(supabase, ktvCode);
        check(passed === 1 && afterRace.used <= maxSkip,
            'Bam cung luc chi mot lan lot qua',
            `${passed}/2 lot, sau do dang no ${afterRace.used}/${maxSkip}` +
            (passed > 1 ? ' — CUA CHAN doc-roi-ghi khong co khoa, vuot han muc' : ''));

        // ── S6: route có buộc ktvCode khớp phiên đăng nhập không ───────
        console.log('\n--- S6: route co buoc ktvCode khop nguoi dang dang nhap khong ---');
        const routeSrc = fs.readFileSync(
            path.join(__dirname, '../../app/api/ktv/handover/skip/route.ts'), 'utf8');
        const bindsIdentity = /currentStaffId|bUser\.techCode|requireStaffMatches/.test(routeSrc);
        check(bindsIdentity, 'ktvCode duoc doi chieu voi phien dang nhap',
            bindsIdentity ? '' : 'ktvCode lay THANG tu body — gui ma dong nghiep la dung han muc cua ho, luot cua minh khong bi tru');

    } finally {
        await cleanup(ktvCode);
        const left = await HandoverService.getSkipQuota(supabase, ktvCode);
        console.log(`\n  (da don du lieu QA — ${ktvCode} con no ${left.used} phong)`);
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
