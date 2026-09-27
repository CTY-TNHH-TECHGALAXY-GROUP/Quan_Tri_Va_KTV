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

/** Cancelled work retains cleaning/feedback duty without becoming runnable again. */
export function isKtvDisplaySegment(seg: any, code: string | undefined | null): boolean {
    return isLiveKtvSegment(seg, code) || (seg?.note === 'CANCELLED_NO_CREDIT'
        && !!seg.actualStartTime && !!seg.actualEndTime && ktvMatchesSeg(seg.ktvId, code));
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
    const own = ktvMetadataValue(names, code || '');
    return String(own || opts.displayName || opts._generatedDisplayName || item?.base_service_name || item?.service_name || 'Dịch vụ');
}

/** UI tolerates legacy encoding; mutation handlers must reject invalid shapes. */
export function parseKtvSegments(raw: unknown, strict = false): any[] {
    try {
        for (let i = 0; i < 2 && typeof raw === 'string'; i++) raw = JSON.parse(raw);
        if (strict && raw != null && (!Array.isArray(raw) || raw.some(s => !s || typeof s !== 'object' || Array.isArray(s)))) throw new Error('Dữ liệu chặng không hợp lệ.');
        return Array.isArray(raw) ? raw.filter(s => s && typeof s === 'object' && !Array.isArray(s)) : [];
    } catch (error) { if (strict) throw error; return []; }
}

/** Undefined means absent; an explicit empty string is a saved clear. */
export function ktvMetadataValue(raw: unknown, code: string): string | undefined {
    const entries = Object.entries(parseKtvOptions(raw));
    const key = code.trim().toLowerCase();
    const exact = entries.find(([id]) => id === code);
    const value = (exact || entries.find(([id]) => id.trim().toLowerCase() === key))?.[1];
    return typeof value === 'string' ? value : undefined;
}

/** Retain other employees' values, normalize aliases, and persist explicit clears. */
export function ktvMetadataMap(raw: unknown, rows: any[], field: string): Record<string, string> {
    const result = { ...parseKtvOptions(raw) };
    for (const row of rows) {
        if (!row.ktvId || row[field] === undefined) continue;
        for (const key of Object.keys(result)) {
            if (key.trim().toLowerCase() === row.ktvId.trim().toLowerCase()) delete result[key];
        }
        result[row.ktvId] = String(row[field] ?? '');
    }
    return result;
}

/** A time edit changes the clock within the booking's service run, never its service day. */
export function sequentialClockAt(serviceDay: string, aStartClock: string, bClock: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDay)
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(aStartClock.slice(0, 5))
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(bClock)) return null;
    const start = Date.parse(`${serviceDay}T${bClock}:00+07:00`);
    return Number.isFinite(start) ? new Date(start + (bClock < aStartClock.slice(0, 5) ? 86400000 : 0)).toISOString() : null;
}

/** Existing segments define this employee's allocation; never fall back to the whole package for a missing/zero slot. */
export function ktvAssignedMinutes(item: any, code: string | undefined | null, fallback = item?.duration ?? 60): number {
    const segments = parseKtvSegments(item?.segments);
    const live = segments.filter(seg => isLiveKtvSegment(seg, code));
    const own = live.length ? live : segments.filter(seg => isKtvDisplaySegment(seg, code));
    if (segments.length) return own.reduce((sum, seg) => {
        const minutes = Number(seg.duration);
        return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
    }, 0);
    const minutes = Number(fallback);
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
}
