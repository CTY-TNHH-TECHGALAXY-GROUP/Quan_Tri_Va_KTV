/**
 * Single source of truth for the KTV wallet / screen switches.
 *
 * The server gates (WalletAccessService, the History route, check-in) and the
 * admin Features table all read flags through here, so a missing flag means
 * the same thing everywhere. Before this, the KTV app read
 * `enable_bonus_wallet` while the admin table toggled `bonus_wallet` — two
 * switches for one wallet, and Ví Tua had no switch at all.
 */
import { FEATURE_MAINTENANCE_MESSAGE } from '@/lib/constants/featureMaintenance.i18n';

/** What a flag means when it is absent from `Staff.feature_flags`. */
export const FLAG_DEFAULT_WHEN_MISSING: Record<string, boolean> = {
    // Every KTV created before these switches existed has no key. Resolving a
    // missing key to OFF would show "bảo trì" to the whole shop on deploy.
    tua_wallet: true,
    history_page: true,
    // Ví Bonus was always opt-in (the app used to read `enable_bonus_wallet === true`).
    bonus_wallet: false,
};

/** Legacy keys still in the DB, read as aliases. An explicitly set new key wins. */
const FLAG_ALIASES: Record<string, string[]> = {
    bonus_wallet: ['enable_bonus_wallet'],
};

/**
 * Read one staff flag. `flags` may be an object, a JSON string, or null.
 */
export function resolveStaffFlag(flags: any, key: string): boolean {
    const parsed = parseFlags(flags);
    const candidates = [key, ...(FLAG_ALIASES[key] || [])];

    for (const k of candidates) {
        const raw = parsed?.[k];
        if (raw === undefined || raw === null || raw === '') continue;
        if (typeof raw === 'boolean') return raw;
        return String(raw).replace(/"/g, '').toLowerCase() === 'true';
    }

    return FLAG_DEFAULT_WHEN_MISSING[key] ?? false;
}

function parseFlags(flags: any): Record<string, any> {
    if (!flags) return {};
    if (typeof flags === 'string') {
        try { return JSON.parse(flags) || {}; } catch { return {}; }
    }
    return flags as Record<string, any>;
}

// ---------------------------------------------------------------------------
// Wallets: two-level switch (whole work type AND the individual KTV)
// ---------------------------------------------------------------------------

export type WalletType = 'TUA' | 'BONUS';

export const WALLET_TYPES: WalletType[] = ['TUA', 'BONUS'];

/** Per-staff flag for each wallet. */
export const WALLET_STAFF_FLAG: Record<WalletType, string> = {
    TUA: 'tua_wallet',
    BONUS: 'bonus_wallet',
};

export const WALLET_LABEL: Record<WalletType, string> = {
    TUA: 'Ví Tua',
    BONUS: 'Ví Bonus',
};

/**
 * Ví Bonus only exists for Types A and B (owner rule, 14/09/2026). Types C/D
 * never have it — not even as a "maintenance" entry. Ví Tua exists for all.
 */
const BONUS_WALLET_WORK_TYPES = ['TYPE_A', 'TYPE_B'];

export function workTypeHasWallet(wallet: WalletType, workType: string | null | undefined): boolean {
    if (wallet === 'TUA') return true;
    return BONUS_WALLET_WORK_TYPES.includes(workType || 'TYPE_A');
}

/** SystemConfigs key of the type-wide switch, e.g. `ktv_wallet_tua_enabled_TYPE_B`. */
export function walletConfigKey(wallet: WalletType, workType: string): string {
    return `ktv_wallet_${wallet.toLowerCase()}_enabled_${workType}`;
}

/**
 * Read a switch stored in `SystemConfigs.value`.
 *
 * That column is jsonb written from several paths, so the same switch can come
 * back as `true`, `"true"` or `'"true"'`. Comparing `=== true` would silently
 * read an ON switch as OFF. Missing key → `fallback`.
 */
export function readConfigBool(raw: any, fallback: boolean): boolean {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw === 'boolean') return raw;
    return String(raw).replace(/"/g, '').toLowerCase() === 'true';
}

/**
 * Type-wide switch. Missing key = ON: before this feature there was no
 * type-level gate, so the default must keep the old behaviour.
 */
export function isWalletEnabledForType(
    wallet: WalletType,
    workType: string | null | undefined,
    configs: Record<string, any> | null | undefined,
): boolean {
    const type = workType || 'TYPE_A';
    if (!workTypeHasWallet(wallet, type)) return false;
    return readConfigBool(configs?.[walletConfigKey(wallet, type)], true);
}

/**
 * Final answer — can this KTV use the wallet: **type switch ON and the KTV's
 * own flag ON**. Off at the type level takes the wallet from the whole type
 * without touching anyone's flag; off per person affects only that person.
 */
export function isWalletEnabled(
    wallet: WalletType,
    staff: { work_type?: string | null; feature_flags?: any } | null | undefined,
    configs: Record<string, any> | null | undefined,
): boolean {
    if (!staff) return false;
    return (
        isWalletEnabledForType(wallet, staff.work_type, configs) &&
        resolveStaffFlag(staff.feature_flags, WALLET_STAFF_FLAG[wallet])
    );
}

/** Text every wallet route returns when a wallet is switched off. */
export function walletDisabledMessage(): string {
    return FEATURE_MAINTENANCE_MESSAGE;
}
