import { SupabaseClient } from '@supabase/supabase-js';
import {
    WalletType,
    WALLET_TYPES,
    isWalletEnabled,
    walletConfigKey,
    walletDisabledMessage,
} from '@/lib/featureFlags';

/**
 * Wallet gate at the SERVER level.
 *
 * The wallet used to be hidden only in the client (a tab condition), so
 * calling `/api/ktv/wallet/balance` directly still returned the balance and a
 * withdrawal still went through. Every wallet route must pass through here.
 *
 * This gates viewing / withdrawing / redeeming only. Commission and bonus keep
 * being written to the ledger; finance screens never call this.
 */
export class WalletAccessService {
    /** Access to every wallet in one read — used by /api/ktv/wallet/access. */
    static async getAccess(
        supabase: SupabaseClient,
        staffId: string,
    ): Promise<Record<WalletType, boolean> & { work_type: string }> {
        const { data: staff } = await supabase
            .from('Staff')
            .select('work_type, feature_flags')
            .eq('id', staffId)
            .maybeSingle();

        const configs = await this.getWalletConfigs(supabase, staff?.work_type || 'TYPE_A');

        const result: any = { work_type: staff?.work_type || 'TYPE_A' };
        for (const w of WALLET_TYPES) {
            result[w] = staff ? isWalletEnabled(w, staff, configs) : false;
        }
        return result;
    }

    static async isEnabled(
        supabase: SupabaseClient,
        staffId: string,
        wallet: WalletType,
    ): Promise<{ ok: boolean; workType: string }> {
        const { data: staff } = await supabase
            .from('Staff')
            .select('work_type, feature_flags')
            .eq('id', staffId)
            .maybeSingle();

        const workType = staff?.work_type || 'TYPE_A';
        if (!staff) return { ok: false, workType };

        const configs = await this.getWalletConfigs(supabase, workType);
        return { ok: isWalletEnabled(wallet, staff, configs), workType };
    }

    /**
     * `null` when allowed, otherwise a ready 403 `Response` — so a route only
     * needs `if (denied) return denied;`.
     */
    static async denyIfDisabled(
        supabase: SupabaseClient,
        staffId: string,
        wallet: WalletType,
    ): Promise<Response | null> {
        const { ok } = await this.isEnabled(supabase, staffId, wallet);
        if (ok) return null;

        return new Response(
            JSON.stringify({
                success: false,
                error: walletDisabledMessage(),
                code: 'WALLET_DISABLED',
                wallet,
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
    }

    private static async getWalletConfigs(
        supabase: SupabaseClient,
        workType: string,
    ): Promise<Record<string, any>> {
        const keys = WALLET_TYPES.map(w => walletConfigKey(w, workType));
        const { data } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', keys);

        const configs: Record<string, any> = {};
        (data || []).forEach((c: any) => { configs[c.key] = c.value; });
        return configs;
    }
}
