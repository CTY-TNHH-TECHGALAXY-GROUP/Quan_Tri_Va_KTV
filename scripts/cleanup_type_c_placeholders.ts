/**
 * Dọn các mã KTV loại C "placeholder" — dòng `Staff` do bảng điều phối tự sinh
 * (`EXT_xxxxxx`, `C_xxxxxx`) mỗi khi lễ tân gõ một tên lạ. Không ai đăng nhập
 * bằng chúng; từ 12/09/2026 loại C là tài khoản thật (plan
 * `plans/plan_ktv_loai_c_tai_khoan_that.md`), nên đám này phải rút khỏi vận hành.
 *
 * SOFT-DELETE, không xoá hàng: 550 dòng `TurnLedger` + 203 `KTVMonthlyLedger`
 * tháng 8–9 đang trỏ vào các mã này, xoá là mất số liệu tài chính đã chốt.
 *
 * Tiêu chí "placeholder": `work_type = TYPE_C` VÀ không có `Users.code` khớp.
 * Loại C có tài khoản thật (tạo từ Admin → Nhân viên) không bị đụng.
 *
 * Việc làm:
 *   1. Xoá `TurnQueue` của họ (không còn trong hàng đợi).
 *   2. `KtvAssignments` còn dang dở (QUEUED/READY/ACTIVE) → CANCELLED.
 *   3. `Staff.status` → ĐÃ NGHỈ, tắt công tắc VIP / Home Spa.
 *
 * Chạy:
 *   npx ts-node -O "{\"module\":\"commonjs\"}" scripts/cleanup_type_c_placeholders.ts           # dry-run
 *   npx ts-node -O "{\"module\":\"commonjs\"}" scripts/cleanup_type_c_placeholders.ts --apply   # ghi thật
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const APPLY = process.argv.includes('--apply');
const STAFF_RESIGNED = 'ĐÃ NGHỈ';
const STAFF_WORKING = 'ĐANG LÀM';
const OPEN_ASSIGNMENT_STATUSES = ['QUEUED', 'READY', 'ACTIVE'];

const chunk = <T,>(arr: T[], size = 100): T[][] =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));

async function run() {
    console.log(`--- CLEANUP TYPE_C PLACEHOLDERS (${APPLY ? 'APPLY' : 'DRY-RUN'}) ---`);

    const { data: typeC, error: e1 } = await supabase
        .from('Staff')
        .select('id, full_name, status')
        .eq('work_type', 'TYPE_C');
    if (e1) throw e1;

    const ids = (typeC || []).map(s => s.id);
    const { data: users, error: e2 } = ids.length
        ? await supabase.from('Users').select('code').in('code', ids)
        : { data: [], error: null };
    if (e2) throw e2;
    const hasAccount = new Set((users || []).map(u => u.code));

    const placeholders = (typeC || []).filter(s => !hasAccount.has(s.id));
    const real = (typeC || []).filter(s => hasAccount.has(s.id));
    const stillWorking = placeholders.filter(s => s.status === STAFF_WORKING);
    const pIds = placeholders.map(s => s.id);

    console.log(`TYPE_C tổng: ${ids.length} | có tài khoản (giữ nguyên): ${real.length} | placeholder: ${placeholders.length} (đang ĐANG LÀM: ${stillWorking.length})`);
    real.forEach(s => console.log(`   giữ: ${s.id} — ${s.full_name}`));
    const oddIds = placeholders.filter(s => !/^(EXT|C_)/i.test(s.id));
    if (oddIds.length) {
        console.log(`⚠️ ${oddIds.length} placeholder không theo mẫu EXT_/C_ (vẫn xử lý vì không có tài khoản):`);
        oddIds.forEach(s => console.log(`   ${s.id} — ${s.full_name}`));
    }
    if (!pIds.length) { console.log('Không có gì để dọn.'); return; }

    let tqCount = 0, kaCount = 0;
    for (const part of chunk(pIds)) {
        const { count: c1 } = await supabase.from('TurnQueue').select('*', { count: 'exact', head: true }).in('employee_id', part);
        tqCount += c1 || 0;
        const { count: c2 } = await supabase.from('KtvAssignments').select('*', { count: 'exact', head: true })
            .in('employee_id', part).in('status', OPEN_ASSIGNMENT_STATUSES);
        kaCount += c2 || 0;
    }
    console.log(`Sẽ: xoá ${tqCount} TurnQueue | huỷ ${kaCount} KtvAssignments dang dở | chuyển ${stillWorking.length} Staff → ${STAFF_RESIGNED}`);

    if (!APPLY) { console.log('Dry-run xong. Thêm --apply để ghi.'); return; }

    for (const part of chunk(pIds)) {
        const { error } = await supabase.from('TurnQueue').delete().in('employee_id', part);
        if (error) throw error;
    }
    for (const part of chunk(pIds)) {
        const { error } = await supabase.from('KtvAssignments')
            .update({ status: 'CANCELLED' })
            .in('employee_id', part).in('status', OPEN_ASSIGNMENT_STATUSES);
        if (error) throw error;
    }
    for (const part of chunk(pIds)) {
        const { error } = await supabase.from('Staff')
            .update({ status: STAFF_RESIGNED, is_active_vip_menu: false, is_home_spa: false })
            .in('id', part);
        if (error) throw error;
    }

    const { count: left } = await supabase.from('Staff').select('*', { count: 'exact', head: true })
        .eq('work_type', 'TYPE_C').eq('status', STAFF_WORKING).in('id', pIds);
    console.log(`✅ Xong. Placeholder còn ĐANG LÀM: ${left ?? '?'} (kỳ vọng 0).`);
}

run().catch(err => { console.error('❌', err); process.exit(1); });
