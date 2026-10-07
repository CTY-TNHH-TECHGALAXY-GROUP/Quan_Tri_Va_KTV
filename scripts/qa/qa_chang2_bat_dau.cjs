// QA (read-only, mock DB): plans/plan_chang2_phai_bam_bat_dau_20261004.md §5.
// Run: node scripts/qa/qa_chang2_bat_dau.cjs   (also with TZ=UTC)
const assert = require('node:assert/strict');
const { join } = require('node:path');
require('ts-node').register({ project: join(__dirname, 'tsconfig.qa.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: join(__dirname, '..', '..'), paths: { '@/*': ['./*'] } });
const { handleStartTimer } = require('../../app/api/ktv/booking/_handlers/handleStartTimer');

const PROOF = 'data:image/jpeg;base64,/9j/';
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();
const hhmmVN = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(11, 16);
const dayVN = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);

function makeDb(items, { bookingDate } = {}) {
    const state = { items: structuredClone(items), rpcCalls: [] };
    const q = (table) => {
        const qq = {
            select() { return qq; }, eq() { return qq; }, in() { return qq; },
            maybeSingle() { return Promise.resolve({ data: table === 'KtvAssignments' ? { id: 'asg' } : null, error: null }); },
            single() { return Promise.resolve({ data: { id: 'order', status: 'IN_PROGRESS', rating: null, timeStart: iso(Date.now()), bookingDate: bookingDate || dayVN(Date.now()), BookingGuests: [] }, error: null }); },
            then(res, rej) { return Promise.resolve({ data: table === 'BookingItems' ? structuredClone(state.items) : [], error: null }).then(res, rej); },
        };
        return qq;
    };
    state.supabase = {
        from: q,
        async rpc(name, args) {
            state.rpcCalls.push({ name, args });
            for (const u of args.p_updates) {
                const it = state.items.find(i => i.id === u.id);
                it.status = u.status; it.segments = typeof u.segments === 'string' ? u.segments : JSON.stringify(u.segments);
            }
            return { data: { success: true, booking: { id: 'order' } }, error: null };
        },
        storage: { from: () => ({
            async upload(path) { return { data: { path } }; },
            getPublicUrl(path) { return { data: { publicUrl: `https://local.test/${path}` } }; },
            async remove() { return { error: null }; },
        }) },
    };
    state.segs = (itemId) => JSON.parse(state.items.find(i => i.id === itemId).segments);
    return state;
}
const call = (db, ktv, itemIds, action, body) => handleStartTimer({
    supabase: db.supabase, bookingId: 'order', technicianCode: ktv, action, turnForSync: null, allItemIdsForThisKTV: itemIds, body,
});
const errOf = async (r) => r.earlyResponse ? (await r.earlyResponse.json()).error : null;
const seg = (id, ktv, startMs, dur, extra = {}) => ({ id, ktvId: ktv, roomId: extra.roomId || 'R1', startTime: hhmmVN(startMs), plannedStartAt: iso(startMs), duration: dur, ...extra });

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['✅', name]); } catch (e) { results.push(['❌', name + ' — ' + e.message]); } };

(async () => {
    const now = Date.now();

    await test('1. 1KTV-1DV: bat dau binh thuong, can 2 anh', async () => {
        const db = makeDb([{ id: 'i1', guest_id: 'g1', status: 'PREPARING', segments: JSON.stringify([seg('s1', 'K1', now - 2 * MIN, 60)]) }]);
        assert.match(await errOf(await call(db, 'K1', ['i1'], 'START_TIMER', { activeSegmentIndex: 0, startPhotoBase64: PROOF })), /dép/);
        const r = await call(db, 'K1', ['i1'], 'START_TIMER', { activeSegmentIndex: 0, startPhotoBase64: PROOF, guestSlipperPhotoBase64: PROOF });
        assert.equal(await errOf(r), null);
        const s = db.segs('i1')[0];
        assert.ok(s.actualStartTime && s.startPhotoUrl && s.guestSlipperPhotoUrl);
    });

    await test('2. 1KTV-2DV gop (cung phong): 1 lan bam ghi ca 2 chang', async () => {
        const db = makeDb([
            { id: 'i1', guest_id: 'g1', status: 'PREPARING', segments: JSON.stringify([seg('s1', 'K1', now - 2 * MIN, 30)]) },
            { id: 'i2', guest_id: 'g1', status: 'PREPARING', segments: JSON.stringify([seg('s2', 'K1', now + 28 * MIN, 30)]) },
        ]);
        const r = await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 0, shouldMerge: true, startPhotoBase64: PROOF, guestSlipperPhotoBase64: PROOF });
        assert.equal(await errOf(r), null);
        assert.ok(db.segs('i1')[0].isMergedRun && db.segs('i2')[0].isMergedRun);
        assert.equal(db.segs('i1')[0].actualStartTime, db.segs('i2')[0].actualStartTime);
    });

    // 1KTV-2 chang khac phong, cung khach.
    const twoRooms = (s2StartMs) => makeDb([
        { id: 'i1', guest_id: 'g1', status: 'IN_PROGRESS', segments: JSON.stringify([seg('s1', 'K1', now - 60 * MIN, 30, { actualStartTime: iso(now - 60 * MIN), guestSlipperPhotoUrl: 'https://local.test/slipper_1.jpg', startPhotoUrl: 'https://local.test/start_1.jpg' })]) },
        { id: 'i2', guest_id: 'g1', status: 'PREPARING', segments: JSON.stringify([seg('s2', 'K1', s2StartMs, 30, { roomId: 'R2' })]) },
    ]);

    await test('3. Khac phong: NEXT_SEGMENT chi dong chang 1, KHONG ghi gio chang 2', async () => {
        const db = twoRooms(now - 5 * MIN);
        const r = await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 1, targetSegmentId: 's2' });
        assert.equal(await errOf(r), null);
        assert.ok(db.segs('i1')[0].actualEndTime, 'chang 1 phai dong');
        assert.equal(db.segs('i2')[0].actualStartTime, undefined, 'chang 2 chua duoc bat dau');
        assert.equal(db.items.find(i => i.id === 'i1').status, 'CLEANING');
        assert.equal(db.rpcCalls[0].name, 'ktv_finish_service_atomic');
        // KTV bam bat dau chang 2: chi gui anh bat dau, anh dep dung lai
        const t0 = Date.now();
        const r2 = await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF, guestSlipperPhotoBase64: null });
        assert.equal(await errOf(r2), null);
        const s2 = db.segs('i2')[0];
        assert.ok(Date.parse(s2.actualStartTime) >= t0, 'gio ghi = gio bam thuc te');
        assert.equal(s2.guestSlipperPhotoUrl, 'https://local.test/slipper_1.jpg');
        assert.ok(s2.startPhotoUrl && s2.startPhotoUrl !== 'https://local.test/start_1.jpg');
    });

    await test('3b. Gui lai anh dep dang URL (app cu) -> van dung lai anh trong don, khong 400', async () => {
        const db = twoRooms(now - 5 * MIN);
        await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 1, targetSegmentId: 's2' });
        const r = await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF, guestSlipperPhotoBase64: 'https://local.test/slipper_1.jpg' });
        assert.equal(await errOf(r), null);
    });

    await test('4. Khac khach cung don (don cu): phai chup dep moi', async () => {
        const db = twoRooms(now - 5 * MIN);
        db.items[1].guest_id = 'g2';
        await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 1, targetSegmentId: 's2' });
        assert.match(await errOf(await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF })), /dép/);
    });

    await test('5. Bam chang 2 khi chang 1 chua dong -> tu choi', async () => {
        const db = twoRooms(now - 5 * MIN);
        const e = await errOf(await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF }));
        assert.match(e || '', /Chặng trước chưa kết thúc/);
    });

    await test('5b. Chang 1 xong som hon gio gan chang 2 -> khoa toi gio gan', async () => {
        const db = twoRooms(now + 10 * MIN);
        await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 1, targetSegmentId: 's2' });
        const e = await errOf(await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF }));
        assert.match(e || '', /Chưa đến giờ/);
    });

    await test('5c. Chang 1 xong muon hon gio gan -> bam duoc ngay', async () => {
        const db = twoRooms(now - 10 * MIN);
        await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 1, targetSegmentId: 's2' });
        assert.equal(await errOf(await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF })), null);
    });

    await test('6. Bam 2 lan: khong ghi de gio / anh', async () => {
        const db = twoRooms(now - 5 * MIN);
        await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 1, targetSegmentId: 's2' });
        await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF });
        const first = db.segs('i2')[0];
        await new Promise(r => setTimeout(r, 15));
        assert.equal(await errOf(await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF })), null);
        assert.deepEqual(db.segs('i2')[0], first);
        // NEXT_SEGMENT goi lai sau khi chang 1 da dong: khong doi gi
        const before = db.segs('i1')[0].actualEndTime;
        await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 1, targetSegmentId: 's2' });
        assert.equal(db.segs('i1')[0].actualEndTime, before);
    });

    const seqAB = (aSlipper) => makeDb([{ id: 'i1', guest_id: 'g1', status: 'IN_PROGRESS', options: { sequentialSlots: 2 }, segments: JSON.stringify([
        seg('a', 'KA', now - 30 * MIN, 30, { sequenceSlot: 1, actualStartTime: iso(now - 30 * MIN), ...(aSlipper ? { guestSlipperPhotoUrl: 'https://local.test/slipper_A.jpg' } : {}) }),
        seg('b', 'KB', now + 60 * MIN, 30, { sequenceSlot: 2 }),
    ]) }]);

    await test('7. Noi tiep A/B (2KTV-1DV): B chi chup anh bat dau, nhan anh dep cua A', async () => {
        const db = seqAB(true);
        const r = await call(db, 'KB', ['i1'], 'START_TIMER', { activeSegmentIndex: 0, startPhotoBase64: PROOF });
        assert.equal(await errOf(r), null);
        const b = db.segs('i1').find(s => s.id === 'b');
        assert.equal(b.guestSlipperPhotoUrl, 'https://local.test/slipper_A.jpg');
        assert.ok(b.actualStartTime);
        assert.equal(db.segs('i1').find(s => s.id === 'a').actualEndTime, undefined, 'khong dung vao chang cua KTV khac');
    });

    await test('7b. A thieu anh dep (don cu): B phai chup dep', async () => {
        const db = seqAB(false);
        assert.match(await errOf(await call(db, 'KB', ['i1'], 'START_TIMER', { activeSegmentIndex: 0, startPhotoBase64: PROOF })) || '', /dép/);
    });

    await test('8. Ca qua nua dem: chang 1 23:30, chang 2 00:10 (targetSegmentId dung chang)', async () => {
        // Day of the booking = yesterday VN; segment 2 planned after midnight. Shift both so "now" sits at 00:12.
        const mid = (() => { const d = dayVN(now); return Date.parse(`${d}T00:00:00+07:00`); })();
        const shift = now - (mid + 12 * MIN);
        const t = (ms) => ms + shift;
        const db = makeDb([
            { id: 'i1', guest_id: 'g1', status: 'IN_PROGRESS', segments: JSON.stringify([seg('s1', 'K1', t(mid - 30 * MIN), 30, { actualStartTime: iso(t(mid - 30 * MIN)), guestSlipperPhotoUrl: 'https://local.test/s.jpg' })]) },
            { id: 'i2', guest_id: 'g1', status: 'PREPARING', segments: JSON.stringify([seg('s2', 'K1', t(mid + 10 * MIN), 30, { roomId: 'R2' })]) },
        ], { bookingDate: dayVN(t(mid - 30 * MIN)) });
        // Client sorts by "HH:mm" -> 00:10 comes first; with targetSegmentId the server still closes s1.
        assert.equal(await errOf(await call(db, 'K1', ['i1', 'i2'], 'NEXT_SEGMENT', { activeSegmentIndex: 0, targetSegmentId: 's2' })), null);
        assert.ok(db.segs('i1')[0].actualEndTime);
        assert.equal(await errOf(await call(db, 'K1', ['i1', 'i2'], 'START_TIMER', { activeSegmentIndex: 1, targetSegmentId: 's2', startPhotoBase64: PROOF })), null);
        assert.ok(db.segs('i2')[0].actualStartTime);
    });

    await test('9. Schema PATCH nhan null cho anh (app gui null khi dung lai anh dep)', async () => {
        const { KtvBookingPatchSchema } = require('../../lib/schemas/ktv.schema');
        assert.equal(KtvBookingPatchSchema.safeParse({ bookingId: 'o', status: 'IN_PROGRESS', guestSlipperPhotoBase64: null, startPhotoBase64: PROOF }).success, true);
        assert.equal(KtvBookingPatchSchema.safeParse({ bookingId: 'o', status: 'IN_PROGRESS', startPhotoBase64: PROOF }).success, true);
    });

    await test('10. isWaitingForNextSegment: dung cho dong ho dung yen giua 2 chang', async () => {
        const { isWaitingForNextSegment } = require('../../lib/ktvUtils');
        const s1 = { id: 's1', actualStartTime: 'x', actualEndTime: 'y' }, s2 = { id: 's2' };
        assert.equal(isWaitingForNextSegment([s1, s2]), true, 'chang 1 dong, chang 2 chua bam');
        assert.equal(isWaitingForNextSegment([{ id: 's1', actualStartTime: 'x' }, s2]), false, 'chang 1 dang chay');
        assert.equal(isWaitingForNextSegment([s1, { id: 's2', actualStartTime: 'z' }]), false, 'chang 2 dang chay');
        assert.equal(isWaitingForNextSegment([s2]), false, 'chua bat dau chang nao (man nhan don / chuan bi)');
        assert.equal(isWaitingForNextSegment([s1, { id: 's2', actualStartTime: 'z', actualEndTime: 'w' }]), false, 'xong het');
        assert.equal(isWaitingForNextSegment([s1, { ...s2, voided: true }]), false, 'chang con lai bi tuoc');
    });

    await test('11. Kanban: nhan "Cho bat dau chang 2" khi 2 chang cung 1 dich vu', async () => {
        const { waitingSegmentInfo } = require('../../app/reception/dispatch/dispatch-display');
        const t = Date.now();
        const s1 = { id: 's1', startTime: hhmmVN(t - 60 * MIN), actualStartTime: iso(t - 60 * MIN), actualEndTime: iso(t - 15 * MIN) };
        const s2 = { id: 's2', startTime: hhmmVN(t - 20 * MIN), plannedStartAt: iso(t - 20 * MIN) };
        const services = [{ staffList: [{ ktvId: 'K1', segments: [s1, s2] }] }];
        const rowWaiting = [s1, s2].map(g => waitingSegmentInfo(services, 'K1', g, t)).find(Boolean);
        assert.deepEqual(rowWaiting, { index: 1, lateMin: 15 }, 'mo khoa = max(gio gan, chang 1 dong) = 15 phut truoc');
        assert.equal(waitingSegmentInfo(services, 'K1', { ...s2, actualStartTime: iso(t) }, t), null);
    });

    for (const [ok, name] of results) console.log(ok, name);
    console.log(`TZ=${process.env.TZ || 'local'} — ${results.filter(r => r[0] === '✅').length}/${results.length} dat`);
    process.exit(results.some(r => r[0] === '❌') ? 1 : 0);
})();
