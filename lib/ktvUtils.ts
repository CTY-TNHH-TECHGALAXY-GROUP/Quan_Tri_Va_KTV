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
