/**
 * QA #30 — OFFICE P0.5: dời việc / bàn giao + quá hạn 7 ngày, chạy trên **DB TEST** bằng service THẬT.
 * Plan: plans/plan_office_p0_doi_viec_ban_giao.md (mục 2.1, 2.2, 7).
 *
 * Kiểm:
 *   1. Dời việc lặp cùng người sang mai TRƯỚC khi bản mai được sinh → sinh mai không ra bản thứ 2.
 *   2. Dời SAU khi bản mai đã sinh → cập nhật đúng bản đó (merged).
 *   3. Dời + đổi người (người mới không có việc mẫu) → bản riêng; dời tiếp lần 2 → chuỗi bàn giao đúng.
 *   4. Người nhận nghỉ ngày đích → báo lỗi, không dời.
 *   5. Chặn sai: thiếu ghi chú, ngày quá 7 ngày, ngày không sau ngày việc, việc đã huỷ / đã duyệt.
 *   6. Cổng tan ca: việc gốc đã dời không chặn; việc bàn giao chặn ngày của nó.
 *   7. Màn NV: việc bàn giao mang ghi chú + ngày gốc + lý do vướng.
 *   8. Quá hạn 7 ngày: giám sát thấy; NV không bị chặn; tab Người không đếm việc cũ.
 *
 * AN TOÀN: dừng nếu URL không phải Supabase TEST (eknggruuiuadwldacpmb). Dữ liệu tiền tố QA30-, xoá khi xong.
 * Chạy: npm run test:office-defer
 */
import * as fs from 'fs';
import * as path from 'path';
import Module from 'module';
import { finish, fatal } from './_exit';

const TEST_REF = 'eknggruuiuadwldacpmb';
const envFile = path.join(__dirname, '../../.env.local');
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
}
if (!String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes(TEST_REF)) throw new Error('DỪNG: không phải DB TEST');

const STUBS: Record<string, any> = { 'server-only': {} };
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
    return STUBS[request] ?? originalLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseAdmin } = require('@/lib/supabaseAdmin');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const svc = require('@/lib/services/employeeTasks.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getVnDateStr } = require('@/lib/time.logic');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const act = require('@/lib/services/officeTaskActions.service');

const sb = getSupabaseAdmin();
const P = 'QA30-';
const STAFF_A = 'QA931';
const STAFF_B = 'QA932';
const STAFFS = [STAFF_A, STAFF_B];
const WT = 'QA30_OFFICE';
const CFG_KEY = `block_checkout_incomplete_tasks_${WT}`;
const ACTOR = 'QA30';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}
const must = async (p: PromiseLike<{ data: any; error: any }>, what: string) => {
    const { data, error } = await p;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
};
const expectErr = async (fn: () => Promise<any>, status: number, label: string) => {
    try { await fn(); check(false, label, 'không báo lỗi'); }
    catch (e: any) { check(e?.status === status, label, `${e?.status} ${e?.message}`); }
};

const today = getVnDateStr();
const day = (n: number) => svc.shiftVnDate(today, n);
const fresh = async (id: string) => must(sb.from('Tasks').select('*').eq('id', id).single(), 'reload');
const tasksOf = async (staffId: string, date: string, templateId: string) =>
    must(sb.from('Tasks').select('*').eq('assignee_id', staffId).eq('task_date', date).eq('template_id', templateId), 'tasks of');
const eventsOf = async (taskId: string, type: string) =>
    must(sb.from('TaskEvents').select('payload').eq('task_id', taskId).eq('type', type), 'events');

