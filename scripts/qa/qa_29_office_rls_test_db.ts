/**
 * QA #29 — OFFICE P0 bước 7: bảng việc chỉ-đọc với khoá anon (khoá nằm trong trang web), DB TEST.
 *   - anon SELECT các bảng việc được (màn hình + realtime)
 *   - anon INSERT / UPDATE / DELETE bị chặn (RLS), dữ liệu không đổi
 *   - bảng Office mới: anon không đọc được
 * Dữ liệu mồi tạo bằng service role, tiền tố QA29-, dọn khi xong.
 * Chạy: npm run test:office-rls
 */
import * as fs from 'fs';
import * as path from 'path';
import { finish, fatal } from './_exit';

const TEST_REF = 'eknggruuiuadwldacpmb';
for (const line of fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
}
if (!String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes(TEST_REF)) throw new Error('DỪNG: không phải DB TEST');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createClient } = require('@supabase/supabase-js');
const opts = { auth: { persistSession: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, opts);
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, opts);
const P = 'QA29-';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

async function cleanup() {
    const { data: cats } = await admin.from('TaskCategories').select('id').like('name', `${P}%`);
    if (cats?.length) {
        await admin.from('TaskTemplates').delete().in('category_id', cats.map((c: any) => c.id));
        await admin.from('TaskCategories').delete().in('id', cats.map((c: any) => c.id));
    }
    await admin.from('Tasks').delete().like('name', `${P}%`);
}

async function main() {
    console.log('=== QA29 RLS bảng việc — TEST ===');
    await cleanup();
    const { data: cat } = await admin.from('TaskCategories').insert({ name: `${P}Nhóm`, type: 'ROLE', repeat_mode: 'DAILY' }).select('id').single();
    const { data: task } = await admin.from('Tasks').insert({ name: `${P}Việc`, task_type: 'AD-HOC', status: 'NOT_STARTED', inspection_status: 'NOT_REVIEWED' }).select('id, status').single();

    for (const t of ['Tasks', 'TaskPhotos', 'TaskReviews', 'TaskNotifications', 'TaskTemplates', 'TaskCategories', 'EmployeeRoutines', 'RoomTaskTemplates']) {
        const { error } = await anon.from(t).select('*').limit(1);
        check(!error, `anon đọc được ${t}`, error?.message);
    }
    const seen = await anon.from('Tasks').select('id').eq('id', task.id);
    check(seen.data?.length === 1, 'anon thấy đúng dòng việc (màn hình + realtime vẫn chạy)');

    const ins = await anon.from('TaskCategories').insert({ name: `${P}Lậu`, type: 'ROLE' }).select('id');
    check(!!ins.error, 'anon KHÔNG thêm được nhóm việc', ins.error?.message);
    const upd = await anon.from('Tasks').update({ status: 'COMPLETED', inspection_status: 'PASSED' }).eq('id', task.id).select('id');
    const after = await admin.from('Tasks').select('status, inspection_status').eq('id', task.id).single();
    check((upd.data || []).length === 0 && after.data.status === 'NOT_STARTED', 'anon KHÔNG tự duyệt / sửa được việc', upd.error?.message || '0 dòng');
    const del = await anon.from('TaskCategories').delete().eq('id', cat.id).select('id');
    const still = await admin.from('TaskCategories').select('id').eq('id', cat.id);
    check((del.data || []).length === 0 && still.data?.length === 1, 'anon KHÔNG xoá được nhóm việc');
    const ph = await anon.from('TaskPhotos').insert({ task_id: task.id, storage_path: 'x', is_submitted: true }).select('id');
    check(!!ph.error, 'anon KHÔNG chèn được ảnh giả', ph.error?.message);
    const rv = await anon.from('TaskReviews').insert({ task_id: task.id, round_number: 1, decision: 'PASSED' }).select('id');
    check(!!rv.error, 'anon KHÔNG chèn được kết quả duyệt', rv.error?.message);

    for (const t of ['OfficePositions', 'TaskEvents', 'CheckoutOverrides']) {
        const { data } = await anon.from(t).select('*').limit(1);
        check((data || []).length === 0, `anon không đọc được ${t}`);
    }
}

main()
    .catch(e => { failures++; fatal(e); })
    .finally(async () => {
        try { await cleanup(); console.log('\n(đã dọn QA29-)'); } catch (e) { console.error('cleanup lỗi', e); }
        console.log(failures === 0 ? '\n=== DAT ===' : `\n=== KHONG DAT: ${failures} loi ===`);
        finish(failures);
    });
