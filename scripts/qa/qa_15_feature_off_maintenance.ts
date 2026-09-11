/**
 * QA #15 — Tính năng bị TẮT mà quyền vẫn còn → LUÔN báo "Tính năng của bạn đang bảo trì".
 *
 * Plan: plans/plan_cong_tac_mo_app_va_trang_lich_su.md (bản 3).
 *
 * Bảy nhóm kiểm tra:
 *   M1. Cờ `history_page`: thiếu = BẬT (không thì cả tiệm thấy bảo trì), có trên
 *       bảng Tính năng, có trong bộ mặc định 4 loại; câu tắt ví = câu bảo trì.
 *   M2. Chặn ở SERVER: lịch sử + sổ giờ trả 403 FEATURE_MAINTENANCE; ô Điểm Office
 *       trả `disabled`; điểm danh không phát tín hiệu rút khi Ví Tua tắt.
 *   M3. CLIENT không nuốt lỗi: trang Lịch sử / Ví / modal / Dashboard / Chấm công
 *       hiện `FeatureMaintenanceNotice` thay vì 0đ, danh sách rỗng, hay ẩn lặng lẽ.
 *   M4. DB `Staff.lock_source` + trigger (chạy trong transaction rồi ROLLBACK).
 *   M5. Route khoá tay: ghi `status` + `lock_source='MANUAL'` CÙNG một UPDATE,
 *       chặn khi đang có đơn, KHÔNG ghi sổ kỷ luật, quyền có thật trong MODULES.
 *   M6. Mọi chỗ KTV thấy "bị khoá" rẽ nhánh MANUAL → câu bảo trì; kỷ luật giữ lý do;
 *       trạng thái khoá đi qua session-check (toàn cục, không mất khi chuyển trang).
 *   M7. Câu bảo trì chỉ viết cứng ở MỘT chỗ (hằng số) trong code phía KTV.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_15_feature_off_maintenance.ts
 * Chỉ ĐỌC DB, trừ M4: ghi Staff trong một transaction rồi ROLLBACK — không để lại gì.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { resolveStaffFlag, walletDisabledMessage } from '../../lib/featureFlags';
import { FEATURE_FLAG_DEFS } from '../../app/admin/settings/system/KtvFeatures.logic';
import {
    DEFAULT_FEATURE_FLAGS_TYPE_A, DEFAULT_FEATURE_FLAGS_TYPE_B,
    DEFAULT_FEATURE_FLAGS_TYPE_C, DEFAULT_FEATURE_FLAGS_TYPE_D,
} from '../../lib/constants/staff.constants';
import { FEATURE_MAINTENANCE_MESSAGE, FEATURE_MAINTENANCE_CODE } from '../../lib/constants/featureMaintenance.i18n';
import { MODULES } from '../../lib/constants';
import { finish, fatal } from './_exit';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');

dotenv.config({ path: '.env.local', quiet: true } as any);

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** `a` appears, and before `b`, in `src`. */
const before = (src: string, a: string | RegExp, b: string | RegExp) => {
    const ia = typeof a === 'string' ? src.indexOf(a) : src.search(a);
    const ib = typeof b === 'string' ? src.indexOf(b) : src.search(b);
    return ia >= 0 && ib >= 0 && ia < ib;
};

