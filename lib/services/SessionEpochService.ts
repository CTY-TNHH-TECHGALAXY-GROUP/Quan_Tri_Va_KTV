import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ép đăng xuất khi cấu hình đổi.
 *
 * Vấn đề: session được giữ trong sessionStorage/localStorage của máy KTV.
 * Máy nào không đăng xuất — app chạy nền cả tuần — vẫn giữ role/permission cũ
 * trong storage, nên tắt tính năng bên admin xong họ vẫn thấy menu cũ.
 *
 * Cách làm: mỗi session mang theo `session_issued_at` (lúc đăng nhập). Admin
 * đổi cấu hình thì "mốc" tương ứng được đẩy lên `now()`. Client hỏi lại định
 * kỳ; mốc nào mới hơn lúc đăng nhập thì session đó hết hiệu lực.
 *
 *   · đổi cho MỘT người   → `Staff.session_epoch` của người đó   → mình người đó ra
 *   · đổi cho MỘT loại    → mốc `TYPE_x` trong `auth_session_epoch` → cả loại ra
 *   · đổi cấu hình chung  → mốc `ALL`                             → tất cả ra
 */

export const SESSION_EPOCH_CONFIG_KEY = 'auth_session_epoch';

/**
 * Cần gạt tổng. TẮT (mặc định) = đổi cấu hình KHÔNG đá ai ra, thay đổi áp dụng
 * ở lần đăng nhập kế tiếp của họ.
 *
 * Mặc định tắt là cố ý: bật tính năng này giữa ca đang chạy thì cả tiệm bị văng
 * ra màn hình đăng nhập cùng lúc. Quản lý bật khi rảnh tay, không phải lúc
 * deploy tự quyết.
 */
export const FORCE_LOGOUT_ENABLED_KEY = 'auth_force_logout_enabled';

export type EpochScope = 'ALL' | 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';

export interface SessionCheckResult {
    mustLogout: boolean;
    /** Mốc đã làm session hết hiệu lực — hữu ích khi debug. */
    epoch?: string;
    scope?: EpochScope | 'STAFF';
}

