/**
 * QA — promotion permissions (plans/plan_promotion_permissions.md). No DB.
 *
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_promotion_permissions.ts
 *
 * 1. promotionCan(): every permission opens exactly its actions; `promotions` opens all;
 *    dispatch_board opens nothing.
 * 2. Static guard check: every promotion route method calls authorizePromotion('<action>')
 *    with a known action, and none still uses requirePermission / dispatch_board.
 */
import fs from 'node:fs';
import path from 'node:path';
import { finish, fatal } from './_exit';
import {
    PROMOTION_ACTION_PERMISSIONS, PROMOTION_FULL_PERMISSION, PROMOTION_PERMISSIONS, promotionCan, type PromotionAction,
} from '@/lib/constants/promotion';

let failures = 0;
let passes = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { passes++; console.log(`  ✅ ${name}`); }
    else { failures++; console.log(`  ❌ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); }
};

const ACTIONS = Object.keys(PROMOTION_ACTION_PERMISSIONS) as PromotionAction[];
const allowed = (perms: string[]) => ACTIONS.filter(a => promotionCan(perms, a)).sort();

function main() {
    console.log('=== QA Promotion permissions ===');
    console.log('\n[promotionCan]');
    check('5 permissions in the catalogue', PROMOTION_PERMISSIONS.length === 5 && PROMOTION_PERMISSIONS.every(p => p.id.startsWith('promotions_')));
    check('receptionist with only "Quét & áp" → scan / apply / cancel use only', JSON.stringify(allowed(['dispatch_board', 'promotions_scan_apply'])) === '["scan.apply"]',
        allowed(['promotions_scan_apply']));
    check('"Quét & áp" cannot override, see owner PII, list vouchers, issue or manage campaigns',
        !['apply.override', 'customer.pii', 'pass.view', 'pass.issue', 'campaign.manage', 'campaign.read'].some(a => promotionCan(['promotions_scan_apply'], a as PromotionAction)));
    check('"Áp ngoại lệ" → apply.override only', JSON.stringify(allowed(['promotions_override'])) === '["apply.override"]', allowed(['promotions_override']));
    check('"Xem voucher & lịch sử" → view + campaign read + owner PII', JSON.stringify(allowed(['promotions_view'])) === '["campaign.read","customer.pii","pass.view"]', allowed(['promotions_view']));
    check('"Phát voucher" → issue + campaign read + owner PII (not the full list)', JSON.stringify(allowed(['promotions_issue'])) === '["campaign.read","customer.pii","pass.issue"]', allowed(['promotions_issue']));
    check('"Quản lý chương trình" → manage + read', JSON.stringify(allowed(['promotions_campaign_manage'])) === '["campaign.manage","campaign.read"]', allowed(['promotions_campaign_manage']));
    check(`"${PROMOTION_FULL_PERMISSION}" (full access) → every action`, allowed([PROMOTION_FULL_PERMISSION]).length === ACTIONS.length);
    check('dispatch_board / no permission → nothing', allowed(['dispatch_board']).length === 0 && allowed([]).length === 0 && !promotionCan(null, 'scan.apply'));

    console.log('\n[route guards]');
    const roots = ['app/api/admin/promotions', 'app/api/promotion-passes', 'app/api/promotion-usages', 'app/api/customers/[id]/promotions'];
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p); else if (e.name === 'route.ts') files.push(p);
        }
    };
    roots.forEach(r => fs.existsSync(r) && walk(r));
    check('found the promotion routes', files.length >= 17, files.length);
    const problems: string[] = [];
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        const methods = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? [];
        const guards = [...src.matchAll(/authorizePromotion\('([a-z.]+)'\)/g)].map(m => m[1]);
        if (guards.length !== methods.length) problems.push(`${f}: ${methods.length} methods / ${guards.length} guards`);
        guards.filter(a => !(ACTIONS as string[]).includes(a)).forEach(a => problems.push(`${f}: unknown action ${a}`));
        if (/requirePermission|dispatch_board|PROMOTION_(ADMIN|COUNTER)_PERMISSION/.test(src)) problems.push(`${f}: old permission check`);
    }
    check('every route method guarded by a known action; no requirePermission / dispatch_board left', problems.length === 0, problems);
    const routeGuard = fs.readFileSync('lib/promotion-route.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    check('guard never falls back to "allow without session"', !/AUTH_ENFORCE|requirePermission\(/.test(routeGuard) && /getSessionAccess/.test(routeGuard));
}

try { main(); } catch (e) { failures++; fatal(e); }
console.log(`\n=== ${failures === 0 ? 'DAT' : 'KHONG DAT'} — ${passes} pass, ${failures} fail ===`);
finish(failures);
