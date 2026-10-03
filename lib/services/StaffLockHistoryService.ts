import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lock / unlock history of staff accounts, read back from `SecurityAuditLogs`.
 *
 * No dedicated table: every lock path already writes an audit row
 * (plans/plan_lich_su_khoa_mo_khoa.md §2) — the midnight discipline cron and
 * the deferred lock (`KtvTypeDDisciplineService.khoaTaiKhoan`), the pending
 * mark (`ghiChoKhoa`), reject-order without enough hours, the admin "Hoạt động"
 * switch (`api/admin/staff/lock`) and unlock (`api/admin/staff/unlock`).
 * What was missing is a screen that reads them — this is the single place that
 * turns those raw rows into something a manager can read.
 *
 * READ ONLY. Never returns `ip_address`, `user_agent` or the `*_by_id` UUIDs.
 */

export type LockFilter = 'ALL' | 'LOCK' | 'UNLOCK';
export type LockEventKind = 'LOCK' | 'PENDING' | 'UNLOCK';

export interface LockEvent {
    id: string;
    staffId: string;
    staffName: string;
    /** `created_at` of the audit row (ISO). */
    at: string;
    kind: LockEventKind;
    title: string;
    /** "Hệ thống" for automatic locks, otherwise the operator's name. */
    actor: string;
    /** Reason for the LOCK, or reason for the UNLOCK — already mapped (see REJECT_LOCK_REASON). */
    reason: string | null;
    /** Secondary lines: violation date, hours, bill codes, source… */
    details: string[];
    /** Reactivation fee actually charged — UNLOCK only, null when none. */
    fee: number | null;
}

interface AuditRow {
    id: string;
    employee_id: string | null;
    employee_name: string | null;
    event_type: string;
    created_at: string;
    details: any;
}

// 🔧 CONFIGURATION
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
/** Max staff ids a name/code search expands into before filtering audit rows. */
const MAX_STAFF_MATCHES = 200;

const LOCK_TYPES = ['AUTO_LOCK_ABSENCE', 'AUTO_LOCK_REJECT_NO_HOURS', 'MANUAL_LOCK', 'PENDING_LOCK'];
const UNLOCK_TYPES = ['MANUAL_UNLOCK'];

export const LOCK_EVENT_TYPES: Record<LockFilter, string[]> = {
    ALL: [...LOCK_TYPES, ...UNLOCK_TYPES],
    LOCK: LOCK_TYPES,
    UNLOCK: UNLOCK_TYPES,
};

/**
 * The real lock reason for AUTO_LOCK_REJECT_NO_HOURS.
 *
 * ⚠️ That row's `details.reason` is NOT the lock reason: reject-order stores
 * the text the KTV typed when rejecting the turn (real data: "okay "). The
 * reason shown to the KTV is this constant — keep it in sync with `lyDo` in
 * app/api/ktv/discipline/reject-order/route.ts.
 */
export const REJECT_LOCK_REASON = 'Từ chối tua khi không đủ giờ khả dụng';

const SOURCE_LABELS: Record<string, string> = {
    CRON: 'Cron kỷ luật',
    CRON_MIDNIGHT: 'Chốt sổ 00:00',
    CRON_PENDING_LOCK: 'Áp khoá sau khi xong đơn',
    REJECT_ORDER: 'Từ chối tua',
    FEATURES_TABLE: 'Công tắc Hoạt động',
};

const text = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s || null;
};

const compact = (lines: Array<string | null | false | undefined>): string[] =>
    lines.filter((l): l is string => typeof l === 'string' && l.length > 0);

/** 'YYYY-MM-DD' → 'DD/MM'. */
const dayMonth = (iso: unknown): string | null => {
    const m = typeof iso === 'string' ? iso.match(/^\d{4}-(\d{2})-(\d{2})/) : null;
    return m ? `${m[2]}/${m[1]}` : null;
};

const hours = (v: unknown): string | null => {
    const n = Number(v);
    return v === null || v === undefined || !Number.isFinite(n) ? null : `${Math.round(n * 100) / 100}h`;
};

const sourceLine = (s: unknown): string | null => {
    const key = text(s);
    return key ? (SOURCE_LABELS[key] || key) : null;
};

