/**
 * QA #22 — GHÉP 2 DỊCH VỤ ("Gộp chung KTV") ở bảng điều phối. BẮT BUỘC chạy khi sửa luồng này (CLAUDE.md mục 9).
 *
 * Sự cố 06/10/2026, đơn 11NDK-004-06102026 (2 khách, đã tách A/B, mỗi khách Ấn huyệt chân 60p + Kết hợp 4 liệu trình 70p):
 *   Lần 1 "Giờ hoặc thời lượng không hợp lệ": dịch vụ sau bị chép KTV, gửi chặng 0 phút → RPC từ chối cả lần lưu.
 *   Lần 2 gộp nửa vời: lưu từng dòng KTV gửi tên ghép + 130p nhưng KHÔNG gửi dấu ghép của dịch vụ sau.
 * Bản 05/10 (b6fddd3d) chỉ mô phỏng 6 ca, thiếu "đã tách A/B" và "gán KTV trước rồi ghép" — hai ca đó có ở đây.
 *
 * Mỗi ca in: thời lượng chặng dịch vụ trước, dịch vụ sau có chặng/KTV không, tổng phút đồng hồ KTV.
 * KHÔNG chạm DB.
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_22_ghep_dich_vu.ts
 */
import { mergeServicesIntoParent, ktvsRemovedByMerge } from '@/app/reception/dispatch/_components/QuickDispatchTable.logic';
import {
    pickLeadingService, withFollowingServices, normalizeFollowingItemUpdates, findInvalidSegment,
    originalMergedMinutes, mergedIntoIdOf,
} from '@/lib/dispatch/merged-service';
import { ktvAssignedMinutes } from '@/lib/ktvUtils';
import type { ServiceBlock } from '@/app/reception/dispatch/types';
import { finish, fatal } from './_exit';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

const isUtility = (s: ServiceBlock) => !!s.is_utility || /phòng riêng/i.test(s.serviceName);

let segSeq = 0;
const row = (ktvId: string, start: string, duration: number) => ({
    id: `row-${ktvId}-${++segSeq}`, ktvId, ktvName: ktvId, noteForKtv: '',
    segments: [{ id: `seg-${segSeq}`, roomId: 'V1', bedId: 'V1-2', startTime: start, endTime: '', duration }],
}) as any;

const svc = (id: string, name: string, duration: number, staff: any[] = [], extra: Partial<ServiceBlock> = {}): ServiceBlock => ({
    id, serviceName: name, duration, selectedRoomId: null, bedId: null, staffList: staff,
    adminNote: '', genderReq: '', strength: '', focus: '', avoid: '', customerNote: '', options: {}, status: 'NEW', ...extra,
});

/** Mô phỏng payload lưu (giống handleSaveDraft/handleDispatch sau sửa) → lớp server → item như trong DB. */
function saveAndLoad(services: ServiceBlock[]) {
    const payload = services.map(s => {
        const following = !!mergedIntoIdOf(s);
        return {
            id: s.id,
            technicianCodes: following || isUtility(s) ? [] : s.staffList.map(r => r.ktvId).filter(Boolean),
            segments: following ? [] : s.staffList.filter(r => r.ktvId).flatMap(r => r.segments.map((seg: any) => ({ ...seg, ktvId: r.ktvId }))),
            options: { displayName: s.serviceName, mergedIntoId: mergedIntoIdOf(s) ?? null, mergedServiceIds: s.mergedServiceIds },
        };
    });
    const { itemUpdates } = normalizeFollowingItemUpdates(payload);
    return { itemUpdates, invalid: findInvalidSegment(itemUpdates) };
}

/** App KTV: nạp dịch vụ có KTV trong technicianCodes, cộng phút như ScreenTimer (ktvAssignedMinutes). */
const timerMinutes = (items: any[], ktv: string) =>
    items.filter(i => (i.technicianCodes || []).includes(ktv)).reduce((sum, i) => sum + ktvAssignedMinutes(i, ktv), 0);

interface Case { name: string; services: ServiceBlock[]; select: string[]; ktv: string; expectMinutes: number; expectLeading: string; expectRemoved?: string[] }

