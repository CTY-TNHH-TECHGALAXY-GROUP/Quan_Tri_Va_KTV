import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ================================================================
 * PhotoCleanupService — dọn ảnh hết hạn trong bucket `attendance`
 * ================================================================
 * Plan: plans/plan_cron_xoa_anh_cham_cong_30_ngay.md (chốt 03/10/2026).
 *
 * Bucket `attendance` chứa NHIỀU loại ảnh, không chỉ ảnh chấm công:
 *   A. Ảnh chấm công  `MAKTV_<ms>_<n>.jpg` ở thư mục gốc  → giữ 30 ngày, lọc theo TÊN + tuổi file.
 *   B. Ảnh của đơn (bàn giao, bắt đầu dịch vụ, dép khách, quầy từ chối) → giữ 3 ngày, lọc theo
 *      TRẠNG THÁI ĐƠN: item DONE, không REJECTED, không commission_locked.
 *   C. `office-evidence/` — bằng chứng kỷ luật → KHÔNG BAO GIỜ xoá.
 *
 * Chỉ xoá FILE. Link trong DB giữ nguyên (vết "đã chụp"). Không ghi BookingItems — mọi
 * UPDATE vào bảng đó đẩy item vào hàng đợi tính lại tiền tua loại D.
 *
 * ⚠️ Không xoá thẳng `storage.objects` bằng SQL: Supabase chặn ("Use the Storage API").
 * Đó là lý do hai job pg_cron cũ lỗi mỗi ngày từ tháng 4.
 */

// 🔧 CONFIGURATION
const BUCKET = 'attendance';
export const ATTENDANCE_RETENTION_DAYS = 30;
export const BOOKING_PHOTO_RETENTION_DAYS = 3;
/** Chỉ quét đơn trong cửa sổ này — đơn cũ hơn đã được dọn ở các lượt trước. */
const BOOKING_LOOKBACK_DAYS = 365;
const MAX_DELETE_PER_RUN = 1000;
const REMOVE_BATCH = 100;
const LIST_PAGE = 1000;
const BOOKING_PAGE = 500;
const PROTECTED_PREFIXES = ['office-evidence/'];
/** Thư mục có ảnh của đơn. Gốc ('') chứa cả ảnh chấm công lẫn ảnh đơn. */
const LISTED_FOLDERS = ['', 'handover-photos'];

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTENDANCE_NAME = /^[A-Z]+[0-9]+_[0-9]{13}(_[0-9]+)?\.(jpe?g|png|webp)$/i;

// ── Hàm thuần (test được) ────────────────────────────────────────────

/** Tên file ở thư mục gốc có đúng là ảnh chấm công không. */
export function isAttendancePhotoName(name: string): boolean {
    return ATTENDANCE_NAME.test(name);
}

/** Public URL → path trong bucket `attendance`. Link bucket khác / sai định dạng → null. */
export function storagePathFromUrl(url: unknown): string | null {
    if (typeof url !== 'string' || !url) return null;
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const path = decodeURIComponent(url.substring(idx + marker.length).split('?')[0]);
    if (!path || PROTECTED_PREFIXES.some(p => path.startsWith(p))) return null;
    return path;
}