async function cleanup() {
    const { data: tasks } = await sb.from('Tasks').select('id').in('assignee_id', STAFFS);
    const ids = (tasks || []).map((t: any) => t.id);
    if (ids.length) {
        await sb.from('TaskEvents').delete().in('task_id', ids);
        await sb.from('TaskNotifications').delete().in('task_id', ids);
        await sb.from('Tasks').delete().in('id', ids);
    }
    await sb.from('TaskEvents').delete().eq('actor_id', ACTOR);
    await sb.from('TaskNotifications').delete().in('employee_id', STAFFS);
    await sb.from('KTVLeaveRequests').delete().in('employeeId', STAFFS);
    await sb.from('CheckoutOverrides').delete().in('staff_id', STAFFS);
    await sb.from('EmployeeRoutines').delete().in('employee_id', STAFFS);
    const { data: cats } = await sb.from('TaskCategories').select('id').like('name', `${P}%`);
    if (cats?.length) {
        await sb.from('TaskTemplates').delete().in('category_id', cats.map((c: any) => c.id));
        await sb.from('TaskCategories').delete().in('id', cats.map((c: any) => c.id));
    }
    await sb.from('SystemConfigs').delete().eq('key', CFG_KEY);
    await sb.from('Users').delete().in('id', STAFFS);
    await sb.from('Staff').delete().in('id', STAFFS);
}

