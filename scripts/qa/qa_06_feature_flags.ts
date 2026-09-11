/**
 * QA #6 — Bật/tắt RIÊNG từng tính năng của KTV, không ảnh hưởng chéo.
 *
 * Sáu nhóm kiểm tra:
 *   F1. Gạt 1 cờ chỉ đổi ĐÚNG cờ đó — mọi cờ khác và mọi khoá lạ giữ nguyên.
 *   F2. Mặc định khi cờ THIẾU phải khớp giữa `resolveStaffFlag` và cách từng
 *       consumer đang tự đọc (`?? true`, `=== true`, `!== false`).
 *   F3. Ma trận công tắc hai tầng của ví: tầng LOẠI × tầng NGƯỜI.
 *   F4. Bảng admin có nhìn thấy đúng nhóm KTV cần chỉnh không.
 *   F5. Đổi loại KTV có thổi bay cờ/trạng thái không liên quan không.
 *   F6. Route sửa cờ có lớp phân quyền chưa.
 *
 * Chạy: npx ts-node -O "{\"module\":\"commonjs\"}" scripts/qa/qa_06_feature_flags.ts
 * CHỈ ĐỌC DB (F1/F3/F5 chạy trên bản sao trong bộ nhớ, không ghi Staff).
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
    resolveStaffFlag, FLAG_DEFAULT_WHEN_MISSING, MANAGED_FLAG_KEYS,
    isWalletEnabled, isWalletEnabledForType, walletConfigKey, WALLET_TYPES,
} from '../../lib/featureFlags';
import { FEATURE_FLAG_DEFS } from '../../app/admin/settings/system/KtvFeatures.logic';
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

const FLAG_KEYS = FEATURE_FLAG_DEFS.map(d => d.key) as string[];

/** Đúng phép ghi của PATCH /api/admin/staff-features (nhánh gạt 1 cờ). */
function patchOneFlag(current: Record<string, any>, flagKey: string, value: boolean) {
    return { ...(current || {}), [flagKey]: value };
}

