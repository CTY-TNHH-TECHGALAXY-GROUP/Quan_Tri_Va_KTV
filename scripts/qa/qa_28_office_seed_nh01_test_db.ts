/**
 * QA #28 — OFFICE P0 bước 6: checklist NH01 đã seed sinh việc đúng (DB TEST).
 * Cần chạy scripts/office/seed_nh01_checklist.ts --apply trên TEST trước.
 *
 * Gắn nhân viên tạm QA904 vào vị trí "Quầy hỗ trợ NH01", sinh việc cho 7 ngày liên tiếp bằng service THẬT, kiểm:
 *   - mỗi ngày: 42 việc thường + 3 lượt "Thay khăn lau tay" (09:00/13:00/17:00, 4 ô) = 45, + việc tuần đúng thứ
 *   - ô ảnh có nhãn, số liệu ghế tròn tối thiểu 5, việc ngày không tồn sang hôm sau, việc tuần cho tồn
 *   - chính sách vị trí Bắt buộc làm → AUTO; gọi lại không sinh trùng; cổng tan ca đếm đủ
 * Dọn: xoá QA904 + việc của QA904 + thành viên tạm. KHÔNG xoá dữ liệu seed.
 * Chạy: npm run test:office-seed
 */
import * as fs from 'fs';
import * as path from 'path';
import Module from 'module';
import { finish, fatal } from './_exit';
import { DAILY_BLOCKS, WEEKLY_ITEMS, POSITION } from '../office/nh01_checklist.data';

const TEST_REF = 'eknggruuiuadwldacpmb';
for (const line of fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8').split(/\r?\n/)) {
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

const sb = getSupabaseAdmin();
const STAFF = 'QA904';
const WT = 'QA28_OFFICE';
const CFG_KEY = `block_checkout_incomplete_tasks_${WT}`;
const VN_DAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const must = async (p: PromiseLike<{ data: any; error: any }>, what: string) => {
    const { data, error } = await p;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
};

async function cleanup() {
    await sb.from('Tasks').delete().eq('assignee_id', STAFF);
    await sb.from('OfficePositionMembers').delete().eq('staff_id', STAFF);
    await sb.from('SystemConfigs').delete().eq('key', CFG_KEY);
    await sb.from('Staff').delete().eq('id', STAFF);
}

async function main() {
    const today = getVnDateStr();
    console.log(`=== QA28 seed NH01 — TEST — today(VN)=${today} TZ=${process.env.TZ || '(local)'} ===`);
    await cleanup();

    const [pos] = await must(sb.from('OfficePositions').select('id, fixed_accept_policy').eq('name', POSITION), 'pos');
    if (!pos) throw new Error('Chưa seed: chạy scripts/office/seed_nh01_checklist.ts --apply trước');
    check(pos.fixed_accept_policy === 'MANDATORY', 'vị trí NH01: việc cố định = Bắt buộc làm');
    await must(sb.from('Staff').insert({ id: STAFF, full_name: 'QA28 Quầy', status: 'ĐANG LÀM', work_type: 'TYPE_A' }).select(), 'staff');
    await must(sb.from('OfficePositionMembers').insert({ position_id: pos.id, staff_id: STAFF }).select(), 'member');

    const dailyCount = DAILY_BLOCKS.reduce((n, b) => n + b.items.length, 0);   // 43 templates
    const perDay = dailyCount - 1 + 3;                                          // towel ×3 mốc
    for (let k = 0; k < 7; k++) {
        const d = svc.shiftVnDate(today, k);
        const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
        const weekly = WEEKLY_ITEMS.filter(w => w.days.includes(dow)).length;
        await svc.EmployeeTasksService.ensureTasksForDate(STAFF, d, false);
        const rows = await must(sb.from('Tasks').select('id, name, slot_time, photo_slots, evidence_fields, allow_carry_over, acceptance_status, blocks_checkout')
            .eq('assignee_id', STAFF).eq('task_date', d), 'tasks');
        check(rows.length === perDay + weekly, `${d} (${VN_DAY[dow]}): ${perDay} việc ngày + ${weekly} việc tuần`, String(rows.length));
        if (k === 0) {
            const towel = rows.filter((r: any) => r.name.startsWith('Thay khăn lau tay'));
            check(towel.length === 3 && towel.every((r: any) => r.photo_slots?.length === 4) && towel.map((r: any) => r.slot_time).sort().join(',') === '09:00,13:00,17:00',
                'khăn lau tay: 3 mốc × 4 ô khu vực');
            const chairs = rows.find((r: any) => r.name.includes('ghế tròn'));
            check(chairs?.evidence_fields?.[0]?.min === 5, 'ghế tròn: ô số lượng tối thiểu 5');
            const dryer = rows.find((r: any) => r.name.startsWith('Set up máy sấy'));
            check(dryer?.photo_slots?.map((s: any) => s.label).join('|') === 'Phòng gội|Sảnh', 'máy sấy: 2 ô "Phòng gội", "Sảnh"');
            const daily = rows.filter((r: any) => !WEEKLY_ITEMS.some(w => w.row[1] === r.name));
            check(daily.every((r: any) => r.allow_carry_over === false && r.blocks_checkout && r.acceptance_status === 'AUTO'), 'việc ngày: không tồn, chặn tan ca, tự nhận');
            await svc.EmployeeTasksService.ensureTasksForDate(STAFF, d, false);
            const again = await must(sb.from('Tasks').select('id').eq('assignee_id', STAFF).eq('task_date', d), 'again');
            check(again.length === rows.length, 'sinh lại cùng ngày không trùng');
            await must(sb.from('SystemConfigs').upsert({ key: CFG_KEY, value: true }, { onConflict: 'key' }).select(), 'cfg');
            const gate = await svc.getCheckoutBlockers(sb, STAFF, WT, { ensure: false });
            check(gate.count === rows.length, 'cổng tan ca đếm đủ việc hôm nay', `${gate.count}`);
        }
    }
}

main()
    .catch(e => { failures++; fatal(e); })
    .finally(async () => {
        try { await cleanup(); console.log('\n(đã dọn QA904)'); } catch (e) { console.error('cleanup lỗi', e); }
        console.log(failures === 0 ? '\n=== DAT ===' : `\n=== KHONG DAT: ${failures} loi ===`);
        finish(failures);
    });