export class SessionEpochService {
    /** Cần gạt tổng có đang bật không. Thiếu khoá = TẮT. */
    static async isForceLogoutEnabled(supabase: SupabaseClient): Promise<boolean> {
        const { data } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', FORCE_LOGOUT_ENABLED_KEY)
            .maybeSingle();

        const raw = data?.value;
        if (raw === undefined || raw === null || raw === '') return false;
        if (typeof raw === 'boolean') return raw;
        return String(raw).replace(/"/g, '').toLowerCase() === 'true';
    }

    /** Đẩy mốc cho từng nhân viên cụ thể. Chỉ những người này bị đăng xuất. */
    static async bumpStaff(supabase: SupabaseClient, staffIds: string[]): Promise<string[]> {
        const ids = (staffIds || []).filter(Boolean);
        if (ids.length === 0) return [];
        // Cần gạt tổng đang tắt thì KHÔNG ghi mốc — ghi rồi thì lúc bật lên
        // đống mốc cũ sẽ đá văng cả tiệm cùng một lúc.
        if (!(await this.isForceLogoutEnabled(supabase))) return [];

        const { error } = await supabase
            .from('Staff')
            .update({ session_epoch: new Date().toISOString() })
            .in('id', ids);

        // Không chặn luồng chính: cấu hình đã lưu xong rồi, đây chỉ là chuyện
        // đẩy người dùng ra sớm. Hỏng thì họ nhận thay đổi ở lần login sau.
        if (error) {
            console.error('[SessionEpoch] bumpStaff lỗi:', error.message);
            return [];
        }
        return ids;
    }

    /** Đẩy mốc cho cả một loại KTV, hoặc `ALL` cho toàn hệ thống. */
    static async bumpScopes(supabase: SupabaseClient, scopes: EpochScope[]): Promise<EpochScope[]> {
        const unique = Array.from(new Set((scopes || []).filter(Boolean)));
        if (unique.length === 0) return [];
        if (!(await this.isForceLogoutEnabled(supabase))) return [];

        const current = await this.getScopeEpochs(supabase);
        const now = new Date().toISOString();
        unique.forEach(s => { current[s] = now; });

        const { error } = await supabase
            .from('SystemConfigs')
            .upsert(
                { key: SESSION_EPOCH_CONFIG_KEY, value: current, updated_at: now },
                { onConflict: 'key' },
            );

        if (error) {
            console.error('[SessionEpoch] bumpScopes lỗi:', error.message);
            return [];
        }
        return unique;
    }

    static async getScopeEpochs(supabase: SupabaseClient): Promise<Record<string, string>> {
        const { data } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', SESSION_EPOCH_CONFIG_KEY)
            .maybeSingle();

        const raw = data?.value;
        if (!raw) return {};
        if (typeof raw === 'string') {
            try { return JSON.parse(raw) || {}; } catch { return {}; }
        }
        return (raw as Record<string, string>) || {};
    }

    /**
     * Session cấp lúc `issuedAt` còn hiệu lực không.
     * Thiếu `issuedAt` (session cũ, cấp trước khi có tính năng này) thì cho
     * qua — nếu không thì bản deploy đầu tiên sẽ đá văng toàn bộ người đang
     * dùng, kể cả khi admin chưa đổi gì.
     */
    static async check(
        supabase: SupabaseClient,
        staffId: string,
        issuedAt: string | null | undefined,
    ): Promise<SessionCheckResult> {
        if (!issuedAt) return { mustLogout: false };

        const issuedMs = Date.parse(issuedAt);
        if (Number.isNaN(issuedMs)) return { mustLogout: false };

        const [{ data: staff }, scopeEpochs] = await Promise.all([
            supabase.from('Staff').select('work_type, session_epoch').eq('id', staffId).maybeSingle(),
            this.getScopeEpochs(supabase),
        ]);

        const candidates: Array<{ scope: EpochScope | 'STAFF'; at?: string | null }> = [
            { scope: 'STAFF', at: staff?.session_epoch },
            { scope: 'ALL', at: scopeEpochs['ALL'] },
            { scope: (staff?.work_type as EpochScope) || 'TYPE_A', at: scopeEpochs[staff?.work_type || 'TYPE_A'] },
        ];

        for (const c of candidates) {
            if (!c.at) continue;
            const ms = Date.parse(String(c.at));
            if (!Number.isNaN(ms) && ms > issuedMs) {
                return { mustLogout: true, epoch: String(c.at), scope: c.scope };
            }
        }

        return { mustLogout: false };
    }
}

/**
 * Khoá cấu hình nào đáng để đá người dùng ra.
 *
 * Chỉ các CÔNG TẮC bật/tắt tính năng — đổi đơn giá hay số tiền phạt thì API
 * đọc lúc tính, không nằm trong session, đăng xuất cả nhà chỉ tổ phiền.
 * Trả `null` nghĩa là khoá đó không cần đăng xuất ai.
 */
export function scopeForConfigKey(key: string): EpochScope | null {
    // Chính hai khoá của cơ chế này thì không được tự kích hoạt nó — bật cần
    // gạt tổng mà lại đá cả tiệm ra ngay lúc bật thì hỏng cả ý nghĩa.
    if (key === FORCE_LOGOUT_ENABLED_KEY || key === SESSION_EPOCH_CONFIG_KEY) return null;

    const isSwitch = /(^|_)(enable|enabled|disabled)(_|$)/.test(key);
    if (!isSwitch) return null;

    const m = key.match(/_(TYPE_[ABCD])$/);
    if (m) return m[1] as EpochScope;

    // Loại D có một mớ khoá đặt tên kiểu `ktv_type_d_*_enabled` — không có
    // đuôi `_TYPE_D` nhưng vẫn chỉ là chuyện của loại D, đừng đá cả nhà ra.
    if (/(^|_)type_d(_|$)/i.test(key)) return 'TYPE_D';

    return 'ALL';
}
