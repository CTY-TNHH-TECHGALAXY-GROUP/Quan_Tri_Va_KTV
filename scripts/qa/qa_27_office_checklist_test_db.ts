/**
 * QA #27 — OFFICE P0: sinh việc checklist + cổng chặn tan ca, chạy trên **DB TEST** bằng service THẬT.
 * Plan: plans/plan_office_p0_nen_tang_checklist.md (mục 3, 11).
 *
 * Kiểm:
 *   - Template vị trí ∪ routine ADD − routine EXCLUDE; lặp tuần đúng thứ; MULTI tách mốc; snapshot ô ảnh.
 *   - Gọi ensureTasksForDate song song 5 lần → không sinh trùng (Tasks.dedupe_key).
 *   - Chính sách nhận việc theo vị trí: MANDATORY → AUTO, ACCEPT_OR_DECLINE → PENDING.
 *   - deriveTaskState cho mọi trạng thái.
 *   - getCheckoutBlockers: cờ tắt, việc không chặn, đã duyệt, huỷ mềm, việc tồn hôm qua (có/không cho tồn),
 *     cho tan ca (override), ensure:false không sinh việc, fail-open khi lỗi.
 *
 * AN TOÀN: dừng nếu URL không phải Supabase TEST (eknggruuiuadwldacpmb). Dữ liệu tiền tố QA27-, xoá khi xong.
 * Chạy (trong worktree office-p0-v1, thêm TZ=UTC để giả lập server):
 *   TZ=UTC npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_27_office_checklist_test_db.ts
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

// Same approach as qa_23: stub Next-only modules, keep the service logic untouched.
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
const P = 'QA27-';
const STAFF_A = 'QA901';     // vị trí bắt buộc (như NH001)
const STAFF_B = 'QA902';     // vị trí được nhận / từ chối
const STAFF_C = 'QA903';     // chỉ có routine cá nhân — dùng cho ensure:false
const WT = 'QA27_OFFICE';    // workTypeKey giả để bật cờ chặn riêng cho QA
const CFG_KEY = `block_checkout_incomplete_tasks_${WT}`;
const ACTOR = 'QA27';        // actor_id of every action in this run (cleanup key for TaskEvents)

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

const today = getVnDateStr();
const yesterday = svc.shiftVnDate(today, -1);
const vnDow = new Date(`${today}T00:00:00Z`).getUTCDay();
const notToday = String((vnDow + 3) % 7);

async function cleanup() {
    const { data: tasks } = await sb.from('Tasks').select('id').in('assignee_id', [STAFF_A, STAFF_B, STAFF_C]);
    const ids = (tasks || []).map((t: any) => t.id);
    if (ids.length) await sb.from('Tasks').delete().in('id', ids);
    await sb.from('CheckoutOverrides').delete().in('staff_id', [STAFF_A, STAFF_B, STAFF_C]);
    await sb.from('EmployeeRoutines').delete().in('employee_id', [STAFF_A, STAFF_B, STAFF_C]);
    const { data: pos } = await sb.from('OfficePositions').select('id').like('name', `${P}%`);
    if (pos?.length) await sb.from('OfficePositions').delete().in('id', pos.map((p: any) => p.id));
    await sb.from('OfficeTemplateSets').delete().like('name', `${P}%`);
    const { data: cats } = await sb.from('TaskCategories').select('id').like('name', `${P}%`);
    if (cats?.length) {
        await sb.from('TaskTemplates').delete().in('category_id', cats.map((c: any) => c.id));
        await sb.from('TaskCategories').delete().in('id', cats.map((c: any) => c.id));
    }
    await sb.from('SystemConfigs').delete().eq('key', CFG_KEY);
    await sb.from('TaskEvents').delete().eq('actor_id', ACTOR);
    await sb.from('Users').delete().in('id', [STAFF_A, STAFF_B, STAFF_C]);
    await sb.from('Staff').delete().in('id', [STAFF_A, STAFF_B, STAFF_C]);
}

async function main() {
    console.log(`=== QA27 Office P0 — TEST DB — today(VN)=${today} TZ=${process.env.TZ || '(local)'} ===`);
    await cleanup();

    // ---------- Fixture ----------
    // EmployeeRoutines.employee_id → Users(id): temporary QA accounts with a random, never-used password.
    await must(sb.from('Users').insert([STAFF_A, STAFF_B, STAFF_C].map(id => ({
        id, code: id, username: `qa27_${id.toLowerCase()}`, password: require('crypto').randomUUID(), fullName: `${P}${id}`, role: 'TECHNICIAN',
    }))).select(), 'users');
    // Tasks.assignee_id → Staff(id) (FK still live on TEST and production, 08/10/2026).
    await must(sb.from('Staff').insert([STAFF_A, STAFF_B, STAFF_C].map(id => ({
        id, full_name: `${P}${id}`, status: 'ĐANG LÀM', work_type: 'TYPE_A',
    }))).select(), 'staff');
    const [catDaily] = await must(sb.from('TaskCategories').insert({ name: `${P}Quầy ngày`, type: 'ROLE', repeat_mode: 'DAILY' }).select(), 'cat daily');
    const [catWeekly] = await must(sb.from('TaskCategories').insert({ name: `${P}Quầy tuần`, type: 'ROLE', repeat_mode: 'WEEKLY' }).select(), 'cat weekly');
    const [catPersonal] = await must(sb.from('TaskCategories').insert({ name: `${P}Riêng`, type: 'ROLE', repeat_mode: 'DAILY' }).select(), 'cat personal');

    const tpl = async (row: any) => (await must(sb.from('TaskTemplates').insert(row).select(), `tpl ${row.name}`))[0];
    const T1 = await tpl({ category_id: catDaily.id, name: `${P}Set up máy sấy`, photo_slots: [{ label: 'Phòng gội' }, { label: 'Sảnh' }], standard_text: 'Treo đúng móc', sort_order: 1 });
    const T2 = await tpl({ category_id: catDaily.id, name: `${P}Thay khăn lau tay`, time_mode: 'MULTI', multi_times: ['09:00', '13:00', '17:00'], sort_order: 2 });
    const T3 = await tpl({ category_id: catDaily.id, name: `${P}Tưới cây`, blocks_checkout: false, sort_order: 3 });
    const T4 = await tpl({ category_id: catWeekly.id, name: `${P}Thay dép (không phải hôm nay)`, cron_schedule: notToday });
    const T5 = await tpl({ category_id: catPersonal.id, name: `${P}Việc riêng của A` });
    const T6 = await tpl({ category_id: catDaily.id, name: `${P}Sạc máy tab (A loại ra)`, sort_order: 4 });
    const T7 = await tpl({ category_id: catDaily.id, name: `${P}Mở đèn bảng hiệu`, time_mode: 'DEADLINE', due_time: '17:15', sort_order: 5 });

    const [setDay] = await must(sb.from('OfficeTemplateSets').insert({ name: `${P}Quầy hỗ trợ — Ngày` }).select(), 'set day');
    const [setWeek] = await must(sb.from('OfficeTemplateSets').insert({ name: `${P}Quầy hỗ trợ — Tuần` }).select(), 'set week');
    await must(sb.from('OfficeTemplateSetCategories').insert([
        { set_id: setDay.id, category_id: catDaily.id }, { set_id: setWeek.id, category_id: catWeekly.id },
    ]).select(), 'set cats');

    const [posA] = await must(sb.from('OfficePositions').insert({ name: `${P}Quầy sáng`, fixed_accept_policy: 'MANDATORY', adhoc_accept_policy: 'MANDATORY' }).select(), 'pos A');
    const [posB] = await must(sb.from('OfficePositions').insert({ name: `${P}Hậu cần`, fixed_accept_policy: 'ACCEPT_OR_DECLINE', adhoc_accept_policy: 'ACCEPT_REQUIRED' }).select(), 'pos B');
    await must(sb.from('OfficePositionTemplateSets').insert([
        { position_id: posA.id, set_id: setDay.id }, { position_id: posA.id, set_id: setWeek.id },
        { position_id: posB.id, set_id: setDay.id },
    ]).select(), 'pos sets');
    await must(sb.from('OfficePositionMembers').insert([
        { position_id: posA.id, staff_id: STAFF_A }, { position_id: posB.id, staff_id: STAFF_B },
    ]).select(), 'members');
    await must(sb.from('EmployeeRoutines').insert([
        { employee_id: STAFF_A, template_id: T5.id, mode: 'ADD' },
        { employee_id: STAFF_A, template_id: T6.id, mode: 'EXCLUDE' },
        { employee_id: STAFF_C, template_id: T5.id, mode: 'ADD' },
    ]).select(), 'routines');
    await must(sb.from('SystemConfigs').insert({ key: CFG_KEY, value: true }).select(), 'config');

    // ---------- 1. Effective routines ----------
    console.log('\n[1] Template ∪ ADD − EXCLUDE');
    const eff = await svc.EmployeeTasksService.resolveEffectiveRoutines(sb, STAFF_A);
    const effNames = eff.map((r: any) => r.tpl.name).sort();
    check(effNames.includes(T5.name), 'routine ADD được cộng vào');
    check(!effNames.includes(T6.name), 'routine EXCLUDE bị loại khỏi template');
    check(effNames.includes(T4.name), 'việc tuần có trong danh sách hiệu lực (lọc ngày ở bước sinh)');

    // ---------- 2. Sinh việc song song ----------
    console.log('\n[2] ensureTasksForDate x5 song song');
    await Promise.all(Array.from({ length: 5 }, () => svc.EmployeeTasksService.ensureTasksForDate(STAFF_A, today, false)));
    const tasksA = await must(sb.from('Tasks').select('*').eq('assignee_id', STAFF_A).eq('task_date', today), 'tasks A');
    // T1 + T2×3 + T3 + T5 + T7 = 7 (T4 sai thứ, T6 bị loại)
    check(tasksA.length === 7, 'không sinh trùng, đúng số việc', `có ${tasksA.length}, cần 7`);
    const byName = (n: string) => tasksA.filter((t: any) => t.name.startsWith(n));
    check(byName(T2.name).length === 3 && byName(T2.name).every((t: any) => t.slot_time), 'MULTI tách 3 mốc có slot_time');
    const t1 = byName(T1.name)[0];
    check(t1?.min_photo_count === 2 && Array.isArray(t1?.photo_slots) && t1.photo_slots[1].label === 'Sảnh', 'snapshot ô ảnh có nhãn, min_photo_count = số ô');
    check(t1?.standard_text === 'Treo đúng móc', 'snapshot tiêu chuẩn đạt');
    check(tasksA.every((t: any) => t.acceptance_status === 'AUTO'), 'vị trí MANDATORY → AUTO (không có nút từ chối)');
    check(byName(T4.name).length === 0, 'việc tuần sai thứ không sinh');
    const t7 = byName(T7.name)[0];
    check(t7?.due_at === new Date(`${today}T17:15:00+07:00`).toISOString() || new Date(t7?.due_at).toISOString() === new Date(`${today}T17:15:00+07:00`).toISOString(),
        'DEADLINE 17:15 giờ VN lưu đúng instant', String(t7?.due_at));
    check(tasksA.every((t: any) => t.dedupe_key?.startsWith(`F|${STAFF_A}|`)), 'mọi việc cố định có dedupe_key');

    // ---------- 3. Chính sách nhận việc ----------
    console.log('\n[3] Vị trí ACCEPT_OR_DECLINE');
    await svc.EmployeeTasksService.ensureTasksForDate(STAFF_B, today, false);
    const tasksB = await must(sb.from('Tasks').select('acceptance_status').eq('assignee_id', STAFF_B).eq('task_date', today), 'tasks B');
    check(tasksB.length > 0 && tasksB.every((t: any) => t.acceptance_status === 'PENDING'), 'việc cố định chờ Nhận/Từ chối', `${tasksB.length} việc`);

    // ---------- 4. deriveTaskState ----------
    console.log('\n[4] deriveTaskState');
    const S = (o: any, d = 0) => svc.deriveTaskState({ status: 'NOT_STARTED', inspection_status: 'NOT_REVIEWED', ...o }, d);
    check(S({}) === 'TODO', 'TODO');
    check(S({}, 1) === 'DOING', 'DOING khi đã có ảnh');
    check(S({ status: 'COMPLETED', inspection_status: 'PENDING_REVIEW' }) === 'WAITING', 'WAITING');
    check(S({ status: 'IN_PROGRESS', inspection_status: 'REWORK_REQUIRED' }) === 'FIX', 'FIX');
    check(S({ inspection_status: 'PASSED' }) === 'APPROVED', 'APPROVED');
    check(S({ status: 'COMPLETED', requires_review: false }) === 'APPROVED', 'không cần duyệt → APPROVED khi xong');
    check(S({ status: 'PAUSED' }) === 'BLOCKED', 'PAUSED = báo vướng');
    check(S({ acceptance_status: 'PENDING' }) === 'OFFERED', 'OFFERED');
    check(S({ acceptance_status: 'DECLINED' }) === 'DECLINED', 'DECLINED');
    check(S({ cancelled_at: new Date().toISOString(), inspection_status: 'PASSED' }) === 'CANCELLED', 'huỷ mềm thắng mọi trạng thái');

    // ---------- 5. Cổng chặn tan ca ----------
    console.log('\n[5] getCheckoutBlockers');
    let b = await svc.getCheckoutBlockers(sb, STAFF_A, WT);
    check(b.enabled && b.count === 6, 'chặn 6 việc (việc tưới cây không chặn)', `count=${b.count}`);

    await sb.from('Tasks').update({ inspection_status: 'PASSED', status: 'COMPLETED' }).eq('id', t1.id);
    await sb.from('Tasks').update({ cancelled_at: new Date().toISOString(), cancel_reason: 'QA' }).eq('id', t7.id);
    b = await svc.getCheckoutBlockers(sb, STAFF_A, WT);
    check(b.count === 4, 'đã duyệt và huỷ mềm không còn chặn', `count=${b.count}`);

    await must(sb.from('Tasks').insert([
        { name: `${P}Tồn hôm qua (cho tồn)`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: yesterday, allow_carry_over: true },
        { name: `${P}Tồn hôm qua (không cho tồn)`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: yesterday, allow_carry_over: false },
        { name: `${P}Hôm kia`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: svc.shiftVnDate(today, -2), allow_carry_over: true },
    ]).select(), 'carry');
    b = await svc.getCheckoutBlockers(sb, STAFF_A, WT);
    check(b.count === 5 && b.items.filter((i: any) => i.carry).length === 1, 'chỉ việc tồn hôm qua có cho tồn mới chặn', `count=${b.count}`);

    const fetched = await svc.EmployeeTasksService.fetchTasks([STAFF_A]);
    check(fetched.data.filter((t: any) => t.isCarryOver).length === 1, 'màn nhân viên hiện đúng 1 việc tồn');
    check(fetched.data.find((t: any) => t.id === t1.id)?.state === 'APPROVED', 'fetchTasks trả state từ cùng 1 hàm');

    await must(sb.from('CheckoutOverrides').insert({ staff_id: STAFF_A, business_date: today, reason: 'QA cho tan ca', granted_by: 'QA' }).select(), 'override');
    b = await svc.getCheckoutBlockers(sb, STAFF_A, WT);
    check(b.count === 0 && b.override?.reason === 'QA cho tan ca', 'giám sát cho tan ca → không chặn');

    b = await svc.getCheckoutBlockers(sb, STAFF_A, 'QA27_NO_CONFIG');
    check(!b.enabled && b.count === 0, 'cờ chặn tắt → không chặn');

    b = await svc.getCheckoutBlockers(sb, STAFF_C, WT, { ensure: false });
    const cTasks = await must(sb.from('Tasks').select('id').eq('assignee_id', STAFF_C), 'tasks C');
    check(cTasks.length === 0 && b.count === 0, 'ensure:false (màn trạng thái) không sinh việc');
    b = await svc.getCheckoutBlockers(sb, STAFF_C, WT);
    check(b.count === 1, 'bấm tan ca thật → sinh việc rồi chặn (không mở trang vẫn bị chặn)', `count=${b.count}`);

    const broken = { from: () => { throw new Error('QA: DB down'); } };
    b = await svc.getCheckoutBlockers(broken, STAFF_A, WT);
    check(b.count === 0 && b.error === true, 'lỗi DB → fail-open, không chặn nhầm');

    // ---------- 6. Ngày VN ----------
    console.log('\n[6] Ngày nghiệp vụ VN');
    check(svc.shiftVnDate('2026-03-01', -1) === '2026-02-28', 'shiftVnDate qua đầu tháng');
    check(tasksA.every((t: any) => t.task_date === today), 'task_date = ngày VN kể cả khi TZ=UTC');

    // ---------- 7. Thao tác bước 3 ----------
    console.log('\n[7] Thao tác: nhận/từ chối, nộp theo ô, trả lại theo ô, số liệu, vướng, khung giờ, huỷ, cho tan ca');
    const expectErr = async (fn: () => Promise<any>, status: number, label: string) => {
        try { await fn(); check(false, label, 'không báo lỗi'); }
        catch (e: any) { check(e?.status === status, label, `${e?.status} ${e?.message}`); }
    };
    const fresh = async (id: string) => (await must(sb.from('Tasks').select('*').eq('id', id).single(), 'reload'));
    const addPhoto = async (taskId: string, slot: number | null) =>
        (await must(sb.from('TaskPhotos').insert({ task_id: taskId, uploaded_by: STAFF_A, storage_path: `qa27/${taskId}/${Date.now()}_${slot}.jpg`, is_submitted: true, slot_index: slot }).select('id').single(), 'photo')).id;

    // Chính sách nhận việc
    await expectErr(() => act.declineTask(sb, tasksA[0].id, ACTOR, 'bận'), 409, 'MANDATORY: việc AUTO không có bước từ chối');
    const bTask = (await must(sb.from('Tasks').select('id').eq('assignee_id', STAFF_B).eq('task_date', today).limit(2), 'b'));
    await expectErr(() => act.declineTask(sb, bTask[0].id, ACTOR, ''), 400, 'từ chối bắt buộc có lý do');
    await act.declineTask(sb, bTask[0].id, ACTOR, 'Đang trực quầy');
    check(svc.deriveTaskState(await fresh(bTask[0].id)) === 'DECLINED', 'ACCEPT_OR_DECLINE: từ chối được → DECLINED');
    await act.acceptTask(sb, bTask[1].id, ACTOR);
    check((await fresh(bTask[1].id)).acceptance_status === 'ACCEPTED', 'bấm Nhận → ACCEPTED');
    const adhocB = await act.createAdhocTask(sb, { assigneeId: STAFF_B, name: `${P}Lau kính (đột xuất)`, photoSlots: ['Thẳng'] }, ACTOR);
    check((await fresh(adhocB)).acceptance_status === 'PENDING', 'đột xuất theo adhoc_accept_policy = ACCEPT_REQUIRED → PENDING');
    await expectErr(() => act.declineTask(sb, adhocB, ACTOR, 'không muốn'), 403, 'ACCEPT_REQUIRED: không được từ chối');
    await expectErr(() => act.assertCanUploadPhoto(sb, adhocB, 0), 409, 'chưa Nhận thì chưa chụp được');

    // Nộp theo ô → trả lại 1 ô → chụp lại đúng ô → duyệt
    const adhocA = await act.createAdhocTask(sb, { assigneeId: STAFF_A, name: `${P}Dọn nước đọng`, photoSlots: ['Sàn', 'Biển cảnh báo'] }, ACTOR);
    let t = await fresh(adhocA);
    check(t.acceptance_status === 'AUTO' && t.min_photo_count === 2 && t.assigned_by === ACTOR, 'đột xuất cho vị trí MANDATORY → AUTO, 2 ô ảnh');
    await expectErr(() => act.assertCanUploadPhoto(sb, adhocA, 5), 400, 'ô ảnh không tồn tại bị từ chối');
    let r = await act.onPhotoUploaded(sb, t, await addPhoto(adhocA, 0), 0, ACTOR);
    check(!r.submitted && r.missing.includes('Ảnh: Biển cảnh báo'), 'thiếu 1 ô → chưa gửi duyệt', r.missing.join(','));
    t = await fresh(adhocA);
    const oldSlot1 = await addPhoto(adhocA, 1);
    r = await act.onPhotoUploaded(sb, t, oldSlot1, 1, ACTOR);
    check(r.submitted && svc.deriveTaskState(await fresh(adhocA)) === 'WAITING', 'đủ ô → tự gửi duyệt (không cần bấm)');
    await expectErr(() => act.assertCanUploadPhoto(sb, adhocA, 0), 409, 'đang chờ duyệt thì không chụp thêm');

    await expectErr(() => act.reviewTasks(sb, { taskIds: [adhocA, t1.id], decision: 'REWORK_REQUIRED', reasonCode: 'WRONG_PLACE' }, { userId: null, actorId: ACTOR }), 400, 'trả lại phải từng việc một');
    let rv = await act.reviewTasks(sb, { taskIds: [adhocA], decision: 'REWORK_REQUIRED', reasonCode: 'WRONG_PLACE', note: 'Biển phải đặt giữa lối', rejectedSlots: [{ slot: 1, mark: { x: 40, y: 60 } }] }, { userId: STAFF_A, actorId: ACTOR });
    t = await fresh(adhocA);
    check(rv[0].ok && svc.deriveTaskState(t) === 'FIX' && t.rejected_slots?.[0]?.slot === 1 && t.rejected_slots[0].mark.x === 40, 'trả lại ô 1 kèm vị trí khoanh', rv[0].error);
    await expectErr(() => act.assertCanUploadPhoto(sb, adhocA, 0), 409, 'ô đã đạt không cho chụp lại');
    await act.assertCanUploadPhoto(sb, adhocA, 1);
    r = await act.onPhotoUploaded(sb, t, await addPhoto(adhocA, 1), 1, ACTOR);
    check(r.submitted, 'chụp lại đúng ô bị trả → tự gửi duyệt lại');
    const ph = await must(sb.from('TaskPhotos').select('id, slot_index, superseded_at').eq('task_id', adhocA), 'photos');
    check(ph.length === 3 && ph.filter((x: any) => x.superseded_at).length === 1 && ph.find((x: any) => x.id === oldSlot1)?.superseded_at, 'ảnh cũ ô 1 còn trong lịch sử (superseded), không bị xoá');
    rv = await act.reviewTasks(sb, { taskIds: [adhocA], decision: 'PASSED' }, { userId: STAFF_A, actorId: ACTOR });
    t = await fresh(adhocA);
    const reviews = await must(sb.from('TaskReviews').select('round_number, decision, reviewer_id, rejected_slots').eq('task_id', adhocA).order('round_number'), 'reviews');
    check(svc.deriveTaskState(t) === 'APPROVED' && t.reviewed_by === ACTOR, 'duyệt → APPROVED, ghi người duyệt');
    check(reviews.length === 2 && reviews[0].decision === 'REWORK_REQUIRED' && reviews[1].round_number === 2 && reviews[0].reviewer_id === STAFF_A, 'TaskReviews đủ 2 vòng có reviewer_id');
    const ev = await must(sb.from('TaskEvents').select('type').eq('task_id', adhocA).order('created_at'), 'events');
    check(['ASSIGNED', 'PHOTO', 'SUBMITTED', 'RETURNED', 'APPROVED'].every(x => ev.some((e: any) => e.type === x)), 'nhật ký đủ sự kiện', ev.map((e: any) => e.type).join('>'));

    // Số liệu / xác nhận
    const [evTask] = await must(sb.from('Tasks').insert({ name: `${P}Kiểm kê`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: today, min_photo_count: 0,
        evidence_fields: [{ kind: 'check', label: 'Đã nghe thử' }, { kind: 'count', label: 'Khăn mặt', unit: 'cái', min: 30 }] }).select(), 'ev task');
    await expectErr(() => act.setEvidenceValues(sb, evTask.id, ACTOR, { '1': -3 }), 400, 'số âm bị từ chối');
    r = await act.setEvidenceValues(sb, evTask.id, ACTOR, { '0': true });
    check(!r.submitted && r.missing.includes('Khăn mặt'), 'thiếu số lượng → chưa gửi duyệt');
    r = await act.setEvidenceValues(sb, evTask.id, ACTOR, { '1': '12' });
    const evLog = await must(sb.from('TaskEvents').select('payload').eq('task_id', evTask.id).eq('type', 'EVIDENCE').order('created_at', { ascending: false }).limit(1), 'ev log');
    check(r.submitted && evLog[0].payload.below_min?.[0]?.label === 'Khăn mặt', 'đủ trường → gửi duyệt; dưới mức tối thiểu được ghi lại');

    // Báo vướng
    const t2a = byName(T2.name)[0];
    await act.blockTask(sb, t2a.id, ACTOR, 'NO_SUPPLY', 'Hết khăn');
    check(svc.deriveTaskState(await fresh(t2a.id)) === 'BLOCKED', 'báo vướng → BLOCKED');
    await expectErr(() => act.blockTask(sb, t2a.id, ACTOR, 'BAD'), 400, 'lý do vướng ngoài danh sách bị từ chối');
    await act.unblockTask(sb, t2a.id, ACTOR, true);
    const t2aAfter = await fresh(t2a.id);
    check(t2aAfter.blocks_checkout === false && t2aAfter.status === 'IN_PROGRESS', 'giám sát "Miễn hôm nay" → không còn chặn tan ca');

    // Khung giờ
    const [winTask] = await must(sb.from('Tasks').insert({ name: `${P}Quay mái hiên`, task_type: 'FIXED', assignee_id: STAFF_A, task_date: today, min_photo_count: 0,
        time_mode: 'WINDOW', window_start_at: new Date(Date.now() - 3 * 3600e3).toISOString(), window_end_at: new Date(Date.now() - 2 * 3600e3).toISOString() }).select(), 'win');
    await expectErr(() => act.trySubmit(sb, winTask.id, ACTOR), 409, 'ngoài khung giờ → không nộp được');

    // Gỡ routine → huỷ mềm việc hôm nay chưa làm
    await svc.EmployeeTasksService.ensureTasksForDate(STAFF_C, today, false);
    const n = await act.cancelTodayTasksOfRoutine(sb, [STAFF_C], T5.id, null, ACTOR);
    const cAfter = await must(sb.from('Tasks').select('cancelled_at, cancel_reason').eq('assignee_id', STAFF_C), 'c after');
    check(n === 1 && cAfter.length === 1 && cAfter[0].cancelled_at && cAfter[0].cancel_reason, 'gỡ routine → huỷ mềm (dòng vẫn còn, có lý do)');

    // Hàng chờ duyệt + cho tan ca + vị trí
    const q = await act.getReviewQueue(sb);
    check(q.waiting.some((x: any) => x.id === evTask.id) && q.declined.some((x: any) => x.id === bTask[0].id), 'hàng chờ có việc chờ duyệt và việc bị từ chối');
    check(q.people.some((p: any) => p.staffId === STAFF_A && p.supervisorToReview >= 1), 'tách số việc giám sát cần duyệt');
    await expectErr(() => act.grantCheckoutOverride(sb, STAFF_B, '  ', ACTOR), 400, 'cho tan ca bắt buộc lý do');
    await act.grantCheckoutOverride(sb, STAFF_B, 'Đã kiểm tại chỗ', ACTOR);
    check((await svc.getCheckoutBlockers(sb, STAFF_B, WT)).count === 0, 'cho tan ca → B không bị chặn');
    await act.savePosition(sb, { id: posB.id, name: posB.name, fixed_accept_policy: 'MANDATORY', adhoc_accept_policy: 'MANDATORY', memberIds: [STAFF_B] }, ACTOR);
    const polEv = await must(sb.from('TaskEvents').select('payload').eq('type', 'POSITION_POLICY_CHANGED').eq('actor_id', ACTOR), 'pol ev');
    check(polEv.length === 1 && (await fresh(bTask[1].id)).acceptance_status === 'ACCEPTED', 'đổi chính sách vị trí: ghi nhật ký, việc đã giao giữ nguyên');
    const positions = await act.listPositions(sb);
    check(positions.find((p: any) => p.id === posB.id)?.memberIds?.[0] === STAFF_B, 'listPositions trả thành viên');

    // ---------- 8. Bước 5: giao lại việc bị từ chối, cấu hình việc mẫu, trả lại cả việc ----------
    console.log('\n[8] Giám sát / admin (bước 5)');
    await expectErr(() => act.reassignTask(sb, bTask[0].id, STAFF_B, ACTOR), 400, 'giao lại cho chính người đã từ chối bị chặn');
    await act.reassignTask(sb, bTask[0].id, STAFF_C, ACTOR);
    const re = await fresh(bTask[0].id);
    check(re.assignee_id === STAFF_C && re.acceptance_status === 'AUTO' && !re.declined_reason, 'việc bị từ chối giao lại → người mới, nhận theo vị trí của họ (không vị trí = bắt buộc)');
    await expectErr(() => act.reassignTask(sb, bTask[0].id, STAFF_A, ACTOR), 409, 'chỉ giao lại việc đang bị từ chối');
    const reEv = await must(sb.from('TaskEvents').select('payload').eq('task_id', bTask[0].id).eq('type', 'REASSIGNED'), 're ev');
    check(reEv.length === 1 && reEv[0].payload.from === STAFF_B && reEv[0].payload.to === STAFF_C, 'nhật ký ghi giao lại từ ai sang ai');

    await expectErr(() => act.saveTemplateConfig(sb, T7.id, { time_mode: 'WINDOW', window_start: '10:00', window_end: '09:00' }, ACTOR), 400, 'khung giờ ngược bị từ chối');
    await expectErr(() => act.saveTemplateConfig(sb, T7.id, { time_mode: 'DEADLINE' }, ACTOR), 400, 'hạn chót thiếu giờ bị từ chối');
    await expectErr(() => act.saveTemplateConfig(sb, T7.id, { photo_slots: [{ label: 'A', ref_path: 'reviews/x.jpg' }] }, ACTOR), 400, 'ảnh mẫu ngoài thư mục refs/ bị từ chối');
    await act.saveTemplateConfig(sb, T7.id, {
        standard_text: '  Đèn sáng đủ chữ ', sop: ['Bật CB', ''], time_mode: 'MULTI', multi_times: ['17:00', '09:00', '09:00', 'abc'],
        photo_slots: [{ label: 'Mặt tiền', ref_path: 'refs/qa27.jpg' }, { label: '  ' }],
        evidence_fields: [{ kind: 'count', label: 'Bóng hỏng', unit: 'bóng', min: '0' as any }, { kind: 'check', label: '' }],
        blocks_checkout: false, requires_review: true, allow_carry_over: false,
    }, ACTOR);
    const cfg = await act.getTemplateConfig(sb, T7.id);
    check(cfg.time_mode === 'MULTI' && JSON.stringify(cfg.multi_times) === '["09:00","17:00"]' && cfg.due_time === null, 'MULTI: mốc giờ lọc trùng, sắp xếp, xoá giờ của chế độ cũ', JSON.stringify(cfg.multi_times));
    check(cfg.photo_slots.length === 1 && cfg.min_photo_count === 1 && cfg.requires_photo === true && cfg.refUrls[0]?.includes('refs/qa27.jpg'), 'ô ảnh rỗng bị bỏ, đồng bộ số ảnh tối thiểu, trả link ảnh mẫu');
    check(cfg.evidence_fields.length === 1 && cfg.evidence_fields[0].min === 0 && cfg.standard_text === 'Đèn sáng đủ chữ' && cfg.sop.length === 1, 'trường số liệu chuẩn hoá');
    check(cfg.blocks_checkout === false && cfg.allow_carry_over === false, 'lưu cờ chặn tan ca / cho tồn');
    const tplEv = await must(sb.from('TaskEvents').select('id').eq('type', 'TEMPLATE_CONFIG_CHANGED').eq('actor_id', ACTOR), 'tpl ev');
    check(tplEv.length === 1, 'đổi cấu hình việc mẫu được ghi nhật ký');

    const whole = await act.createAdhocTask(sb, { assigneeId: STAFF_A, name: `${P}Trả cả việc`, photoSlots: ['Trước', 'Sau'] }, ACTOR);
    let w = await fresh(whole);
    await act.onPhotoUploaded(sb, w, await addPhoto(whole, 0), 0, ACTOR);
    w = await fresh(whole);
    await act.onPhotoUploaded(sb, w, await addPhoto(whole, 1), 1, ACTOR);
    rv = await act.reviewTasks(sb, { taskIds: [whole], decision: 'REWORK_REQUIRED', reasonCode: 'OTHER', note: 'Làm lại', allSlots: true }, { userId: null, actorId: ACTOR });
    w = await fresh(whole);
    check(rv[0].ok && w.rejected_slots?.length === 2 && svc.deriveTaskState(w) === 'FIX', 'trả lại cả việc (màn nhân viên) → mọi ô phải chụp lại', rv[0].error);

    // Kho việc (bước 7: chuyển từ client lên server)
    const saved = await act.saveCategoryWithTemplates(sb, { name: `${P}Kho`, repeatMode: 'WEEKLY', tasks: [
        { name: 'Việc A', requires_photo: true, min_photo_count: 2, cron_schedule: '1,5' }, { name: 'Việc B' }, { name: '   ' },
    ] }, ACTOR);
    let kho = await must(sb.from('TaskTemplates').select('id, name, min_photo_count, cron_schedule, is_active, sort_order').eq('category_id', saved.categoryId).order('sort_order'), 'kho');
    check(kho.length === 2 && kho[0].cron_schedule === '1,5' && kho[0].min_photo_count === 2, 'lưu nhóm việc mới + 2 việc (bỏ dòng trống)');
    await act.saveCategoryWithTemplates(sb, { categoryId: saved.categoryId, name: `${P}Kho`, tasks: [{ id: kho[1].id, name: 'Việc B sửa' }, { id: T1.id, name: 'Lấn nhóm khác' }] }, ACTOR);
    kho = await must(sb.from('TaskTemplates').select('id, name, is_active').eq('category_id', saved.categoryId), 'kho2');
    check(kho.find((x: any) => x.name === 'Việc A')?.is_active === false && kho.find((x: any) => x.id !== undefined && x.name === 'Việc B sửa')?.is_active, 'việc bỏ khỏi danh sách → tắt (không xoá), việc giữ lại được sửa tên');
    check((await must(sb.from('TaskTemplates').select('name').eq('id', T1.id), 't1'))[0].name !== 'Lấn nhóm khác', 'không sửa được việc mẫu của nhóm khác qua form này');
    await expectErr(() => act.saveCategoryWithTemplates(sb, { name: ' ', tasks: [] }, ACTOR), 400, 'nhóm việc bắt buộc có tên');

    const opts = await act.listOfficeOptions(sb);
    check(opts.staff.some((x: any) => x.id === STAFF_A) && opts.categories.some((c: any) => c.id === catDaily.id), 'danh sách chọn nhân viên / nhóm việc');
}

main()
    .catch(e => { failures++; fatal(e); })
    .finally(async () => {
        try { await cleanup(); console.log('\n(đã dọn dữ liệu QA27-)'); } catch (e) { console.error('cleanup lỗi', e); }
        console.log(failures === 0 ? '\n=== DAT ===' : `\n=== KHONG DAT: ${failures} loi ===`);
        finish(failures);
    });
