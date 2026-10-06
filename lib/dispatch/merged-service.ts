/**
 * GHÉP 2 DỊCH VỤ ("Gộp chung KTV") — một nguồn duy nhất cho mọi chỗ đụng tới dịch vụ đã ghép.
 *
 * Thuật ngữ (user chốt 06/10/2026): KHÔNG có dịch vụ chính / con, chỉ có TRƯỚC / SAU.
 *   - Dịch vụ TRƯỚC: đứng trước theo thứ tự trên đơn, giữ chặng (giờ, phòng, giường, KTV) với
 *     thời lượng = trước + sau. Quầy được sửa thời lượng; ngắn hơn tổng gốc thì form cảnh báo.
 *   - Dịch vụ SAU: nối tiếp vào dịch vụ trước — KHÔNG có chặng, KHÔNG có KTV riêng.
 *   - DB: dịch vụ sau có `options.mergedIntoId = <id trước>`; dịch vụ trước có `options.mergedServiceIds`.
 *
 * Vì sao dịch vụ sau KHÔNG được có chặng/KTV (đối chiếu code 06/10/2026):
 *   - App KTV nạp dịch vụ theo `technicianCodes`; dịch vụ sau có KTV mà không chặng → lấy thời lượng
 *     gốc làm mặc định → đồng hồ cộng trùng (130 thành 200 phút).
 *   - Hoa hồng: chặng 0 phút bị thay bằng thời lượng mặc định → có thể trả trùng.
 *   - Tự hoàn tất (handleStart/FinishService) CHỈ áp cho dịch vụ sau KHÔNG có chặng KTV → còn chặng là kẹt
 *     (WB-02102026-001, 11NDK-003-03102026-A).
 *   - RPC dispatch_commit_form từ chối chặng 0 phút → cả lần lưu hỏng (11NDK-004-06102026, lần 1).
 *
 * Bộ kiểm thử bắt buộc khi sửa luồng này: scripts/qa/qa_22_ghep_dich_vu.ts (CLAUDE.md mục 9).
 */

const optionsOf = (raw: unknown): Record<string, any> => {
    if (!raw) return {};
    if (typeof raw === 'string') { try { return JSON.parse(raw) || {}; } catch { return {}; } }
    return typeof raw === 'object' ? raw as Record<string, any> : {};
};

/**
 * Id dịch vụ TRƯỚC mà dịch vụ này đã ghép vào.
 * - Dịch vụ trên màn hình (ServiceBlock) LUÔN có trường `mergedIntoId` ở tầng trên (useDispatchBoard dựng từ options):
 *   tầng trên là nguồn đúng — "Hủy gộp" chỉ xoá tầng trên, nên KHÔNG được đọc lại `options.mergedIntoId` cũ.
 * - Dòng DB / payload lưu (không có trường tầng trên) → đọc `options.mergedIntoId`.
 */
export function mergedIntoIdOf(svc: { mergedIntoId?: string | null; options?: unknown } | null | undefined): string | null {
    if (!svc) return null;
    if (Object.prototype.hasOwnProperty.call(svc, 'mergedIntoId')) return svc.mergedIntoId || null;
    return optionsOf(svc.options).mergedIntoId || null;
}

export const isFollowingService = (svc: Parameters<typeof mergedIntoIdOf>[0]): boolean => !!mergedIntoIdOf(svc);

/**
 * Danh sách id cần lưu khi lưu một thẻ / một dòng: thêm mọi dịch vụ SAU đang ghép vào dịch vụ trong danh sách,
 * kể cả khi dịch vụ sau đang hiện ở thẻ khác. Thiếu bước này là "đổi tên + cộng giờ nhưng dịch vụ sau còn sót".
 */
export function withFollowingServices<T extends { id: string; mergedIntoId?: string | null; options?: unknown }>(
    targetIds: string[], services: T[],
): string[] {
    const ids = new Set(targetIds);
    let grew = true;
    while (grew) {
        grew = false;
        for (const svc of services) {
            const into = mergedIntoIdOf(svc);
            if (into && ids.has(into) && !ids.has(svc.id)) { ids.add(svc.id); grew = true; }
        }
    }
    return [...ids];
}

