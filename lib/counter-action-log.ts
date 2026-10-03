import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ================================================================
 * NHẬT KÝ THAO TÁC TẠI QUẦY
 * ================================================================
 * Ghi lại AI ở quầy đã bấm gì, LÚC NÀO, trên đơn nào.
 *
 * VÌ SAO CẦN
 * Trước đây hệ thống lưu đủ mốc giờ (`pauses[]`, `pauseStart`) nhưng KHÔNG lưu
 * người thao tác, cũng không lưu thời điểm bấm nút. Với một đơn bị huỷ ta chỉ
 * biết "đơn bị huỷ, lý do 'test', KTV mất trắng" — không biết ai quyết và quyết
 * lúc mấy giờ. Có tranh cãi về tiền là không truy được.
 *
 * ⚠️ Phân biệt hai mốc giờ, đừng lẫn:
 *   - `pauseStart`  = lúc bấm TẠM DỪNG. Đây là mốc CHỐT TIỀN.
 *   - `at` ở đây    = lúc bấm nút (Kết thúc / Huỷ / Tiếp…). Chỉ để truy vết,
 *                     TUYỆT ĐỐI không dùng để tính tiền — khoảng giữa hai mốc
 *                     là thời gian quầy cân nhắc, KTV không làm.
 *
 * Lưu vào `BookingItems.options.counterLog[]` nên không cần bảng mới, và đi
 * theo đơn nên xoá đơn là xoá luôn, không để lại rác.
 */

export type CounterAction =
    | 'PAUSE'
    | 'RESUME'
    | 'FINISH_EARLY'
    | 'CANCEL'
    | 'SWAP_KTV'
    /**
     * Đẩy đơn sang người mới ngay sau khi đổi KTV.
     *
     * Về kỹ thuật nó là `resumeItem`, nhưng ghi thành 'Tiếp tục' thì đọc nhật ký
     * ra cảnh quầy bấm tạm dừng rồi tự bấm tiếp tục — không thấy đơn đã sang tay
     * ai. Tách riêng để dòng cuối nói đúng việc: gửi cho người mới, kèm mã họ.
     */
    | 'SWAP_SEND'
    /**
     * KTV reports sent from the app that stop the order ("Khách về sớm",
     * "Báo động khẩn cấp"). The app pauses the order and notifies the counter as
     * two separate calls; without these entries the card only showed "Tạm dừng"
     * and the reason was lost. `by` is the KTV code.
     */
    | 'KTV_EARLY_EXIT'
    | 'KTV_EMERGENCY';

export interface CounterLogEntry {
    action: CounterAction;
    /** Mã nhân viên quầy đã bấm. `null` khi không xác định được phiên đăng nhập. */
    by: string | null;
    /** Tên hiển thị, chụp lại lúc bấm để sau này đổi tên không mất dấu. */
    byName?: string | null;
    /** Lúc bấm nút — KHÔNG phải mốc chốt tiền. */
    at: string;
    /** Ghi chú tự do: lý do huỷ, KTV mới khi đổi người… */
    note?: string | null;
    /**
     * `false` = người bấm lấy từ header tự khai của tab (request không mang JWT),
     * thẻ Kanban in kèm dấu `*`. Thiếu / `true` = xác nhận bằng phiên máy chủ.
     */
    verified?: boolean;
}

export interface CounterActor {
    id: string | null;
    name: string | null;
    verified: boolean;
}

const NO_ACTOR: CounterActor = { id: null, name: null, verified: false };
const ACTOR_FIELD_MAX_LEN = 64;

/**
 * Người đang mở tab, do trình duyệt tự khai qua header `x-spa-actor`
 * (lib/apiClient.ts). Chỉ đọc khi KHÔNG có JWT, và chỉ để ghi nhật ký.
 */
async function actorFromHeader(): Promise<CounterActor> {
    try {
        const { headers } = await import('next/headers');
        const raw = (await headers()).get('x-spa-actor');
        if (!raw) return NO_ACTOR;
        const parsed = JSON.parse(decodeURIComponent(raw));
        const id = typeof parsed?.id === 'string' ? parsed.id.trim().slice(0, ACTOR_FIELD_MAX_LEN) : '';
        const name = typeof parsed?.name === 'string' ? parsed.name.trim().slice(0, ACTOR_FIELD_MAX_LEN) : '';
        if (!id) return NO_ACTOR;
        return { id, name: name || id, verified: false };
    } catch {
        return NO_ACTOR;
    }
}

