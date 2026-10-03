/**
 * ================================================================
 * Ảnh minh chứng của phiếu trừ điểm Office — GẮN THEO TỪNG LỖI
 * ================================================================
 * Tách khỏi route để kịch bản kiểm thử chạy được ĐÚNG đoạn code mà route chạy.
 * Chép tay logic sang test là test đi kiểm tra bản chép.
 *
 * ⚠️ VÌ SAO PHẢI TÁCH RIÊNG TỪNG LỖI
 *
 * Bản đầu chỉ có MỘT rổ ảnh cho cả phiếu. Lễ tân tích 3 lỗi rồi tải 2 ảnh thì cả
 * ba dòng phiếu cùng nhận đúng 2 link đó. Trên dữ liệu thật, ngày 05/09 của
 * T016 có một tấm ảnh dính vào TÁM lỗi cùng lúc (A1 = P1 = P2 = P3 = T1 = T2 =
 * T3 = T4). Hậu quả:
 *   · KTV mở ngày đó ra thấy mỗi tấm lặp lại 8 lần;
 *   · tấm chụp đồng phục trở thành "bằng chứng" cho cả lỗi bật app trễ — nhìn
 *     vào không ai biết nó chứng minh điều gì, và KTV cãi là đúng;
 *   · trần 5 ảnh áp cho cả rổ, nên tải 1 tấm là đủ điều kiện cho mọi lỗi bắt
 *     buộc ảnh.
 */

/** Trần ảnh cho MỖI lỗi (không phải cho cả phiếu). */
export const MAX_PHOTOS_PER_CRITERIA = 5;

export interface CriteriaRow {
    id: string;
    label: string;
    points: number | string;
    requires_photo?: boolean;
}

export type ResolvePhotosResult =
    | { ok: true; perCriteria: Record<string, string[]> }
    | { ok: false; code: 'PHOTOS_MUST_BE_PER_CRITERIA' | 'MISSING_REQUIRED_PHOTO'; error: string };

/**
 * Chia ảnh về đúng từng lỗi và kiểm điều kiện bắt buộc.
 *
 * `photosBase64` là đường CŨ (rổ dùng chung). Chỉ còn nhận khi tích ĐÚNG MỘT
 * lỗi — lúc đó "rổ chung" và "rổ của lỗi đó" là một, không có gì nhập nhằng.
 * Nhiều lỗi mà vẫn gửi rổ chung thì từ chối, để lỗ hổng không quay lại qua một
 * client cũ chưa tải lại trang.
 */
export function resolvePhotosPerCriteria(
    criteria: CriteriaRow[],
    photosByCriteria?: Record<string, string[]> | null,
    photosBase64?: string[] | null,
    max: number = MAX_PHOTOS_PER_CRITERIA,
): ResolvePhotosResult {
    const perCriteria: Record<string, string[]> = {};
    for (const c of criteria) {
        const raw = photosByCriteria?.[c.id];
        perCriteria[c.id] = Array.isArray(raw) ? raw.slice(0, max) : [];
    }

    const legacy = Array.isArray(photosBase64) ? photosBase64.slice(0, max) : [];
    if (legacy.length > 0) {
        if (criteria.length > 1) {
            return {
                ok: false,
                code: 'PHOTOS_MUST_BE_PER_CRITERIA',
                error: 'Nhiều lỗi cùng lúc thì ảnh phải gắn theo từng lỗi. Vui lòng tải lại trang để dùng bản mới.',
            };
        }
        const only = criteria[0].id;
        if (perCriteria[only].length === 0) perCriteria[only] = legacy;
    }

    const missing = criteria
        .filter(c => c.requires_photo && perCriteria[c.id].length === 0)
        .map(c => c.label);
    if (missing.length > 0) {
        return {
            ok: false,
            code: 'MISSING_REQUIRED_PHOTO',
            error: `Các lỗi sau bắt buộc có ảnh minh chứng RIÊNG: ${missing.join(', ')}.`,
        };
    }

    return { ok: true, perCriteria };
}

export interface DeductRow {
    staff_id: string;
    work_date: string;
    criteria_id: string;
    criteria_label: string;
    points_deducted: number;
    note: string | null;
    photo_urls: string[];
    created_by: string;
    created_by_name: string;
}

/**
 * Dựng các dòng phiếu để ghi xuống `KTVOfficeScoreLog`.
 *
 * Mỗi dòng chỉ mang ảnh CỦA RIÊNG lỗi đó (`urlsOf[c.id]`). Đây chính là chỗ
 * từng ghi chung một mảng cho mọi dòng.
 */
export function buildDeductRows(args: {
    staffId: string;
    workDate: string;
    criteria: CriteriaRow[];
    urlsOf: Record<string, string[]>;
    /** Ghi chú của RIÊNG từng lỗi: { criteriaId: text }. */
    notesOf?: Record<string, string>;
    createdBy: string;
    createdByName: string;
}): DeductRow[] {
    const { staffId, workDate, criteria, urlsOf, notesOf, createdBy, createdByName } = args;
    return criteria.map(c => ({
        staff_id: staffId,
        work_date: workDate,
        criteria_id: c.id,
        criteria_label: c.label,          // snapshot, phòng khi quy chế đổi tên tiêu chí
        points_deducted: Number(c.points) || 0,
        note: notesOf?.[c.id]?.trim() || null,
        photo_urls: urlsOf[c.id] ?? [],
        created_by: createdBy,
        created_by_name: createdByName,
    }));
}

/**
 * Chia ghi chú về đúng từng lỗi.
 *
 * ⚠️ Trước đây cả phiếu chỉ có MỘT ô "Ghi chú cho KTV", và nội dung đó được ghi
 * y hệt vào MỌI dòng phiếu — đúng cái bệnh của rổ ảnh dùng chung. Tích 3 lỗi rồi
 * gõ "Không đeo bảng tên" thì lỗi "bật app trễ" và "thái độ" cũng mang đúng câu
 * đó. KTV mở ra đọc thấy ba lỗi khác nhau cùng một lời giải thích, không biết
 * câu đó nói về lỗi nào, và cũng không cãi vào đâu được.
 *
 * `noteChung` là đường CŨ: chỉ còn nhận khi tích ĐÚNG MỘT lỗi — lúc đó "ghi chú
 * chung" và "ghi chú của lỗi đó" là một.
 */
export function resolveNotesPerCriteria(
    criteria: CriteriaRow[],
    notesByCriteria?: Record<string, string> | null,
    noteChung?: string | null,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of criteria) {
        out[c.id] = String(notesByCriteria?.[c.id] ?? '').trim();
    }

    const legacy = String(noteChung ?? '').trim();
    if (legacy && criteria.length === 1 && !out[criteria[0].id]) {
        out[criteria[0].id] = legacy;
    }
    return out;
}
