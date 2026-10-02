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

export function ktvAssignedToItem(
    item: { technicianCodes?: unknown; segments?: unknown },
    ktvCode: string
): boolean {
    if (Array.isArray(item.technicianCodes) &&
        item.technicianCodes.some(code => typeof code === 'string' && ktvMatchesSeg(code, ktvCode))) return true;
    let segments = item.segments;
    try { if (typeof segments === 'string') segments = JSON.parse(segments); } catch { return false; }
    return Array.isArray(segments) && segments.some(seg =>
        typeof seg?.ktvId === 'string' && ktvMatchesSeg(seg.ktvId, ktvCode));
}
