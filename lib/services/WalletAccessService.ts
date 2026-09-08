import { SupabaseClient } from '@supabase/supabase-js';
import {
    WalletType,
    WALLET_TYPES,
    isWalletEnabled,
    walletConfigKey,
    WALLET_DISABLED_MESSAGE,
} from '@/lib/featureFlags';

/**
 * Chặn ví ở TẦNG SERVER.
 *
 * Trước đây cờ `tua_wallet` chỉ được đọc đúng một chỗ ở client
 * (`app/ktv/wallet/KTVWallet.logic.ts`) để ẩn tab. Tắt cờ chỉ ẩn giao diện:
 * gọi thẳng `/api/ktv/wallet/balance` vẫn ra số dư và vẫn rút được tiền.
 * Mọi route ví giờ phải đi qua đây.
 */
export class WalletAccessService {
    /** Đọc quyền của cả 3 ví trong 1 lượt — dùng cho endpoint /wallet/access. */
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
    ): Promise<boolean> {
        const { data: staff } = await supabase
            .from('Staff')
            .select('work_type, feature_flags')
            .eq('id', staffId)
            .maybeSingle();

        if (!staff) return false;
        const configs = await this.getWalletConfigs(supabase, staff.work_type || 'TYPE_A');
        return isWalletEnabled(wallet, staff, configs);
    }

    /**
     * Trả về `null` nếu được phép, hoặc sẵn một `Response` 403 nếu bị chặn —
     * để route chỉ cần `if (denied) return denied;`.
     */
    static async denyIfDisabled(
        supabase: SupabaseClient,
        staffId: string,
        wallet: WalletType,
    ): Promise<Response | null> {
        const ok = await this.isEnabled(supabase, staffId, wallet);
        if (ok) return null;

        return new Response(
            JSON.stringify({
                success: false,
                error: WALLET_DISABLED_MESSAGE[wallet],
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