function parseJson(value: any, fallback: any): any {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

/** Mọi URL (chuỗi) nằm ở bất kỳ độ sâu nào của một giá trị JSON. */
function collectUrls(value: any, out: string[]): void {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(v => collectUrls(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach(v => collectUrls(v, out));
}

export interface CleanupItem {
    status?: string | null;
    handover_status?: string | null;
    commission_locked?: boolean | null;
    segments?: any;
    handover_images?: any;
    handover_reject_images?: any;
}

/** Item đã đủ điều kiện dọn ảnh: DONE, không bị từ chối bàn giao, không khoá tiền. */
export function isItemPhotoDeletable(item: CleanupItem): boolean {
    return item.status === 'DONE'
        && item.handover_status !== 'REJECTED'
        && item.commission_locked !== true;
}

const SEGMENT_PHOTO_KEYS = ['handoverPhotoUrl', 'handoverPhotoUrls', 'startPhotoUrl', 'guestSlipperPhotoUrl'];

/** Path ảnh (bucket `attendance`) mà một item đang trỏ tới. */
export function collectItemPhotoPaths(item: CleanupItem): string[] {
    const urls: string[] = [];
    collectUrls(parseJson(item.handover_images, null), urls);
    collectUrls(parseJson(item.handover_reject_images, null), urls);
    const segs = parseJson(item.segments, []);
    if (Array.isArray(segs)) {
        for (const seg of segs) {
            if (!seg || typeof seg !== 'object') continue;
            for (const k of SEGMENT_PHOTO_KEYS) collectUrls(seg[k], urls);
            // Tên cũ của ảnh bắt đầu dịch vụ (selfie_…) — bắt mọi khoá có "photo" trong tên.
            for (const [k, v] of Object.entries(seg)) {
                if (!SEGMENT_PHOTO_KEYS.includes(k) && /photo/i.test(k)) collectUrls(v, urls);
            }
        }
    }
    const paths = urls.map(storagePathFromUrl).filter((p): p is string => !!p);
    return [...new Set(paths)];
}

// ── Chạy thật ────────────────────────────────────────────────────────

interface StoredFile { path: string; createdAt: number; size: number }

async function listExistingFiles(supabase: SupabaseClient): Promise<Map<string, StoredFile>> {
    const files = new Map<string, StoredFile>();
    for (const folder of LISTED_FOLDERS) {
        for (let offset = 0; ; offset += LIST_PAGE) {
            const { data, error } = await supabase.storage.from(BUCKET)
                .list(folder, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
            if (error) throw error;
            for (const f of data || []) {
                if (!f.id) continue; // thư mục con
                const path = folder ? `${folder}/${f.name}` : f.name;
                files.set(path, {
                    path,
                    createdAt: f.created_at ? Date.parse(f.created_at) : NaN,
                    size: Number((f.metadata as any)?.size) || 0,
                });
            }
            if (!data || data.length < LIST_PAGE) break;
        }
    }
    return files;
}

async function collectBookingPhotoPaths(supabase: SupabaseClient, now: number): Promise<Set<string>> {
    const cutoff = new Date(now - BOOKING_PHOTO_RETENTION_DAYS * DAY_MS).toISOString();
    const from = new Date(now - BOOKING_LOOKBACK_DAYS * DAY_MS).toISOString();
    const paths = new Set<string>();

    for (let offset = 0; ; offset += BOOKING_PAGE) {
        const { data, error } = await supabase
            .from('Bookings')
            .select(`id, BookingItems!fk_bookingitems_booking (
                status, handover_status, commission_locked, segments, handover_images, handover_reject_images
            )`)
            .gte('timeStart', from)
            .lt('timeStart', cutoff)
            .order('timeStart', { ascending: true })
            .range(offset, offset + BOOKING_PAGE - 1);
        if (error) throw error;
        for (const b of data || []) {
            for (const item of ((b as any).BookingItems || []) as CleanupItem[]) {
                if (!isItemPhotoDeletable(item)) continue;
                collectItemPhotoPaths(item).forEach(p => paths.add(p));
            }
        }
        if (!data || data.length < BOOKING_PAGE) break;
    }
    return paths;
}

export interface PhotoCleanupResult {
    dryRun: boolean;
    attendance: { candidates: number; mb: number };
    booking: { candidates: number; mb: number };
    deleted: number;
    remaining: number;
    samples: string[];
}

export async function cleanupExpiredPhotos(
    supabase: SupabaseClient,
    opts: { dryRun: boolean; now?: number },
): Promise<PhotoCleanupResult> {
    const now = opts.now ?? Date.now();
    const files = await listExistingFiles(supabase);

    // A. Ảnh chấm công — tên đúng mẫu, ở thư mục gốc, quá 30 ngày.
    const attendanceCutoff = now - ATTENDANCE_RETENTION_DAYS * DAY_MS;
    const attendance = [...files.values()].filter(f =>
        !f.path.includes('/') && isAttendancePhotoName(f.path)
        && Number.isFinite(f.createdAt) && f.createdAt < attendanceCutoff);

    // B. Ảnh của đơn — chỉ những file CÒN TỒN TẠI, để link đã xoá ở lượt trước không bị đếm lại.
    const bookingPaths = await collectBookingPhotoPaths(supabase, now);
    const attendanceSet = new Set(attendance.map(f => f.path));
    const booking = [...bookingPaths]
        .map(p => files.get(p))
        .filter((f): f is StoredFile => !!f && !attendanceSet.has(f.path));

    const mb = (list: StoredFile[]) => Math.round(list.reduce((s, f) => s + f.size, 0) / 1048576 * 10) / 10;
    const queue = [...attendance, ...booking].map(f => f.path);
    const toDelete = queue.slice(0, MAX_DELETE_PER_RUN);

    let deleted = 0;
    if (!opts.dryRun) {
        for (let i = 0; i < toDelete.length; i += REMOVE_BATCH) {
            const batch = toDelete.slice(i, i + REMOVE_BATCH);
            const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
            if (error) throw error;
            deleted += data?.length || 0;
        }
    }

    return {
        dryRun: opts.dryRun,
        attendance: { candidates: attendance.length, mb: mb(attendance) },
        booking: { candidates: booking.length, mb: mb(booking) },
        deleted,
        remaining: queue.length - (opts.dryRun ? 0 : deleted),
        samples: [...attendance.slice(0, 10), ...booking.slice(0, 10)].map(f => f.path),
    };
}
