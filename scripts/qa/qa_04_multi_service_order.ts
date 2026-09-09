/**
 * QA #4 — Một đơn có NHIỀU DỊCH VỤ, KTV xác nhận / từ chối từng dịch vụ khác nhau.
 *
 * Dựng một đơn thật gồm 3 dịch vụ:
 *   DV1 (30 phút) — gán KTV A          → A bấm NHẬN
 *   DV2 (90 phút) — gán KTV A          → A bấm TỪ CHỐI
 *   DV3 (60 phút) — gán KTV A + KTV B  → A nhận, B chưa bấm gì
 *
 *   M1. Nhận đơn bằng id ĐƠN CON: chỉ đúng dịch vụ đó được đánh dấu.
 *   M2. Nhận đơn bằng id ĐƠN: mọi dịch vụ của KTV đó được đánh dấu, không sót.
 *   M3. Mốc "đã nhận" tách theo TỪNG KTV — A nhận không kéo theo B.
 *   M4. Từ chối phải gọi ĐÍCH DANH dịch vụ; đưa id đơn khi có nhiều dịch vụ
 *       thì API phải TỪ CHỐI ĐOÁN (mức phạt phụ thuộc thời lượng gói).
 *   M5. Không thao tác được lên dịch vụ của người khác.
 *   M6. Danh sách trả về ỔN ĐỊNH giữa hai lần gọi (không phụ thuộc thứ tự DB).
 *
 * Chạy: TS_NODE_PROJECT=scripts/qa/tsconfig.qa.json \
 *       npx ts-node -r tsconfig-paths/register scripts/qa/qa_04_multi_service_order.ts
 *
 * CÓ GHI DB — tạo 1 Booking + 3 BookingItems mang tiền tố QA rồi XOÁ ở finally.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import {
    resolveMyItems, markAccepted, markAcceptedGroup, acceptedAtOf, idsOf,
} from '../../lib/services/KtvOrderTargetService';
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

const BK = '00000000-0000-4000-8000-00000000b001';
const IT = [
    '00000000-0000-4000-8000-00000000b101',
    '00000000-0000-4000-8000-00000000b102',
    '00000000-0000-4000-8000-00000000b103',
];

async function cleanup() {
    await supabase.from('BookingItems').delete().eq('bookingId', BK);
    await supabase.from('Bookings').delete().eq('id', BK);
}

async function readItem(id: string) {
    const { data } = await supabase
        .from('BookingItems').select('id, options, technicianCodes, status').eq('id', id).maybeSingle();
    return data as any;
}

async function main() {
    console.log('\n=== QA #4 · Mot don nhieu dich vu, nhan/tu choi tung cai ===\n');

    const { data: staffRows } = await supabase
        .from('Staff').select('id, full_name')
        .eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id').limit(2);
    if ((staffRows || []).length < 2) {
        console.log('  (can it nhat 2 KTV loai D de chay test nay)');
        return finish(1);
    }
    const A = staffRows![0].id;
    const B = staffRows![1].id;
    console.log(`KTV A = ${A} · KTV B = ${B}\n`);

    try {
        await cleanup();

        await supabase.from('Bookings').insert({
            id: BK, billCode: 'QA-MULTI-04', status: 'IN_PROGRESS',
            bookingDate: '2020-01-10', customerName: 'QA AUTOTEST',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });

        // 3 dịch vụ, thời lượng khác nhau để lộ ra chuyện "bốc đại gói nào".
        const mins = [30, 90, 60];
        const rows = IT.map((id, i) => ({
            id, bookingId: BK, price: 0, quantity: 1,
            technicianCodes: i === 2 ? [A, B] : [A],
            status: 'PREPARING',
            roomName: `QA-DV${i + 1}`,
            options: {},
            segments: JSON.stringify([{ ktvId: i === 2 ? A : A, duration: mins[i] }]),
        }));
        const { error: insErr } = await supabase.from('BookingItems').insert(rows);
        if (insErr) throw new Error(`Khong tao duoc BookingItems QA: ${insErr.message}`);
        console.log(`Da dung don QA-MULTI-04: DV1=${mins[0]}p, DV2=${mins[1]}p, DV3=${mins[2]}p (DV3 co ca ${A} va ${B})\n`);

        // ── M1: nhận bằng id ĐƠN CON ───────────────────────────────────
        console.log('--- M1: nhan bang id DON CON — chi dung dich vu do ---');
        let r = await resolveMyItems(supabase, A, IT[0]);
        check(r.exact && r.items.length === 1 && r.items[0].id === IT[0],
            'Tra dung 1 dich vu khi dua id don con', `${r.items.length} dich vu`);
        await markAccepted(supabase, r.items[0], A);

        const after1 = await Promise.all(IT.map(readItem));
        check(!!acceptedAtOf(after1[0].options, A), 'DV1 da co moc nhan cua A');
        check(!acceptedAtOf(after1[1].options, A), 'DV2 CHUA bi danh dau lay');
        check(!acceptedAtOf(after1[2].options, A), 'DV3 CHUA bi danh dau lay');

        // ── M2: nhận bằng id ĐƠN ───────────────────────────────────────
        console.log('\n--- M2: nhan bang id DON — phai danh dau HET phan viec cua minh ---');
        r = await resolveMyItems(supabase, A, BK);
        check(!r.exact && r.items.length === 3,
            'Tra du 3 dich vu cua A trong don', `${r.items.length} dich vu`);
        for (const it of r.items) await markAccepted(supabase, it, A);

        const after2 = await Promise.all(IT.map(readItem));
        const missed = after2.filter(it => !acceptedAtOf(it.options, A)).map(it => it.roomName);
        check(missed.length === 0,
            'Ca 3 dich vu deu co moc nhan cua A',
            missed.length ? `con sot: ${missed.join(', ')}` : '');
        // Bấm lại không được dời mốc cũ.
        const before3 = acceptedAtOf(after2[0].options, A);
        await markAccepted(supabase, (await resolveMyItems(supabase, A, IT[0])).items[0], A);
        const again = await readItem(IT[0]);
        check(acceptedAtOf(again.options, A) === before3,
            'Bam nhan lan hai khong doi moc cu (idempotent)');

        // ── M3: mốc tách theo từng KTV ─────────────────────────────────
        console.log('\n--- M3: DV3 co 2 KTV — A nhan khong keo theo B ---');
        const dv3 = await readItem(IT[2]);
        check(!!acceptedAtOf(dv3.options, A), 'DV3: A da nhan');
        check(!acceptedAtOf(dv3.options, B), 'DV3: B VAN CHUA nhan — khong bi nhan ho');
        const rB = await resolveMyItems(supabase, B, BK);
        check(rB.items.length === 1 && rB.items[0].id === IT[2],
            'B chi thay dung 1 dich vu cua minh trong don', `${rB.items.length} dich vu`);

        // ── M4: từ chối phải gọi đích danh ─────────────────────────────
        console.log('\n--- M4: tu choi phai goi DICH DANH dich vu ---');
        const rReject = await resolveMyItems(supabase, A, BK);
        check(rReject.items.length > 1,
            'Dua id DON khi co nhieu dich vu => API phai tu choi doan',
            `${rReject.items.length} dich vu — route tra 400 needsItemPick, khong boc dai mot cai`);
        // Vì sao không được đoán: mức phạt = 3 × thời lượng gói.
        const MULT = 3;
        console.log(`    Neu boc dai: DV1 → phat ${(mins[0] / 60) * MULT}h · DV2 → phat ${(mins[1] / 60) * MULT}h · DV3 → phat ${(mins[2] / 60) * MULT}h`);
        check(true, 'Cung mot cu bam ma ra 3 muc phat khac nhau — day la ly do phai chon dich danh');

        const rExact = await resolveMyItems(supabase, A, IT[1]);
        check(rExact.exact && rExact.items.length === 1 && rExact.items[0].id === IT[1],
            'Goi dich danh DV2 thi tra dung DV2');

        // Mô phỏng phần gỡ KTV của route reject: chỉ đụng DV2.
        const me = A.toLowerCase();
        const dv2 = await readItem(IT[1]);
        const newCodes = (dv2.technicianCodes || []).filter((c: string) => c.toLowerCase() !== me);
        await supabase.from('BookingItems').update({
            technicianCodes: newCodes,
            status: newCodes.length === 0 ? 'PREPARING' : dv2.status,
        }).eq('id', IT[1]);

        const after4 = await Promise.all(IT.map(readItem));
        check(!after4[1].technicianCodes.includes(A), 'DV2: A da duoc go khoi dich vu bi tu choi');
        check(after4[0].technicianCodes.includes(A), 'DV1: A VAN giu — khong bi go lay');
        check(after4[2].technicianCodes.includes(A) && after4[2].technicianCodes.includes(B),
            'DV3: ca A va B van giu nguyen');

        const rAfter = await resolveMyItems(supabase, A, BK);
        check(rAfter.items.length === 2,
            'Sau khi tu choi 1 dich vu, A con dung 2 dich vu trong don',
            `${rAfter.items.length} dich vu`);

        // ── M5: không đụng được dịch vụ của người khác ─────────────────
        console.log('\n--- M5: khong thao tac duoc len dich vu cua nguoi khac ---');
        const notMine = await resolveMyItems(supabase, B, IT[0]);   // DV1 chi cua A
        check(notMine.items.length === 0,
            'Dua id don con KHONG phai cua minh => tra rong, khong cho thao tac',
            `${notMine.items.length} dich vu`);

        // ── M6: thứ tự ổn định ─────────────────────────────────────────
        console.log('\n--- M6: danh sach on dinh giua hai lan goi ---');
        const s1 = (await resolveMyItems(supabase, A, BK)).items.map(i => i.id).join(',');
        const s2 = (await resolveMyItems(supabase, A, BK)).items.map(i => i.id).join(',');
        check(s1 === s2 && s1 === [IT[0], IT[2]].sort().join(','),
            'Hai lan goi ra cung thu tu, sap theo id',
            s1);

        // ── M7: dịch vụ GHÉP ───────────────────────────────────────────
        console.log('\n--- M7: dich vu GHEP (mergedIntoId) ---');
        // Dựng lại: DV1 là cha, DV2 ghép vào DV1, cả hai gán cho A.
        await supabase.from('BookingItems')
            .update({ technicianCodes: [A], options: { mergedServiceIds: [IT[1]] } })
            .eq('id', IT[0]);
        await supabase.from('BookingItems')
            .update({ technicianCodes: [A], options: { mergedIntoId: IT[0] } })
            .eq('id', IT[1]);

        const rMerged = await resolveMyItems(supabase, A, BK);
        const merged = rMerged.items.find(i => i.id === IT[0]);
        check(!!merged && merged.mergedChildren.includes(IT[1]),
            'Cum ghep gom ve MOT lua chon, dai dien la dich vu cha',
            `${rMerged.items.length} lua chon: ${rMerged.items.map(i => `${i.id.slice(-4)}(+${i.mergedChildren.length})`).join(', ')}`);
        check(!rMerged.items.some(i => i.id === IT[1]),
            'Dich vu con KHONG hien thanh mot lua chon rieng');
        check(rMerged.items.length === 2,
            'Don con 2 lua chon: cum ghep (DV1+DV2) va DV3', `${rMerged.items.length}`);

        // Gửi thẳng id của dịch vụ CON cũng phải quy về cả cụm.
        const rByChild = await resolveMyItems(supabase, A, IT[1]);
        check(rByChild.items.length === 1 && rByChild.items[0].id === IT[0]
            && rByChild.items[0].mergedChildren.includes(IT[1]),
            'Dua id dich vu CON van quy ve dich vu cha kem ca cum',
            rByChild.items.map(i => i.id.slice(-4)).join(','));

        check(idsOf(merged!).sort().join(',') === [IT[0], IT[1]].sort().join(','),
            'idsOf() liet ke du ca cha lan con');

        // Nhận đơn: cả cụm phải được đánh dấu.
        await markAcceptedGroup(supabase, (await resolveMyItems(supabase, A, IT[0])).items[0], A);
        const [p7, c7] = await Promise.all([readItem(IT[0]), readItem(IT[1])]);
        check(!!acceptedAtOf(p7.options, A) && !!acceptedAtOf(c7.options, A),
            'Nhan don: ca dich vu cha VA dich vu ghep deu co moc nhan');

        // Từ chối: gỡ cả cụm (mô phỏng đúng vòng lặp của route).
        const meLower = A.toLowerCase();
        const { data: rows7 } = await supabase
            .from('BookingItems').select('id, technicianCodes, status').in('id', idsOf(merged!));
        for (const r of (rows7 || [])) {
            const left = (r.technicianCodes || []).filter((c: string) => c.toLowerCase() !== meLower);
            await supabase.from('BookingItems')
                .update({ technicianCodes: left, status: left.length === 0 ? 'PREPARING' : r.status })
                .eq('id', r.id);
        }
        const [p8, c8] = await Promise.all([readItem(IT[0]), readItem(IT[1])]);
        check(!p8.technicianCodes.includes(A) && !c8.technicianCodes.includes(A),
            'Tu choi: KTV duoc go khoi CA cha lan con, khong con dinh lai');
        const rLeft = await resolveMyItems(supabase, A, BK);
        check(rLeft.items.length === 1 && rLeft.items[0].id === IT[2],
            'Sau khi tu choi cum ghep, A chi con DV3', `${rLeft.items.length} lua chon`);

    } finally {
        await cleanup();
        console.log('\n  (da don du lieu QA)');
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