/** One audit row → one readable event. Unknown event types → null. Pure, no DB. */
export function toLockEvent(row: AuditRow): LockEvent | null {
    const d = row.details && typeof row.details === 'object' ? row.details : {};
    const base = {
        id: row.id,
        staffId: row.employee_id || '—',
        staffName: row.employee_name || row.employee_id || 'Không rõ',
        at: row.created_at,
        fee: null as number | null,
    };
    const violation = dayMonth(d.violationDate);

    switch (row.event_type) {
        case 'AUTO_LOCK_ABSENCE':
            return {
                ...base, kind: 'LOCK', title: 'Bị khoá tự động', actor: 'Hệ thống',
                reason: text(d.reason),
                details: compact([violation && `Ngày vi phạm ${violation}`, sourceLine(d.source)]),
            };

        case 'AUTO_LOCK_REJECT_NO_HOURS': {
            const available = hours(d.availableHours);
            const min = hours(d.minHours);
            const penalty = hours(d.penaltyHours);
            const typed = text(d.reason);
            return {
                ...base, kind: 'LOCK', title: 'Bị khoá tự động', actor: 'Hệ thống',
                reason: REJECT_LOCK_REASON,
                details: compact([
                    available && min && `Còn ${available}, cần hơn ${min}`,
                    penalty && `Bị trừ ${penalty}`,
                    typed && `KTV ghi khi từ chối: "${typed}"`,
                    sourceLine(d.source),
                ]),
            };
        }

        case 'PENDING_LOCK': {
            const codes = Array.isArray(d.billCodes) ? d.billCodes.filter(Boolean) : [];
            return {
                ...base, kind: 'PENDING', title: 'Chờ khoá', actor: 'Hệ thống',
                reason: text(d.reason),
                details: compact([
                    violation && `Ngày vi phạm ${violation}`,
                    codes.length > 0 && `Còn đơn: ${codes.join(', ')}`,
                    'Khoá ngay khi xong đơn',
                ]),
            };
        }

        case 'MANUAL_LOCK':
            return {
                ...base, kind: 'LOCK', title: 'Admin tắt hoạt động',
                actor: text(d.locked_by) || 'Không rõ',
                reason: text(d.reason),
                details: compact([sourceLine(d.source)]),
            };

        case 'MANUAL_UNLOCK': {
            const fee = Number(d.reactivation_fee);
            return {
                ...base, kind: 'UNLOCK', title: 'Mở khoá',
                actor: text(d.unlocked_by) || 'Không rõ',
                reason: text(d.reason),
                details: [],
                fee: Number.isFinite(fee) && fee > 0 ? fee : null,
            };
        }

        default:
            return null;
    }
}

/**
 * Cursor = `created_at|id` of the last row on the page.
 *
 * Paged by cursor, not by month: a lock at the end of August unlocked early
 * September would be cut in two by a month view — exactly the pair the reader
 * needs to see together. `id` breaks ties between identical timestamps.
 */
export function encodeCursor(row: { at: string; id: string }): string {
    return `${row.at}|${row.id}`;
}

/**
 * Strictly validated — the pieces are interpolated into a PostgREST `or()`
 * filter, so anything that is not a plain timestamp + uuid is rejected.
 */
export function decodeCursor(raw?: string | null): { at: string; id: string } | null {
    if (!raw) return null;
    const i = raw.lastIndexOf('|');
    if (i <= 0) return null;
    const at = raw.slice(0, i);
    const id = raw.slice(i + 1);
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(at) || Number.isNaN(Date.parse(at))) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return { at, id };
}

/** Name/code search text, stripped of PostgREST filter syntax. */
export function sanitizeQuery(q?: string | null): string {
    return String(q || '').replace(/[%_,()*"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export async function listLockEvents(
    supabase: SupabaseClient,
    opts: { filter?: LockFilter | null; q?: string | null; before?: string | null; limit?: number } = {},
): Promise<{ events: LockEvent[]; nextBefore: string | null }> {
    const filter: LockFilter = opts.filter && LOCK_EVENT_TYPES[opts.filter] ? opts.filter : 'ALL';
    const limit = Math.min(Math.max(Math.floor(Number(opts.limit) || DEFAULT_LIMIT), 1), MAX_LIMIT);

    let query = supabase
        .from('SecurityAuditLogs')
        .select('id, employee_id, employee_name, event_type, created_at, details')
        .in('event_type', LOCK_EVENT_TYPES[filter]);

    // Search resolves to staff ids first, so the audit filter stays a plain
    // `in()` and the cursor can own the single `or()`.
    const q = sanitizeQuery(opts.q);
    if (q) {
        const { data: staff, error: staffErr } = await supabase
            .from('Staff')
            .select('id')
            .or(`id.ilike.%${q}%,full_name.ilike.%${q}%`)
            .limit(MAX_STAFF_MATCHES);
        if (staffErr) throw staffErr;
        const ids = (staff || []).map((s: any) => s.id);
        if (ids.length === 0) return { events: [], nextBefore: null };
        query = query.in('employee_id', ids);
    }

    const cursor = decodeCursor(opts.before);
    if (cursor) {
        query = query.or(`created_at.lt."${cursor.at}",and(created_at.eq."${cursor.at}",id.lt.${cursor.id})`);
    }

    // Fetch one extra row to know whether another page exists.
    const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
    if (error) throw error;

    const rows = (data || []) as AuditRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
        events: page.map(toLockEvent).filter((e): e is LockEvent => e !== null),
        nextBefore: rows.length > limit && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
    };
}
