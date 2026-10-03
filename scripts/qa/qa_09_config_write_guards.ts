/**
 * QA #9 — Mọi đường ghi vào `SystemConfigs` đều phải có lớp canh.
 *
 * `SystemConfigs` là chỗ ở của công tắc ví, khung giá tua, mức phí bảo trì.
 * `/api/admin/settings/system` canh bằng `requirePermission('system_settings')`,
 * nhưng lớp canh đó chỉ có nghĩa khi KHÔNG còn đường vòng nào khác vào cùng cái
 * bảng. Trước đợt này có hai đường vòng để trống:
 *   - `/api/admin/settings/system/advanced` — cả 4 method, ghi/xoá khoá bất kỳ.
 *   - `POST /api/system/config` — ngoài `/api/admin`, upsert khoá bất kỳ.
 *
 * Bốn nhóm kiểm tra:
 *   G1. Mọi route ghi SystemConfigs đều gọi requirePermission.
 *   G2. Route công khai `/api/system/config` chỉ ghi được khoá trong danh sách trắng.
 *   G3. Quyền đem ra dùng phải là quyền CÓ THẬT mà admin/dev thực sự nhận được.
 *   G4. Sửa công tắc qua đường vòng cũng phải bump session epoch như đường chính.
 *
 * Chạy: npx ts-node -O "{\"module\":\"commonjs\"}" scripts/qa/qa_09_config_write_guards.ts
 * KHÔNG chạm DB — chỉ đọc mã nguồn.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MODULES } from '../../lib/constants';
import { finish, fatal } from './_exit';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

/** Cắt một route file thành từng handler để soi riêng từng method. */
function handlersOf(src: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /export async function (GET|POST|PATCH|PUT|DELETE)\s*\(/g;
    const marks: { name: string; at: number }[] = [];
    let m;
    while ((m = re.exec(src)) !== null) marks.push({ name: m[1], at: m.index });
    marks.forEach((mark, i) => {
        out[mark.name] = src.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : src.length);
    });
    return out;
}

const GUARD = /requirePermission|requireBusinessUser|requireAdmin/;

function main() {
    // ── G1: mọi route ghi SystemConfigs đều có lớp canh ─────────────────
    console.log('\n--- G1: moi route ghi SystemConfigs deu co lop canh ---');
    const ROUTES = [
        'app/api/admin/settings/system/route.ts',
        'app/api/admin/settings/system/advanced/route.ts',
        'app/api/system/config/route.ts',
    ];
    const sources: Record<string, string> = {};
    for (const rel of ROUTES) {
        const src = (sources[rel] = read(rel));
        const handlers = handlersOf(src);
        for (const [method, body] of Object.entries(handlers)) {
            // Chỉ soi method GHI. GET của `/api/system/config` cố tình để mở:
            // màn đăng nhập và app KTV đọc nó trước khi có phiên.
            if (method === 'GET') continue;
            check(GUARD.test(body), `${rel} :: ${method} co lop canh`,
                GUARD.test(body) ? '' : 'ghi duoc SystemConfigs ma khong kiem quyen');
        }
    }

    // ── G2: route công khai chỉ ghi được khoá trong danh sách trắng ─────
    console.log('\n--- G2: /api/system/config chi ghi duoc khoa trong danh sach trang ---');
    {
        const src = sources['app/api/system/config/route.ts'];
        const hasList = /WRITABLE_KEYS/.test(src);
        check(hasList, 'Co danh sach trang WRITABLE_KEYS');

        // Khoá lạ phải bị chặn TRƯỚC khi chạm tới upsert.
        const post = handlersOf(src).POST || '';
        const listIdx = post.indexOf('WRITABLE_KEYS[');
        const upsertIdx = post.indexOf('.upsert(');
        check(listIdx >= 0 && upsertIdx >= 0 && listIdx < upsertIdx,
            'Kiem danh sach trang xay ra TRUOC upsert');

        // Và danh sách đó không được lỡ tay ôm công tắc của trang cài đặt.
        const keys = [...src.matchAll(/^\s{4}([a-z0-9_]+):\s*'([a-z_]+)',$/gm)].map(m => [m[1], m[2]]);
        check(keys.length > 0, 'Doc duoc cac khoa trong danh sach trang',
            keys.map(k => k[0]).join(', '));
        for (const [key] of keys) {
            const risky = /^(enable|ktv_|maintenance_|auth_)/.test(key);
            check(!risky, `Khoa '${key}' khong phai cong tac van hanh`,
                risky ? 'khoa nay thuoc trang Cai dat he thong, khong duoc ghi qua route cong khai' : '');
        }
    }

    // ── G3: quyền đem ra dùng phải là quyền có thật ────────────────────
    console.log('\n--- G3: quyen dung trong route phai co that trong MODULES ---');
    {
        // `getFallbackPermissions` dung `MODULES.map(m => m.id)` cho admin/dev.
        // Quyen khong nam trong MODULES la admin bi chan khoi chinh thao tac do.
        const moduleIds = new Set<string>(MODULES.map(m => m.id as string));
        for (const rel of ROUTES) {
            const used = [...sources[rel].matchAll(/requirePermission\(\s*'([a-z_]+)'\s*\)/g)].map(m => m[1]);
            const listed = [...sources[rel].matchAll(/^\s{4}[a-z0-9_]+:\s*'([a-z_]+)',$/gm)].map(m => m[1]);
            for (const p of [...new Set([...used, ...listed])]) {
                check(moduleIds.has(p), `${rel}: quyen '${p}' co trong MODULES`,
                    moduleIds.has(p) ? '' : 'admin/dev se BI CHAN vi fallback dung MODULES.map');
            }
        }
    }

    // ── G4: đường vòng cũng phải bump session epoch ────────────────────
    console.log('\n--- G4: sua cong tac qua duong vong cung phai bump session epoch ---');
    {
        const advanced = sources['app/api/admin/settings/system/advanced/route.ts'];
        check(/scopeForConfigKey/.test(advanced) && /bumpScopes/.test(advanced),
            'Route advanced co bump session epoch',
            'khong bump thi doi cong tac o tab Nang cao se khong da ai ra, may cu giu quyen cu');

        const handlers = handlersOf(advanced);
        for (const method of ['POST', 'PATCH', 'DELETE']) {
            check(/bumpSessionsFor|bumpScopes/.test(handlers[method] || ''),
                `advanced :: ${method} co bump session epoch`);
        }
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

try { main(); } catch (e) { fatal(e); }