/** Chọn dịch vụ TRƯỚC: đứng trước theo thứ tự trên đơn; tiện ích (Phòng riêng…) không bao giờ đứng trước. */
export function pickLeadingService<T extends { id: string }>(selected: T[], orderedServices: { id: string }[], isUtility: (svc: T) => boolean): T {
    const rank = (svc: T) => { const i = orderedServices.findIndex(s => s.id === svc.id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    const sorted = [...selected].sort((a, b) => rank(a) - rank(b));
    return sorted.find(svc => !isUtility(svc)) ?? sorted[0];
}

/** Tổng phút gốc của nhóm ghép (trước + các dịch vụ sau, bỏ tiện ích) — để cảnh báo khi quầy rút ngắn. */
export function originalMergedMinutes<T extends { id: string; duration?: number | null }>(
    leading: T, following: T[], isUtility: (svc: T) => boolean,
): number {
    return [leading, ...following].filter(svc => !isUtility(svc)).reduce((sum, svc) => sum + (Number(svc.duration) || 0), 0);
}

export interface MergedNormalizeResult<U> {
    itemUpdates: U[];
    /** KTV đã bị gỡ khỏi dịch vụ sau (để báo lại quầy / ghi log). */
    stripped: { itemId: string; ktvIds: string[] }[];
}

/**
 * LỚP CHẶN Ở SERVER: dịch vụ sau trong payload luôn được làm sạch — bỏ chặng, bỏ KTV — trước khi gọi RPC.
 * Lỗi giao diện nào (hôm nay hay sau này) gửi kèm chặng cho dịch vụ sau cũng không làm hỏng lần lưu.
 */
export function normalizeFollowingItemUpdates<U extends { id: string; segments?: any[]; technicianCodes?: any; options?: any; mergedIntoId?: string | null }>(
    itemUpdates: U[],
): MergedNormalizeResult<U> {
    const stripped: { itemId: string; ktvIds: string[] }[] = [];
    const next = itemUpdates.map(update => {
        if (!mergedIntoIdOf(update)) return update;
        const segs = Array.isArray(update.segments) ? update.segments : [];
        const codes = Array.isArray(update.technicianCodes) ? update.technicianCodes
            : String(update.technicianCodes || '').split(',').map(code => code.trim()).filter(Boolean);
        const ktvIds = [...new Set([...codes, ...segs.map((seg: any) => seg?.ktvId).filter(Boolean)])];
        if (ktvIds.length || segs.length) stripped.push({ itemId: update.id, ktvIds });
        return { ...update, segments: [], technicianCodes: [] };
    });
    return { itemUpdates: next, stripped };
}

/**
 * Kiểm tra trước RPC để báo lỗi CỤ THỂ (dịch vụ nào, bao nhiêu phút) thay cho câu chung của DB
 * "Giờ hoặc thời lượng không hợp lệ". Giới hạn trùng với RPC: giờ HH:mm, 1–600 phút.
 */
export function findInvalidSegment(itemUpdates: { id: string; segments?: any[]; options?: any }[]): string | null {
    for (const update of itemUpdates) {
        const name = optionsOf(update.options).displayName || update.id;
        for (const seg of Array.isArray(update.segments) ? update.segments : []) {
            if (!seg || seg.voided === true || seg.voided === 'true') continue;
            const minutes = Number(seg.duration);
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(seg.startTime || '')))
                return `Dịch vụ "${name}" (${seg.ktvId || 'chưa chọn KTV'}): giờ bắt đầu "${seg.startTime || ''}" không hợp lệ.`;
            if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600)
                return `Dịch vụ "${name}" (${seg.ktvId || 'chưa chọn KTV'}): thời lượng ${seg.duration ?? 'trống'} phút không hợp lệ (1–600 phút).`;
        }
    }
    return null;
}
