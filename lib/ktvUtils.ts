/**
 * ============================================================
 * 🔑 KTV SHARED UTILITIES (CLIENT-SAFE)
 * ============================================================
 *
 * Các hàm tiện ích dùng chung cho cả client và server.
 * ⚠️ KHÔNG import 'next/server' hoặc bất kỳ server-only module nào ở đây.
 * ============================================================
 */

/**
 * Kiểm tra segment có thuộc về KTV không.
 * Hỗ trợ 2 format ktvId:
 *   - 1 KTV:  "NH001"
 *   - 2 KTV:  "NH001 - NH011"  (song song, chung 1 segment)
 *   - 3+ KTV: "NH001 - NH011 - NH021"
 *
 * ⚠️ PHẢI dùng hàm này thay vì so sánh === trực tiếp ở mọi nơi.
 */
export function ktvMatchesSeg(
    segKtvId: string | undefined | null,
    ktvCode: string | undefined | null
): boolean {
    if (!segKtvId || !ktvCode) return false;
    return segKtvId
        .split(' - ')
        .map(s => s.trim())
        .some(s => s.toLowerCase() === ktvCode.trim().toLowerCase());
}

/** Runtime selection excludes replaced/cancelled segments; history keeps them. */
export function isLiveKtvSegment(seg: any, code: string | undefined | null): boolean {
    return seg?.voided !== true && seg?.voided !== 'true' && ktvMatchesSeg(seg?.ktvId, code);
}

/** Normalize legacy JSON options without leaking malformed data into UI. */
export function parseKtvOptions(raw: any): Record<string, any> {
    try {
        for (let i = 0; i < 2 && typeof raw === 'string'; i++) raw = JSON.parse(raw);
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch { return {}; }
}

/** Use this account's current name; catalogue name survives clearing an override. */
export function ktvServiceName(item: any, code: string | undefined | null): string {
    const opts = parseKtvOptions(item?.options);
    const names = parseKtvOptions(opts.serviceNamesForKtvs);
    const own = Object.entries(names).find(([id]) => id.trim().toLowerCase() === code?.trim().toLowerCase())?.[1];
    return String(own || opts._generatedDisplayName || opts.displayName || item?.base_service_name || item?.service_name || 'Dịch vụ');
}