const CASES: Case[] = [
    { name: '1KTV-1DV (không ghép — đối chứng)', services: [svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60)])],
      select: [], ktv: 'T007', expectMinutes: 60, expectLeading: 'a' },
    { name: '1KTV-2DV ghép, KTV gán ở dịch vụ trước', services: [svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70)],
      select: ['a', 'b'], ktv: 'T007', expectMinutes: 130, expectLeading: 'a' },
    { name: 'GÁN KTV TRƯỚC RỒI GHÉP (lần 1 hôm 06/10): cùng T007 ở cả 2 dịch vụ',
      services: [svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70, [row('T007', '22:42', 70)])],
      select: ['a', 'b'], ktv: 'T007', expectMinutes: 130, expectLeading: 'a', expectRemoved: [] },
    { name: 'Dịch vụ sau có KTV KHÁC → gỡ, báo quầy',
      services: [svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70, [row('T010', '21:42', 70)])],
      select: ['a', 'b'], ktv: 'T007', expectMinutes: 130, expectLeading: 'a', expectRemoved: ['T010'] },
    { name: 'Dịch vụ trước chưa có KTV, dịch vụ sau có → KTV chuyển sang trước',
      services: [svc('a', 'Ấn huyệt chân', 60), svc('b', 'Kết hợp 4 liệu trình', 70, [row('T007', '21:42', 70)])],
      select: ['a', 'b'], ktv: 'T007', expectMinutes: 130, expectLeading: 'a' },
    { name: '2KTV-1DV ghép thêm 1 dịch vụ → cả 2 KTV +70',
      services: [svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60), row('T010', '21:42', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70)],
      select: ['a', 'b'], ktv: 'T010', expectMinutes: 130, expectLeading: 'a' },
    { name: 'Chọn theo thứ tự: bấm dịch vụ sau trước vẫn lấy dịch vụ đứng trước trên đơn',
      services: [svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70)],
      select: ['b', 'a'], ktv: 'T007', expectMinutes: 130, expectLeading: 'a' },
    { name: 'Phòng riêng đứng đầu đơn → không bao giờ là dịch vụ trước, không cộng phút',
      services: [svc('p', 'Phòng riêng', 0, [], { is_utility: true }), svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70)],
      select: ['p', 'a', 'b'], ktv: 'T007', expectMinutes: 130, expectLeading: 'a' },
    { name: 'Ca đêm qua nửa đêm: 23:00 + 130p', services: [svc('a', 'Ấn huyệt chân', 60, [row('T007', '23:00', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70)],
      select: ['a', 'b'], ktv: 'T007', expectMinutes: 130, expectLeading: 'a' },
];

async function main() {
    console.log('\n=== Ghép từng ca: bấm ghép → lưu → server làm sạch → app KTV ===');
    const table: any[] = [];
    for (const c of CASES) {
        let services = c.services;
        let leadingId = c.services[0].id;
        let removed: string[] = [];
        if (c.select.length) {
            const selected = c.select.map(id => services.find(s => s.id === id)!);
            const leading = pickLeadingService(selected, services, isUtility);
            leadingId = leading.id;
            const following = selected.filter(s => s.id !== leading.id);
            removed = ktvsRemovedByMerge(services, leading.id, following.map(s => s.id));
            services = mergeServicesIntoParent(services, leading.id, following);
        }
        const { itemUpdates, invalid } = saveAndLoad(services);
        const leadingSaved = itemUpdates.find(u => u.id === leadingId)!;
        const followSaved = itemUpdates.filter(u => mergedIntoIdOf(u));
        const minutes = timerMinutes(itemUpdates, c.ktv);
        const end = leadingSaved.segments.find((s: any) => s.ktvId === c.ktv)?.endTime || '';
        table.push({ ca: c.name.slice(0, 58), truoc: leadingId, phut_dong_ho: minutes, ket_thuc: end,
            sau_co_chang: followSaved.some(u => u.segments.length || u.technicianCodes.length) ? 'CÓ ✗' : 'không', loi: invalid || '' });
        check(leadingId === c.expectLeading, `${c.name}: dịch vụ trước = ${c.expectLeading}`, leadingId);
        check(minutes === c.expectMinutes, `${c.name}: đồng hồ KTV ${c.expectMinutes} phút`, String(minutes));
        check(!invalid, `${c.name}: lưu không bị từ chối`, invalid || '');
        check(followSaved.every(u => !u.segments.length && !u.technicianCodes.length), `${c.name}: dịch vụ sau không chặng, không KTV`);
        if (c.expectRemoved) check(JSON.stringify(removed) === JSON.stringify(c.expectRemoved), `${c.name}: KTV bị gỡ`, JSON.stringify(removed));
    }
    console.table(table);
    const night = table.find(t => t.ca.startsWith('Ca đêm'));
    check(night?.ket_thuc === '01:10', 'Ca đêm: giờ kết thúc 01:10 (qua nửa đêm)', night?.ket_thuc);

    console.log('\n=== Đã tách A/B, LƯU THEO THẺ (lần 2 hôm 06/10) ===');
    {
        // Khách A: item1 + item3 (+ Phòng riêng item5) — thẻ chỉ còn item1 sau khi ghép.
        let services = [
            svc('item1', 'Ấn huyệt chân', 60, [row('T007', '21:49', 60)]),
            svc('item3', 'Kết hợp 4 liệu trình', 70),
            svc('item5', 'Phòng riêng', 0, [], { is_utility: true }),
        ];
        services = mergeServicesIntoParent(services, 'item1', [services[1], services[2]]);
        const cardIds = withFollowingServices(['item1'], services);
        check(cardIds.includes('item3') && cardIds.includes('item5'), 'lưu thẻ của item1 tự kèm item3 + item5 (dù chỉ có dấu trong bộ nhớ)', cardIds.join(','));
        // Dấu ghép đã lưu trong DB (options) cũng được nhận ra.
        const saved = [{ id: 'item1' }, { id: 'item3', options: JSON.stringify({ mergedIntoId: 'item1' }) }];
        check(withFollowingServices(['item1'], saved).includes('item3'), 'nhận dấu ghép đã lưu dạng chuỗi JSON');
        check(originalMergedMinutes(services[0], [services[1], services[2]], isUtility) === 130, 'tổng phút gốc để cảnh báo = 130 (Phòng riêng không tính)');
    }

    console.log('\n=== "Hủy gộp" trên form (handleUnmergeSingle) rồi gán KTV cho dịch vụ sau ===');
    {
        // Trạng thái nạp từ DB sau khi đã ghép: dấu ghép ở CẢ tầng trên lẫn options.
        let services = mergeServicesIntoParent(
            [svc('a', 'Ấn huyệt chân', 60, [row('T007', '21:42', 60)]), svc('b', 'Kết hợp 4 liệu trình', 70)], 'a', [svc('b', 'Kết hợp 4 liệu trình', 70)]);
        // Đúng như handleUnmergeSingle: chỉ xoá tầng trên, options.mergedIntoId cũ còn nguyên.
        services = services.map(s => s.id === 'a' ? { ...s, mergedServiceIds: [] } : s.id === 'b' ? { ...s, mergedIntoId: undefined } : s);
        check(mergedIntoIdOf(services[1]) === null, 'sau Hủy gộp, dịch vụ b KHÔNG còn bị coi là đã ghép', String(mergedIntoIdOf(services[1])));
        services = services.map(s => s.id === 'b' ? { ...s, staffList: [row('T010', '21:42', 70)] } : s);
        const { itemUpdates, invalid } = saveAndLoad(services);
        const b = itemUpdates.find(u => u.id === 'b')!;
        check(!invalid && b.segments.length === 1 && b.technicianCodes[0] === 'T010', 'gán T010 cho b rồi lưu: b có chặng 70p riêng', JSON.stringify(b.segments.map((x: any) => x.duration)));
        check(!b.options.mergedIntoId, 'dấu ghép của b được xoá khi lưu');
        const a = itemUpdates.find(u => u.id === 'a')!;
        console.log(`  [GHI CHÚ] Hủy gộp KHÔNG trừ phút: dịch vụ a vẫn ${a.segments[0]?.duration}p (lỗi có từ trước, chưa sửa — quầy phải tự sửa về 60p)`);
    }

    console.log('\n=== Lớp server: payload lỗi cũ (dịch vụ sau mang chặng 0 phút) ===');
    {
        const legacy = [
            { id: 'item1', technicianCodes: ['T007'], segments: [{ ktvId: 'T007', startTime: '21:42', duration: 130 }], options: { displayName: 'Ấn huyệt chân + Kết hợp' } },
            { id: 'item3', technicianCodes: ['T007'], segments: [{ ktvId: 'T007', startTime: '21:42', duration: 0 }], options: { mergedIntoId: 'item1', displayName: 'Kết hợp 4 liệu trình' } },
        ];
        check(!!findInvalidSegment(legacy), 'payload cũ: có chặng 0 phút (đây là thứ RPC từ chối)', findInvalidSegment(legacy) || '');
        const { itemUpdates, stripped } = normalizeFollowingItemUpdates(legacy);
        check(!findInvalidSegment(itemUpdates), 'sau lớp server: không còn chặng sai → lưu được');
        check(stripped.length === 1 && stripped[0].itemId === 'item3', 'ghi nhận đã gỡ T007 khỏi dịch vụ sau', JSON.stringify(stripped));
        const bad = [{ id: 'x', segments: [{ ktvId: 'T007', startTime: '21:42', duration: 700 }], options: { displayName: 'Massage' } }];
        check((findInvalidSegment(bad) || '').includes('"Massage"') && (findInvalidSegment(bad) || '').includes('700'), 'thông báo lỗi nói rõ dịch vụ + số phút', findInvalidSegment(bad) || '');
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG'} — ${failures} loi (TZ=${process.env.TZ || 'local'}) ===`);
    finish(failures);
}

main().catch(fatal);