async function main() {
    console.log(`=== QA30 Office dời việc — TEST DB — today(VN)=${today} TZ=${process.env.TZ || '(local)'} ===`);
    await cleanup();

    // ---------- Fixture ----------
    await must(sb.from('Users').insert(STAFFS.map(id => ({
        id, code: id, username: `qa30_${id.toLowerCase()}`, password: require('crypto').randomUUID(), fullName: `${P}${id}`, role: 'TECHNICIAN',
    }))).select(), 'users');
    await must(sb.from('Staff').insert(STAFFS.map(id => ({ id, full_name: `${P}${id}`, status: 'ĐANG LÀM', work_type: 'TYPE_A' }))).select(), 'staff');
    await must(sb.from('SystemConfigs').insert({ key: CFG_KEY, value: true }).select(), 'cfg');
    const [cat] = await must(sb.from('TaskCategories').insert({ name: `${P}Quầy ngày`, type: 'ROLE', repeat_mode: 'DAILY' }).select(), 'cat');
    const tpl = async (name: string) => (await must(sb.from('TaskTemplates').insert({
        name: `${P}${name}`, category_id: cat.id, is_active: true, requires_photo: true, min_photo_count: 1,
        photo_slots: [{ label: 'Sau khi làm' }], time_mode: 'FREE', blocks_checkout: true, requires_review: true, allow_carry_over: false,
    }).select(), `tpl ${name}`))[0];
    const T1 = await tpl('Thay khăn');
    const T2 = await tpl('Châm nước rửa tay');
    const T3 = await tpl('Tưới cây');
    const T4 = await tpl('Thay thảm');
    await must(sb.from('EmployeeRoutines').insert([T1, T2, T3, T4].map(t => ({ employee_id: STAFF_A, template_id: t.id, mode: 'ADD', is_active: true }))).select(), 'routines');

    await svc.EmployeeTasksService.ensureTasksForDate(STAFF_A, today, false);
    const [t1] = await tasksOf(STAFF_A, today, T1.id);
    const [t2] = await tasksOf(STAFF_A, today, T2.id);
    check(!!t1 && !!t2, 'fixture: việc hôm nay đã sinh');

    // ---------- 1. Dời trước khi bản mai sinh ----------
    console.log('\n[1] Vướng → dời sang mai, cùng người, bản mai CHƯA sinh');
    await act.blockTask(sb, t1.id, ACTOR, 'NO_SUPPLY', 'Hết khăn');
    const r1 = await act.deferTask(sb, t1.id, { toDate: day(1), note: 'Kho giao khăn sáng mai — làm đầu ca' }, ACTOR);
    check(!r1.merged, 'tạo trước bản ngày mai (không có sẵn để gộp)');
    await svc.EmployeeTasksService.ensureTasksForDate(STAFF_A, day(1), false);
    await svc.EmployeeTasksService.ensureTasksForDate(STAFF_A, day(1), false);
    const t1Tomorrow = await tasksOf(STAFF_A, day(1), T1.id);
    check(t1Tomorrow.length === 1 && t1Tomorrow[0].id === r1.targetId, 'sinh việc ngày mai 2 lần → vẫn đúng 1 bản (chính bản bàn giao)', `${t1Tomorrow.length} bản`);
    const tgt1 = await fresh(r1.targetId);
    check(tgt1.priority === 'HIGH' && tgt1.time_mode === 'DEADLINE' && Date.parse(tgt1.due_at) === Date.parse(`${day(1)}T09:00:00+07:00`),
        'bản bàn giao: ưu tiên cao, nhắc hạn 09:00 giờ VN', `${tgt1.priority} ${tgt1.time_mode} ${tgt1.due_at}`);
    check(tgt1.blocks_checkout === true && tgt1.status === 'NOT_STARTED' && tgt1.acceptance_status === 'AUTO', 'bản bàn giao chặn tan ca ngày đó, bắt đầu từ đầu, không cần bấm nhận');
    const orig1 = await fresh(t1.id);
    check(!!orig1.cancelled_at && String(orig1.cancel_reason).startsWith('Dời sang'), 'việc gốc huỷ mềm "Dời sang dd/mm"', orig1.cancel_reason);
    const ho1 = await eventsOf(r1.targetId, 'HANDOVER');
    check(ho1.length === 1 && ho1[0].payload.from_date === today && String(ho1[0].payload.blocked_reason).startsWith('NO_SUPPLY'),
        'nhật ký HANDOVER: ngày gốc + lý do vướng');
    check((await eventsOf(t1.id, 'DEFERRED')).length === 1, 'nhật ký DEFERRED trên việc gốc');
    const notes = await must(sb.from('TaskNotifications').select('message').eq('task_id', r1.targetId), 'notif');
    check(notes.length === 1, 'người nhận có thông báo bàn giao', notes[0]?.message);

    // ---------- 2. Dời sau khi bản mai đã sinh ----------
    console.log('\n[2] Dời khi bản mai ĐÃ sinh → gộp vào bản đó');
    const [t2Tomorrow] = await tasksOf(STAFF_A, day(1), T2.id);
    const r2 = await act.deferTask(sb, t2.id, { toDate: day(1), note: 'Chưa có nước rửa tay' }, ACTOR);
    check(r2.merged && r2.targetId === t2Tomorrow.id, 'gộp vào đúng bản ngày mai, không tạo thêm');
    check((await tasksOf(STAFF_A, day(1), T2.id)).length === 1, 'ngày mai vẫn 1 bản');

    // ---------- 3. Đổi người + dời lần 2 ----------
    console.log('\n[3] Dời + đổi người, rồi dời tiếp');
    const [t3] = await tasksOf(STAFF_A, today, T3.id);
    const r3 = await act.deferTask(sb, t3.id, { toDate: day(2), assigneeId: STAFF_B, note: 'Bạn B làm thay', dueTime: '10:30' }, ACTOR);
    const tgt3 = await fresh(r3.targetId);
    check(tgt3.assignee_id === STAFF_B && tgt3.dedupe_key === `D|${t3.id}` && tgt3.task_date === day(2), 'bản riêng cho B, khoá D|<việc gốc>');
    check(Date.parse(tgt3.due_at) === Date.parse(`${day(2)}T10:30:00+07:00`), 'giờ nhắc theo giám sát chọn (10:30)');
    const r3b = await act.deferTask(sb, r3.targetId, { toDate: day(3), note: 'Dời tiếp' }, ACTOR);
    const ho3b = await eventsOf(r3b.targetId, 'HANDOVER');
    check(ho3b[0]?.payload.from_task_id === r3.targetId && ho3b[0]?.payload.from_date === day(2), 'dời lần 2: chuỗi bàn giao trỏ đúng bản trước');
    await expectErr(() => act.deferTask(sb, r3.targetId, { toDate: day(4), note: 'x' }, ACTOR), 409, 'dời lại bản đã dời → báo đã huỷ/đã dời');

    // ---------- 4. Người nhận nghỉ ----------
    console.log('\n[4] Người nhận nghỉ ngày đích');
    await must(sb.from('KTVLeaveRequests').insert({ employeeId: STAFF_B, employeeName: `${P}B`, date: day(4), status: 'APPROVED', reason: 'QA30' }).select(), 'leave');
    await expectErr(() => act.deferTask(sb, r3b.targetId, { toDate: day(4), assigneeId: STAFF_B, note: 'x' }, ACTOR), 409, 'B nghỉ ngày đó → chặn, yêu cầu chọn người khác');
    check(!(await fresh(r3b.targetId)).cancelled_at, 'việc không bị huỷ khi dời thất bại');

    // ---------- 5. Chặn đầu vào sai ----------
    console.log('\n[5] Đầu vào sai');
    await expectErr(() => act.deferTask(sb, r3b.targetId, { toDate: day(4), note: '  ' }, ACTOR), 400, 'thiếu ghi chú bàn giao');
    await expectErr(() => act.deferTask(sb, r3b.targetId, { toDate: day(9), note: 'x' }, ACTOR), 400, 'quá 7 ngày');
    await expectErr(() => act.deferTask(sb, r3b.targetId, { toDate: day(3), note: 'x' }, ACTOR), 400, 'ngày không sau ngày của việc');
    await expectErr(() => act.deferTask(sb, r3b.targetId, { toDate: day(4), note: 'x', dueTime: '25:00' }, ACTOR), 400, 'giờ nhắc sai định dạng');
    const [done] = await must(sb.from('Tasks').insert({ name: `${P}Đã duyệt`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: today,
        status: 'COMPLETED', inspection_status: 'PASSED', min_photo_count: 0 }).select(), 'done');
    await expectErr(() => act.deferTask(sb, done.id, { toDate: day(1), note: 'x' }, ACTOR), 409, 'việc đã duyệt → không dời');

    // ---------- 6. Cổng tan ca ----------
    console.log('\n[6] Cổng tan ca');
    const gate = await svc.getCheckoutBlockers(sb, STAFF_A, WT, { ensure: false });
    check(!gate.items.some((x: any) => [t1.id, t2.id, t3.id].includes(x.id)), 'việc đã dời không chặn tan ca hôm nay', `${gate.count} việc chặn`);

    // ---------- 7. Màn NV nhận bàn giao (việc hôm qua dời sang hôm nay) ----------
    console.log('\n[7] Màn nhân viên');
    const [old] = await must(sb.from('Tasks').insert({ name: `${P}Thay thảm`, template_id: T4.id, category_id: cat.id, task_type: 'FIXED', assignee_id: STAFF_A,
        task_date: day(-1), status: 'PAUSED', blocked_reason: 'NO_SUPPLY: Hết khăn', inspection_status: 'NOT_REVIEWED', min_photo_count: 1,
        photo_slots: [{ label: 'Sau khi làm' }], blocks_checkout: true, allow_carry_over: false,
        dedupe_key: `F|${STAFF_A}|${T4.id}||${day(-1)}|` }).select(), 'old');
    const r7 = await act.deferTask(sb, old.id, { toDate: today, note: 'Làm ngay đầu ca' }, ACTOR);
    check(r7.merged, 'việc hôm qua dời sang hôm nay → gộp vào bản hôm nay');
    // Today's T1 copy was itself deferred in [1] (cancelled) → a T1 task from yesterday must get its own row.
    const [oldT1] = await must(sb.from('Tasks').insert({ name: `${P}Thay khăn`, template_id: T1.id, category_id: cat.id, task_type: 'FIXED', assignee_id: STAFF_A,
        task_date: day(-1), status: 'NOT_STARTED', inspection_status: 'NOT_REVIEWED', min_photo_count: 1, blocks_checkout: true,
        dedupe_key: `F|${STAFF_A}|${T1.id}||${day(-1)}|` }).select(), 'old t1');
    const r7b = await act.deferTask(sb, oldT1.id, { toDate: today, note: 'x' }, ACTOR);
    check(!r7b.merged && (await fresh(r7b.targetId)).dedupe_key === `D|${oldT1.id}` && !!(await fresh(t1.id)).cancelled_at,
        'bản ngày đích đã đóng → tạo bản riêng, không hồi sinh bản đã huỷ');
    const view = await svc.EmployeeTasksService.fetchTasks([STAFF_A]);
    const card = view.data.find((x: any) => x.id === r7.targetId);
    check(card?.handover?.fromDate === day(-1) && card?.handover?.note === 'Làm ngay đầu ca' && String(card?.handover?.blockedReason).startsWith('NO_SUPPLY'),
        'NV thấy: dời từ hôm qua + ghi chú + lý do vướng cũ');
    check(!view.data.some((x: any) => x.id === old.id), 'bản gốc không còn trên màn NV');
    const gate7 = await svc.getCheckoutBlockers(sb, STAFF_A, WT, { ensure: false });
    check(gate7.items.some((x: any) => x.id === r7.targetId), 'việc bàn giao chặn tan ca ngày của nó tới khi duyệt');

    // ---------- 8. Quá hạn 7 ngày ----------
    console.log('\n[8] Quá hạn');
    const [late] = await must(sb.from('Tasks').insert({ name: `${P}Quá hạn 3 ngày`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: day(-3),
        status: 'NOT_STARTED', inspection_status: 'NOT_REVIEWED', min_photo_count: 1, blocks_checkout: true, allow_carry_over: true }).select(), 'late');
    const [lateWait] = await must(sb.from('Tasks').insert({ name: `${P}Chờ duyệt 3 ngày`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: day(-3),
        status: 'COMPLETED', inspection_status: 'PENDING_REVIEW', min_photo_count: 0, blocks_checkout: true }).select(), 'late wait');
    const [tooOld] = await must(sb.from('Tasks').insert({ name: `${P}Quá 8 ngày`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: day(-8),
        status: 'NOT_STARTED', inspection_status: 'NOT_REVIEWED', min_photo_count: 1, blocks_checkout: true }).select(), 'too old');
    const q = await act.getReviewQueue(sb);
    check(q.overdue.some((x: any) => x.id === late.id), 'giám sát thấy việc quá hạn 3 ngày (tab Quá hạn)');
    check(q.waiting.some((x: any) => x.id === lateWait.id), 'việc chờ duyệt từ 3 ngày trước vẫn trong hàng chờ duyệt');
    check(!q.overdue.some((x: any) => x.id === tooOld.id), 'quá 7 ngày → không còn trong danh sách');
    check(!q.overdue.some((x: any) => [t1.id, t2.id, old.id].includes(x.id)), 'việc đã dời không nằm trong quá hạn');
    const gate8 = await svc.getCheckoutBlockers(sb, STAFF_A, WT, { ensure: false });
    check(!gate8.items.some((x: any) => [late.id, lateWait.id].includes(x.id)), 'NV không bị chặn tan ca vì việc 3 ngày trước');
    const personA = q.people.find((p: any) => p.staffId === STAFF_A);
    check(!!personA && personA.total === view.data.length, 'tab Người chỉ đếm hôm nay + tồn hôm qua', `${personA?.total} vs ${view.data.length}`);
    const r8 = await act.deferTask(sb, late.id, { toDate: today, note: 'Làm bù hôm nay' }, ACTOR);
    check((await fresh(r8.targetId)).task_date === today, 'việc quá hạn dời sang hôm nay được');
}

main()
    .catch(e => { failures++; fatal(e); })
    .finally(async () => {
        try { await cleanup(); console.log('\n(đã dọn dữ liệu QA30-)'); } catch (e) { console.error('cleanup lỗi', e); }
        console.log(failures === 0 ? '\n=== DAT ===' : `\n=== KHONG DAT: ${failures} loi ===`);
        finish(failures);
    });