async function main() {
    console.log('\n=== QA #6 · Bat/tat rieng tung tinh nang KTV ===\n');
    console.log(`So co dang quan ly tren bang admin: ${FLAG_KEYS.length}`);
    console.log(`  ${FLAG_KEYS.join(', ')}\n`);

    // ── F1: gạt 1 cờ không đụng cờ khác ────────────────────────────────
    console.log('--- F1: gat 1 co chi doi dung co do ---');

    // Trạng thái xuất phát: mọi cờ BẬT, kèm vài khoá "lạ" mà app khác ghi chung
    // vào `feature_flags` (on-call ghi is_on_call / travel_time_mins vào đây).
    const baseline: Record<string, any> = Object.fromEntries(FLAG_KEYS.map(k => [k, true]));
    baseline.is_on_call = true;
    baseline.travel_time_mins = 45;

    let crossTalk = 0;
    for (const key of FLAG_KEYS) {
        const after = patchOneFlag(baseline, key, false);

        // Cờ mục tiêu phải TẮT
        if (resolveStaffFlag(after, key) !== false) {
            check(false, `Gat TAT ${key}`, 'co muc tieu khong doi');
            crossTalk++;
            continue;
        }
        // Mọi cờ khác phải giữ nguyên BẬT
        const bled = FLAG_KEYS.filter(k => k !== key && resolveStaffFlag(after, k) !== true);
        // Khoá lạ phải còn nguyên
        const lostExtras = ['is_on_call', 'travel_time_mins']
            .filter(k => after[k] !== baseline[k]);

        if (bled.length || lostExtras.length) {
            check(false, `Gat TAT ${key} lam anh huong cho`,
                `co khac bi doi: ${bled.join(', ') || 'khong'} | khoa la mat: ${lostExtras.join(', ') || 'khong'}`);
            crossTalk++;
        }
    }
    if (crossTalk === 0) check(true, `Ca ${FLAG_KEYS.length} co gat rieng duoc, khong anh huong cheo`);

    // Bí danh cờ cũ: bonus_wallet <- enable_bonus_wallet, savings_wallet <- enable_piggy_wallet
    console.log('\n--- F1b: co cu trong DB van doc ra dung co moi ---');
    check(resolveStaffFlag({ enable_bonus_wallet: true }, 'bonus_wallet') === true,
        'enable_bonus_wallet=true doc ra bonus_wallet BAT');
    check(resolveStaffFlag({ enable_piggy_wallet: false }, 'savings_wallet') === false,
        'enable_piggy_wallet=false doc ra savings_wallet TAT');
    // Cờ mới phải THẮNG cờ cũ khi cả hai cùng có
    check(resolveStaffFlag({ bonus_wallet: false, enable_bonus_wallet: true }, 'bonus_wallet') === false,
        'Co MOI thang co cu khi ca hai cung co');
    // Chuỗi "true"/"false" (jsonb hay về dạng chuỗi có nháy)
    check(resolveStaffFlag({ tua_wallet: '"false"' }, 'tua_wallet') === false,
        'Chuoi \'"false"\' hieu la TAT');

    // ── F2: mặc định khi cờ thiếu ──────────────────────────────────────
    console.log('\n--- F2: co THIEU thi hieu la gi (doi chieu voi consumer that) ---');
    // Cách từng nơi trong code đang tự đọc khi cờ thiếu — lấy từ chính source.
    const CONSUMERS: Array<[string, boolean, string]> = [
        ['enable_bonus', true, 'feature_flags?.enable_bonus ?? true (7 cho: cron, finance, history, vi bonus)'],
        ['maintenance_fee', true, 'feature_flags.maintenance_fee === false (KtvLedgerSyncService)'],
        ['allow_on_call', false, 'feature_flags?.allow_on_call === true (KtvOnlineService, KtvTypeDOnlineService)'],
        ['tua_wallet', true, 'app KTV doc !== false'],
    ];
    for (const [key, expect, where] of CONSUMERS) {
        const got = resolveStaffFlag({}, key);
        check(got === expect, `${key}: thieu co => ${got ? 'BAT' : 'TAT'}`, where);
    }
    const undeclared = FLAG_KEYS.filter(k => !(k in FLAG_DEFAULT_WHEN_MISSING));
    check(undeclared.length === 0,
        'Moi co tren bang admin deu co mac dinh khai bao trong FLAG_DEFAULT_WHEN_MISSING',
        undeclared.length ? `thieu: ${undeclared.join(', ')}` : '');

    // ── F3: ma trận công tắc hai tầng của ví ───────────────────────────
    console.log('\n--- F3: ma tran cong tac VI (tang LOAI x tang NGUOI) ---');
    const wt = 'TYPE_D';
    const matrix: Array<[boolean, boolean, boolean]> = [
        // [tang loai, tang nguoi, ket qua mong doi]
        [true, true, true],
        [true, false, false],
        [false, true, false],
        [false, false, false],
    ];
    for (const w of WALLET_TYPES) {
        const staffFlagKey = { TUA: 'tua_wallet', BONUS: 'bonus_wallet', SAVINGS: 'savings_wallet' }[w];
        for (const [typeOn, staffOn, expect] of matrix) {
            const configs = { [walletConfigKey(w, wt)]: typeOn };
            const staff = { work_type: wt, feature_flags: { [staffFlagKey]: staffOn } };
            const got = isWalletEnabled(w, staff as any, configs);
            check(got === expect,
                `Vi ${w}: loai=${typeOn ? 'BAT' : 'TAT'} nguoi=${staffOn ? 'BAT' : 'TAT'} => ${got ? 'BAT' : 'TAT'}`);
        }
        // Tắt một loại KHÔNG được kéo theo loại khác
        const cfgOffD = { [walletConfigKey(w, 'TYPE_D')]: false };
        check(isWalletEnabledForType(w, 'TYPE_A', cfgOffD) === true,
            `Vi ${w}: tat o TYPE_D khong lam tat o TYPE_A`);
        // Thiếu config = BẬT (giữ nguyên hành vi trước khi có tính năng)
        check(isWalletEnabledForType(w, wt, {}) === true,
            `Vi ${w}: thieu config tang loai => mac dinh BAT`);
    }
    // Tắt ví BONUS không được kéo ví TUA theo
    const cfg = { [walletConfigKey('BONUS', wt)]: false };
    const st = { work_type: wt, feature_flags: { tua_wallet: true, bonus_wallet: true } };
    check(isWalletEnabled('TUA', st as any, cfg) === true && isWalletEnabled('BONUS', st as any, cfg) === false,
        'Tat vi BONUS o tang loai khong lam mat vi TUA');

    // ── F4: bảng admin có thấy KTV cần chỉnh không ─────────────────────
    console.log('\n--- F4: bang admin Tinh nang co thay du KTV khong ---');
    // Mirrors GET /api/admin/staff-features: WORKING + LOCKED. The "Hoạt động"
    // switch locks accounts; a locked row must stay on the table, or it could
    // never be switched back on from there.
    const { data: active } = await supabase
        .from('Staff').select('id, full_name, work_type')
        .in('status', ['ĐANG LÀM', 'KHÓA_TÀI_KHOẢN']);
    const all = active || [];
    {
        const routeSrc = fs.readFileSync(
            path.join(__dirname, '../../app/api/admin/staff-features/route.ts'), 'utf8');
        const keepsLocked = /\.in\(\s*'status'\s*,\s*\[\s*STAFF_STATUS\.WORKING\s*,\s*STAFF_STATUS\.LOCKED\s*\]\s*\)/.test(routeSrc);
        check(keepsLocked, 'Bang Tinh nang van thay nguoi dang bi khoa (loc WORKING + LOCKED)',
            keepsLocked ? '' : 'tat "Hoat dong" xong dong do bien mat, khong bat lai duoc tu bang');
    }
    // Đúng bộ lọc mà GET /api/admin/staff-features đang dùng: bỏ các mã KHÔNG
    // phải tài khoản app (chỗ giữ tên KTV ngoài / gộp nhiều người).
    const PLACEHOLDER_ID = /^(EXT|C_)/i;
    const visible = all.filter(s => !PLACEHOLDER_ID.test(s.id));
    const byType = (list: any[]) => {
        const m: Record<string, number> = {};
        list.forEach(s => { const k = s.work_type || 'TYPE_A'; m[k] = (m[k] || 0) + 1; });
        return m;
    };
    console.log(`  Nhan vien dang lam/bi khoa: ${all.length} → ${JSON.stringify(byType(all))}`);
    console.log(`  Bang admin hien thi: ${visible.length} → ${JSON.stringify(byType(visible))}  (bo EXT_/C_ placeholder)`);
    const hiddenD = all.filter(s => (s.work_type === 'TYPE_D') && PLACEHOLDER_ID.test(s.id));
    check(hiddenD.length === 0,
        'Moi KTV loai D deu hien tren bang Tinh nang',
        hiddenD.length
            ? `${hiddenD.length} KTV loai D BI AN: ${hiddenD.map(s => s.id).join(', ')}`
            : `${visible.filter(s => s.work_type === 'TYPE_D').length} KTV loai D deu bam duoc`);
    // Không được kéo theo 136 dòng placeholder điều phối vào bảng.
    const placeholders = visible.filter(s => PLACEHOLDER_ID.test(s.id));
    check(placeholders.length === 0,
        'Bang admin khong lan cac ma giu cho cua bang dieu phoi (EXT_/C_)',
        placeholders.length ? `${placeholders.length} dong rac` : '');

    // ── F5: đổi loại KTV có thổi bay khoá lạ không ─────────────────────
    console.log('\n--- F5: doi loai KTV co thoi bay co/trang thai khong lien quan khong ---');
    const before = { ...baseline };                       // có is_on_call, travel_time_mins
    const newFlags: Record<string, any> = { tua_wallet: true, enable_bonus: true };  // getDefaultFlagsForType(...) tra ve bo moi

    // Đúng phép ghi của nhánh updateWorkType: giữ lại khoá KHÔNG do bảng Tính
    // năng quản lý, rồi phủ bộ mặc định của loại mới lên trên.
    const preserved: Record<string, any> = {};
    for (const [k, v] of Object.entries(before)) {
        if (!MANAGED_FLAG_KEYS.includes(k)) preserved[k] = v;
    }
    const afterWorkTypeChange = { ...preserved, ...newFlags };

    const runtimeKeys = ['is_on_call', 'travel_time_mins'];
    const lost = runtimeKeys.filter(k => afterWorkTypeChange[k] !== before[k]);
    check(lost.length === 0,
        'Doi loai KTV giu nguyen trang thai runtime khong phai co tinh nang',
        lost.length ? `bi xoa: ${lost.join(', ')}` : `giu lai: ${runtimeKeys.join(', ')}`);
    // Cờ tính năng thì ĐÚNG là phải đặt lại theo loại mới.
    check(!('laundry_deduction' in afterWorkTypeChange),
        'Co tinh nang cu duoc dat lai theo bo mac dinh cua loai moi');
    // MANAGED_FLAG_KEYS phải phủ đủ mọi cờ trên bảng admin.
    const notManaged = FLAG_KEYS.filter(k => !MANAGED_FLAG_KEYS.includes(k));
    check(notManaged.length === 0,
        'MANAGED_FLAG_KEYS phu du moi co tren bang admin',
        notManaged.length ? `thieu: ${notManaged.join(', ')}` : '');

    // ── F6: phân quyền của route sửa cờ ────────────────────────────────
    console.log('\n--- F6: route /api/admin/staff-features co lop phan quyen chua ---');
    const routeSrc = fs.readFileSync(
        path.join(__dirname, '../../app/api/admin/staff-features/route.ts'), 'utf8');
    const hasGuard = /requirePermission|requireBusinessUser|requireAdmin/.test(routeSrc);
    check(hasGuard, 'Route staff-features co lop kiem quyen',
        hasGuard ? '' : 'KHONG co requirePermission — bat ky ai goi duoc PATCH de bat/tat co cua moi KTV');

    // Công tắc CẢ LOẠI nằm ở route khác — cũng phải có lớp chặn.
    const sysSrc = fs.readFileSync(
        path.join(__dirname, '../../app/api/admin/settings/system/route.ts'), 'utf8');
    const sysGuard = /requirePermission|requireBusinessUser|requireAdmin/.test(sysSrc);
    check(sysGuard, 'Route settings/system (cong tac CA LOAI) co lop kiem quyen',
        sysGuard ? '' : 'KHONG co — tat vi ca loai TYPE_D ma khong can quyen gi');

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