/**
 * Lấy người đang đăng nhập ở quầy. Không chặn luồng chính nếu không lấy được.
 *
 * ⚠️ `id` của tài khoản văn phòng là một cuid dài ('cmlxhhysl0000d76c7xvak9gs'),
 * KHÔNG phải mã nhân viên. Thẻ Kanban rơi về hiển thị `id` khi thiếu `name`, nên
 * trước 09/09/2026 nhật ký hiện nguyên chuỗi cuid thay vì 'admin' / 'dev'.
 * Vì vậy `name` phải luôn có: username → tra bảng Users → cuối cùng là techCode.
 *
 * Không có JWT (hết hạn, hoặc máy dùng chung bị người khác đăng nhập đè cookie —
 * cookie khoá theo tên máy chủ, không theo tab) → trước 14/09/2026 trả `null` và
 * thẻ in "không rõ người bấm" dù quầy vẫn đang ngồi đó. Nay rơi về header tự
 * khai của tab, đánh dấu `verified: false`.
 */
export async function currentCounterActor(): Promise<CounterActor> {
    try {
        const { requireBusinessUser } = await import('@/lib/auth-server');
        const u = await requireBusinessUser();
        if (!u) return actorFromHeader();

        const id = u.businessUserId || u.techCode || null;
        let name = u.username || null;

        // Phiên cũ chưa map được username thì tra thẳng bảng Users theo id.
        if (!name && id) {
            const { getSupabaseAdmin } = await import('@/lib/supabaseAdmin');
            const sb = getSupabaseAdmin();
            if (sb) {
                const { data } = await sb.from('Users').select('username').eq('id', id).maybeSingle();
                name = (data as any)?.username || null;
            }
        }

        return { id, name: name || u.techCode || null, verified: true };
    } catch {
        return actorFromHeader();
    }
}

/**
 * Nối thêm một dòng nhật ký vào `options.counterLog` của các dịch vụ.
 *
 * Cố ý KHÔNG throw: mất một dòng nhật ký thì chấp nhận được, còn để nó làm hỏng
 * việc huỷ đơn hay kết thúc đơn thì không.
 */
export async function logCounterAction(
    supabase: SupabaseClient,
    itemIds: string[],
    entry: Omit<CounterLogEntry, 'at'> & { at?: string }
): Promise<void> {
    if (!itemIds || itemIds.length === 0) return;
    const row: CounterLogEntry = { ...entry, at: entry.at || new Date().toISOString() };

    try {
        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, options')
            .in('id', itemIds);

        for (const it of items || []) {
            let opts: any = (it as any).options;
            if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { opts = {}; } }
            opts = opts || {};
            const log = Array.isArray(opts.counterLog) ? opts.counterLog : [];
            log.push(row);
            opts.counterLog = log;

            await supabase.from('BookingItems').update({ options: opts }).eq('id', it.id);
        }
    } catch (e: any) {
        console.error('[counterLog] không ghi được nhật ký thao tác quầy:', e?.message || e);
    }
}

/**
 * Log a KTV report ("Khách về sớm" / "Khẩn cấp") on the items that KTV is serving
 * in this booking — preferring the ones still running or paused.
 * Never throws: a lost log line must not break the report itself.
 */
export async function logKtvReport(
    supabase: SupabaseClient,
    bookingId: string,
    techCode: string | null,
    action: 'KTV_EARLY_EXIT' | 'KTV_EMERGENCY'
): Promise<void> {
    try {
        const { data: items } = await supabase
            .from('BookingItems')
            .select('id, status, "technicianCodes"')
            .eq('bookingId', bookingId);

        const all = (items || []) as any[];
        const code = String(techCode || '').trim().toUpperCase();
        const mine = code
            ? all.filter(i => (i.technicianCodes || []).some((c: string) => String(c).trim().toUpperCase() === code))
            : [];
        const pool = mine.length > 0 ? mine : all;
        const live = pool.filter(i => ['IN_PROGRESS', 'PAUSED'].includes(String(i.status)));
        const targetIds = (live.length > 0 ? live : pool).map(i => i.id);

        await logCounterAction(supabase, targetIds, { action, by: techCode, byName: techCode });
    } catch (e: any) {
        console.error('[counterLog] không ghi được báo của KTV:', e?.message || e);
    }
}