async function main() {
    console.log('\n=== QA #15 · Tinh nang TAT ma quyen con -> luon bao "dang bao tri" ===\n');

    // ── M1 ──────────────────────────────────────────────────────────────
    console.log('--- M1: co history_page va cau tat vi ---');
    check(resolveStaffFlag({}, 'history_page') === true, 'history_page THIEU = BAT',
        'thieu buoc nay la ca tiem thay "dang bao tri" ngay khi deploy');
    check(resolveStaffFlag({ history_page: false }, 'history_page') === false, 'history_page=false = TAT');
    check(FEATURE_FLAG_DEFS.some(d => d.key === 'history_page'), 'Bang Tinh nang co cot "Trang Lich su"');
    const defaults: Record<string, any> = {
        TYPE_A: DEFAULT_FEATURE_FLAGS_TYPE_A, TYPE_B: DEFAULT_FEATURE_FLAGS_TYPE_B,
        TYPE_C: DEFAULT_FEATURE_FLAGS_TYPE_C, TYPE_D: DEFAULT_FEATURE_FLAGS_TYPE_D,
    };
    for (const [wt, d] of Object.entries(defaults)) {
        check(d.history_page === true, `Mac dinh ${wt} tao moi: history_page = true`);
    }
    for (const w of ['TUA', 'BONUS'] as const) {
        for (const wt of ['TYPE_A', 'TYPE_D']) {
            check(walletDisabledMessage(w, wt) === FEATURE_MAINTENANCE_MESSAGE,
                `Cau tat ${w} (${wt}) = cau bao tri`, walletDisabledMessage(w, wt));
        }
    }

    // ── M2 ──────────────────────────────────────────────────────────────
    console.log('\n--- M2: chan o SERVER ---');
    {
        const hist = read('app/api/ktv/history/route.ts');
        check(/resolveStaffFlag\([^)]*'history_page'\)/.test(hist) && /featureMaintenanceBody\(\)[\s\S]{0,40}status:\s*403/.test(hist),
            'GET /api/ktv/history: tat -> 403 FEATURE_MAINTENANCE');
        check(before(hist, "'history_page'", 'KtvCommissionService.getAllConfigs'),
            'Lich su: kiem co TRUOC khi tinh tien (khong lo so lieu)');

        const hl = read('app/api/ktv/hours-ledger/route.ts');
        check(/resolveStaffFlag\(me\.feature_flags,\s*'history_page'\)/.test(hl) && /featureMaintenanceBody\(\)/.test(hl),
            'GET /api/ktv/hours-ledger: tat -> 403 FEATURE_MAINTENANCE');
        check(/select\('id, work_type, feature_flags'\)/.test(hl), 'So gio doc feature_flags de kiem co');

        const os = read('app/api/ktv/office-score/route.ts');
        check(/applicable:\s*true,\s*disabled:\s*true,\s*data:\s*null/.test(os),
            'Diem Office: Vi Diem tat -> disabled (khong an o, khong lo du lieu)');

        const att = read('app/api/ktv/attendance/route.ts');
        check(before(att, "WalletAccessService.isEnabled(supabase, staffCode, 'TUA')", "from('KTVWithdrawals').insert"),
            'Diem danh: kiem Vi Tua TRUOC khi ghi tin hieu rut');
        check(/wantsToWithdraw && staffCode && !withdrawIntentBlocked/.test(att),
            'Diem danh: Vi Tua tat -> KHONG ghi tin hieu rut (diem danh van thanh cong)');

        const st = read('app/api/ktv/attendance/status/route.ts');
        check(/withdrawWalletOff/.test(st) && (st.match(/withdrawWalletOff \}\);/g) || []).length === 2,
            'attendance/status tra withdrawWalletOff o CA HAI nhanh tra ve');

        const body = { code: FEATURE_MAINTENANCE_CODE, error: FEATURE_MAINTENANCE_MESSAGE };
        check(body.code === 'FEATURE_MAINTENANCE', 'Ma loi = FEATURE_MAINTENANCE');
    }

    // ── M3 ──────────────────────────────────────────────────────────────
    console.log('\n--- M3: CLIENT khong nuot loi ---');
    {
        const logic = read('app/ktv/history/KTVHistory.logic.ts');
        check((logic.match(/isFeatureMaintenanceError\(err\)/g) || []).length >= 2,
            'Hook Lich su + So gio deu bat FEATURE_MAINTENANCE (khong ra "Chua co don" / 0d)');

        const page = read('app/ktv/history/page.tsx');
        check(before(page, "hasPermission('ktv_history')", 'if (maintenance || hours.maintenance)'),
            'Trang Lich su: KHONG quyen -> nhu cu; CO quyen + tat -> bao tri (dung thu tu)');
        check(/<FeatureMaintenanceNotice \/>/.test(page), 'Trang Lich su hien FeatureMaintenanceNotice');

        const sidebar = read('components/layout/Sidebar.tsx');
        check(!/history_page/.test(sidebar), 'Sidebar KHONG an menu vi co (menu van hien, vao trang moi bao)');

        const wpage = read('app/ktv/wallet/page.tsx');
        check(!/Ví đang bảo trì/.test(wpage), 'Trang Vi: bo cau cu "Vi dang bao tri"');
        check(/\(activeTab === 'TUA' && !canViewTua\) \|\| \(activeTab === 'BONUS' && !canViewBonus\)/.test(wpage)
            && /<FeatureMaintenanceNotice \/>/.test(wpage),
            'Trang Vi: vi dang chon bi tat -> FeatureMaintenanceNotice');
        check(/accessError \?/.test(wpage), 'Trang Vi: loi mang KHONG nhan vo la bao tri');
        check(/showTuaEntry && \(/.test(wpage) && /showBonusEntry && \(/.test(wpage),
            'Trang Vi: vi bi tat van con trong danh sach chon');

        const wlogic = read('app/ktv/wallet/KTVWallet.logic.ts');
        check((wlogic.match(/isFeatureMaintenanceError\(e\)/g) || []).length === 2,
            'Rut tien + doi diem: toast dung cau bao tri, bo "Loi:"');
        check(/initialTabResolvedRef/.test(wlogic), 'Chi tu nhay tab o lan tai dau (bam vi tat van thay thong bao)');

        const modal = read('app/ktv/dashboard/_components/modals.tsx');
        check(/res\?\.disabled/.test(modal) && /disabled \? <FeatureMaintenanceNotice \/>/.test(modal),
            'Modal Diem Office: Vi Diem tat giua chung -> thong bao, khong giu so cu');

        const dash = read('app/ktv/dashboard/_screens/ScreenDashboard.tsx');
        check(/logic\.officeScoreDisabled && logic\.canViewWallet/.test(dash),
            'Dashboard: o Diem Office hien bao tri khi CON quyen vi');

        const attPage = read('app/ktv/attendance/page.tsx');
        check(/withdrawShowsMaintenance \?/.test(attPage), 'Cham cong: o "Yeu cau rut tien" -> bao tri khi Vi Tua tat');
    }

    // ── M4 ──────────────────────────────────────────────────────────────
    console.log('\n--- M4: DB Staff.lock_source + trigger (ROLLBACK) ---');
    {
        const c = new Client({ connectionString: process.env.DIRECT_URL });
        await c.connect();
        try {
            const col = await c.query(`SELECT data_type FROM information_schema.columns
                WHERE table_schema='public' AND table_name='Staff' AND column_name='lock_source'`);
            check(col.rows.length === 1, 'Cot Staff.lock_source ton tai');
            const trg = await c.query(`SELECT 1 FROM pg_trigger WHERE tgname='staff_clear_lock_source_trigger'`);
            check(trg.rows.length === 1, 'Trigger staff_clear_lock_source_trigger ton tai');

            await c.query('BEGIN');
            const { rows: [s] } = await c.query(`SELECT id FROM public."Staff" WHERE status='ĐANG LÀM' ORDER BY id LIMIT 1`);
            const get = async () => (await c.query(`SELECT status, lock_source FROM public."Staff" WHERE id=$1`, [s.id])).rows[0];

            await c.query(`UPDATE public."Staff" SET status='KHÓA_TÀI_KHOẢN', lock_source='MANUAL' WHERE id=$1`, [s.id]);
            const a = await get();
            check(a.status === 'KHÓA_TÀI_KHOẢN' && a.lock_source === 'MANUAL', 'Khoa tay: status + MANUAL cung mot cau');

            await c.query(`UPDATE public."Staff" SET status='ĐANG LÀM' WHERE id=$1`, [s.id]);
            check((await get()).lock_source === null, 'Mo khoa (chi doi status) -> trigger xoa lock_source',
                'khong xoa thi lan khoa KY LUAT sau bi hien nham la bao tri');

            await c.query(`UPDATE public."Staff" SET status='KHÓA_TÀI_KHOẢN' WHERE id=$1`, [s.id]);
            check((await get()).lock_source === null, 'Khoa ky luat (writer cu, khong biet cot moi) -> NULL = ky luat');

            let rejected = false;
            try { await c.query(`UPDATE public."Staff" SET lock_source='XYZ' WHERE id=$1`, [s.id]); }
            catch { rejected = true; }
            check(rejected, 'CHECK chan gia tri la');
        } finally {
            await c.query('ROLLBACK').catch(() => {});
            await c.end();
        }

        const { data: working } = await supabase.from('Staff')
            .select('id, feature_flags').eq('status', 'ĐANG LÀM');
        const offNow = (working || []).filter(s => !resolveStaffFlag(s.feature_flags, 'history_page'));
        console.log(`  Dang TAT Trang Lich su luc nay: ${offNow.length} nguoi${offNow.length ? ` (${offNow.map(s => s.id).join(', ')})` : ''}`);
    }

    // ── M5 ──────────────────────────────────────────────────────────────
    console.log('\n--- M5: route khoa tay ---');
    {
        const lock = read('app/api/admin/staff/lock/route.ts');
        check(/\.update\(\{\s*status:\s*'KHÓA_TÀI_KHOẢN',\s*lock_source:\s*'MANUAL'\s*\}\)/.test(lock),
            'Ghi status + lock_source trong CUNG mot UPDATE (khong race)');
        check(/\.eq\('status',\s*'ĐANG LÀM'\)/.test(lock), 'UPDATE co dieu kien status cu (hai admin bam cung luc)');
        check(before(lock, "from('KtvAssignments')", '.update({ status:'),
            'Chan khi dang co don (KtvAssignments) TRUOC khi khoa');
        check(!/KTVDPenaltyLedger/.test(lock.replace(/^\s*(\*|\/\/).*$/gm, '')),
            'KHONG ghi KTVDPenaltyLedger (khoa tay khong phai vi pham)');
        check(/invalidateLockedStaffCache\(\)/.test(lock), 'Xoa cache khoa (API chan ngay, khong doi 20s)');
        check(/event_type:\s*'MANUAL_LOCK'/.test(lock), 'Nhat ky bao mat MANUAL_LOCK');
        check(/message:\s*FEATURE_MAINTENANCE_MESSAGE/.test(lock), 'Thong bao cho KTV = dung cau bao tri');

        const moduleIds = new Set<string>(MODULES.map(m => m.id as string));
        const perm = (lock.match(/requirePermission\('([a-z_]+)'\)/) || [])[1];
        check(!!perm && moduleIds.has(perm), `Quyen route khoa '${perm}' co trong MODULES`,
            'khong co thi admin dung quyen du phong bi chan');

        const logic = read('app/admin/settings/system/KtvFeatures.logic.ts');
        check(/'\/api\/admin\/staff\/unlock'/.test(logic), 'Bat lai = dung route mo khoa cua Office (khong co duong thu hai)');
        const staffApiDirs = fs.readdirSync(path.join(ROOT, 'app/api/admin/staff'));
        check(!staffApiDirs.some(d => /unlock/i.test(d) && d !== 'unlock'), 'Khong co route mo khoa nao khac', staffApiDirs.join(', '));
    }

    // ── M6 ──────────────────────────────────────────────────────────────
    console.log('\n--- M6: moi cho KTV thay "bi khoa" re nhanh theo lock_source ---');
    {
        const login = read('app/login/actions.ts');
        check(before(login, "lockSource === 'MANUAL'", "penalty_type', 'ACCOUNT_LOCK'"),
            'Dang nhap: khoa tay -> cau bao tri, KHONG doc ly do ky luat cu');
        check(/message:\s*FEATURE_MAINTENANCE_MESSAGE/.test(login), 'Dang nhap dung hang so');

        const sc = read('app/api/auth/session-check/route.ts');
        check(/locked,\s*lockKind/.test(sc), 'session-check tra locked + lockKind');

        const ctx = read('lib/auth-context.tsx');
        check(!/if \(!sessionIssuedAt\) return;/.test(ctx), 'Vong hoi chay ca voi phien cu (khong co moc)');
        check(/setLockedInfo\(/.test(ctx) && /addEventListener\('account_locked', check\)/.test(ctx),
            'auth-context giu trang thai khoa TOAN CUC + hoi lai ngay khi API bao khoa');

        const layout = read('components/layout/AppLayout.tsx');
        check(/lockInfo\.kind === 'MANUAL'[\s\S]{0,120}FeatureMaintenanceNotice variant="fullscreen"/.test(layout),
            'AppLayout: khoa tay -> man bao tri toan man hinh');
        check(/contextLockedInfo === null\) \{ setLockInfo\(null\)/.test(layout),
            'AppLayout: server bao het khoa -> go man (khong phu thuoc payload.old)');

        const as = read('lib/auth-server.ts');
        check(/manual \? FEATURE_MAINTENANCE_MESSAGE/.test(as), 'requireActiveStaff: khoa tay -> cau bao tri');

        const st = read('app/api/ktv/attendance/status/route.ts');
        check(/lock_source === 'MANUAL'[\s\S]{0,200}kind: 'MANUAL'/.test(st), 'attendance/status tra kind MANUAL');
        check((st.match(/kind: 'DISCIPLINE'/g) || []).length >= 2, 'Khoa ky luat van tra ly do (kind DISCIPLINE)');
    }

    // ── M7 ──────────────────────────────────────────────────────────────
    console.log('\n--- M7: cau bao tri chi viet cung o MOT cho ---');
    {
        const KTV_FACING = ['app/ktv', 'app/api/ktv', 'app/api/auth', 'app/login', 'components', 'lib'];
        const CONST_FILE = path.normalize('lib/constants/featureMaintenance.i18n.ts');
        const LITERAL = /['"`]Tính năng của bạn đang bảo trì['"`]/;
        const stray: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                const rel = path.join(dir, e.name);
                if (e.isDirectory()) { walk(rel); continue; }
                if (!/\.(ts|tsx)$/.test(e.name) || path.normalize(rel) === CONST_FILE) continue;
                read(rel).split(/\r?\n/).forEach((line, i) => {
                    const tline = line.trim();
                    if (tline.startsWith('//') || tline.startsWith('*') || tline.startsWith('/*')) return;
                    if (LITERAL.test(line)) stray.push(`${rel}:${i + 1}`);
                });
            }
        };
        KTV_FACING.forEach(walk);
        check(stray.length === 0, 'Khong co ban sao viet tay nao ngoai hang so', stray.join(', '));
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
