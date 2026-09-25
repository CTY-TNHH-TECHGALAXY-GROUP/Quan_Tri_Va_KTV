/**
 * QA — wallet switches + History maintenance ported to main.
 *
 * Part 1: truth table of lib/featureFlags (pure, no DB).
 * Part 2: maintenance error helpers.
 * Part 3: READ-ONLY simulation on real data — what each working KTV sees
 *         today (old main) vs after deploy. Writes nothing.
 *
 * Run (from repo root):  npx tsx scripts/qa/qa_wallet_switch_main.ts
 * Env: reads .env.local (or ENV_FILE=<path>).
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
    resolveStaffFlag,
    isWalletEnabled,
    isWalletEnabledForType,
    workTypeHasWallet,
    walletConfigKey,
} from '@/lib/featureFlags';
import { featureMaintenanceBody, isFeatureMaintenanceError } from '@/lib/featureMaintenance';
import { ApiError } from '@/lib/apiClient';
import { FEATURE_MAINTENANCE_MESSAGE } from '@/lib/constants/featureMaintenance.i18n';

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? '  ✅' : '  ❌'} ${name}${ok ? '' : ` — got ${String(actual)}, expected ${String(expected)}`}`);
};

// ─── Part 1: truth table ──────────────────────────────────────────────────
console.log('\n=== Part 1: featureFlags truth table ===');

check('missing tua_wallet = ON', resolveStaffFlag({}, 'tua_wallet'), true);
check('missing history_page = ON', resolveStaffFlag({}, 'history_page'), true);
check('missing bonus_wallet = OFF', resolveStaffFlag({}, 'bonus_wallet'), false);
check('null flags → defaults', resolveStaffFlag(null, 'tua_wallet'), true);
check('JSON string flags', resolveStaffFlag('{"tua_wallet":false}', 'tua_wallet'), false);
check('string "false"', resolveStaffFlag({ history_page: 'false' }, 'history_page'), false);
check('string \'"true"\'', resolveStaffFlag({ tua_wallet: '"true"' }, 'tua_wallet'), true);
check('alias enable_bonus_wallet=true → ON', resolveStaffFlag({ enable_bonus_wallet: true }, 'bonus_wallet'), true);
check('explicit bonus_wallet=false beats alias', resolveStaffFlag({ bonus_wallet: false, enable_bonus_wallet: true }, 'bonus_wallet'), false);

check('TYPE_A has Ví Bonus', workTypeHasWallet('BONUS', 'TYPE_A'), true);
check('TYPE_B has Ví Bonus', workTypeHasWallet('BONUS', 'TYPE_B'), true);
check('TYPE_C has NO Ví Bonus', workTypeHasWallet('BONUS', 'TYPE_C'), false);
check('TYPE_D has NO Ví Bonus', workTypeHasWallet('BONUS', 'TYPE_D'), false);
check('every type has Ví Tua', ['TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'].every(t => workTypeHasWallet('TUA', t)), true);
check('null work_type treated as TYPE_A', workTypeHasWallet('BONUS', null), true);

check('config key format', walletConfigKey('TUA', 'TYPE_B'), 'ktv_wallet_tua_enabled_TYPE_B');
check('type switch missing = ON', isWalletEnabledForType('TUA', 'TYPE_B', {}), true);
check('type switch false (jsonb bool)', isWalletEnabledForType('TUA', 'TYPE_B', { ktv_wallet_tua_enabled_TYPE_B: false }), false);
check('type switch "false" (jsonb string)', isWalletEnabledForType('TUA', 'TYPE_B', { ktv_wallet_tua_enabled_TYPE_B: 'false' }), false);
check('type switch \'"true"\'', isWalletEnabledForType('TUA', 'TYPE_B', { ktv_wallet_tua_enabled_TYPE_B: '"true"' }), true);
check('D bonus forced OFF even with switch ON', isWalletEnabledForType('BONUS', 'TYPE_D', { ktv_wallet_bonus_enabled_TYPE_D: true }), false);

const staffB = { work_type: 'TYPE_B', feature_flags: { tua_wallet: true, bonus_wallet: true } };
check('B: type ON + staff ON → ON', isWalletEnabled('TUA', staffB, {}), true);
check('B: type OFF + staff ON → OFF', isWalletEnabled('TUA', staffB, { ktv_wallet_tua_enabled_TYPE_B: false }), false);
check('B: type ON + staff OFF → OFF', isWalletEnabled('TUA', { ...staffB, feature_flags: { tua_wallet: false } }, {}), false);
check('B: other type switch does not leak', isWalletEnabled('TUA', staffB, { ktv_wallet_tua_enabled_TYPE_A: false }), true);
check('D with bonus_wallet=true still OFF', isWalletEnabled('BONUS', { work_type: 'TYPE_D', feature_flags: { bonus_wallet: true } }, {}), false);
check('no staff row → OFF', isWalletEnabled('TUA', null, {}), false);

// ─── Part 2: maintenance helpers ──────────────────────────────────────────
console.log('\n=== Part 2: maintenance error helpers ===');
const body = featureMaintenanceBody();
check('body.code', body.code, 'FEATURE_MAINTENANCE');
check('body.error is the shared sentence', body.error, FEATURE_MAINTENANCE_MESSAGE);
check('ApiError FEATURE_MAINTENANCE → maintenance', isFeatureMaintenanceError(new ApiError('x', 403, 'FEATURE_MAINTENANCE')), true);
check('ApiError WALLET_DISABLED → maintenance', isFeatureMaintenanceError(new ApiError('x', 403, 'WALLET_DISABLED')), true);
check('network error is NOT maintenance', isFeatureMaintenanceError(new Error('Failed to fetch')), false);
check('500 without code is NOT maintenance', isFeatureMaintenanceError(new ApiError('x', 500)), false);

// ─── Part 3: real data, read-only ─────────────────────────────────────────
const loadEnv = (): Record<string, string> => {
    const file = process.env.ENV_FILE || path.resolve(process.cwd(), '.env.local');
    const env: Record<string, string> = {};
    if (!fs.existsSync(file)) return env;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(l => {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
    return env;
};

const simulateRealData = async () => {
    console.log('\n=== Part 3: real data (read-only) — today vs after deploy ===');
    const env = loadEnv();
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
        console.log('  ⚠️  No .env.local — skipped');
        return;
    }
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    const [{ data: staff }, { data: users }, { data: cfgRows }] = await Promise.all([
        sb.from('Staff').select('id, work_type, status, feature_flags').eq('status', 'ĐANG LÀM'),
        sb.from('Users').select('code, role, permissions'),
        sb.from('SystemConfigs').select('key, value').ilike('key', 'ktv_wallet_%_enabled_%'),
    ]);
    const configs: Record<string, any> = {};
    (cfgRows || []).forEach((c: any) => { configs[c.key] = c.value; });
    const userByCode = new Map((users || []).map((u: any) => [u.code, u]));

    // What a KTV sees for one entry: OK / BẢO TRÌ (entry kept) / – (hidden)
    const label = (hasPerm: boolean, entryExists: boolean, enabled: boolean) =>
        !hasPerm || !entryExists ? '–' : enabled ? 'OK' : 'BẢO TRÌ';

    const rows: string[] = [];
    for (const s of (staff || []).sort((a: any, b: any) => (a.work_type + a.id).localeCompare(b.work_type + b.id))) {
        const u: any = userByCode.get(s.id);
        if (!u || u.role !== 'TECHNICIAN') continue;
        const perms: string[] = Array.isArray(u.permissions) ? u.permissions : [];
        const walletPerm = perms.includes('ktv_wallet');
        const historyPerm = perms.includes('ktv_history');
        const type = s.work_type || 'TYPE_A';

        // Old main: Tua = permission only; Bonus = enable_bonus_wallet === true; History = permission only.
        const oldTua = label(walletPerm, true, true);
        const oldBonus = label(walletPerm, s.feature_flags?.enable_bonus_wallet === true, true);
        const oldHistory = label(historyPerm, true, true);

        const tuaOn = isWalletEnabled('TUA', s, configs);
        const bonusOn = isWalletEnabled('BONUS', s, configs);
        const newTua = label(walletPerm, true, tuaOn);
        // Bonus entry exists when enabled or the type owns a Ví Bonus (A/B).
        const newBonus = label(walletPerm, bonusOn || workTypeHasWallet('BONUS', type), bonusOn);
        const newHistory = label(historyPerm, true, resolveStaffFlag(s.feature_flags, 'history_page'));

        const changed = oldTua !== newTua || oldBonus !== newBonus || oldHistory !== newHistory;
        rows.push(`  ${type} ${String(s.id).padEnd(7)} Tua ${oldTua.padEnd(7)}→ ${newTua.padEnd(7)} | Bonus ${oldBonus.padEnd(7)}→ ${newBonus.padEnd(7)} | LịchSử ${oldHistory.padEnd(7)}→ ${newHistory.padEnd(7)}${changed ? '  ◀ đổi' : ''}`);
    }
    console.log('  (– = không có mục; BẢO TRÌ = còn mục, hiện "Tính năng của bạn đang bảo trì")');
    rows.forEach(r => console.log(r));
};

simulateRealData()
    .then(() => {
        console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch(err => { console.error(err); process.exit(1); });
