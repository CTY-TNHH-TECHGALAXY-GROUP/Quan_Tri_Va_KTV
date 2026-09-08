import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ================================================================
 * KTV CÓ BẤM BÁO KHÔNG — chốt chặn chống bấm nhầm ở quầy
 * ================================================================
 * Hai nút trên thẻ tạm dừng cho ra kết quả tiền NGƯỢC NHAU:
 *
 *   Kết thúc sớm → KTV CÓ tiền, CÓ giờ  (kịch bản B: khách xuống sớm)
 *   Huỷ          → KTV MẤT tiền, MẤT giờ, mất tua  (kịch bản A: bỏ khách)
 *
 * Thứ phân biệt hai kịch bản là: KTV CÓ BẤM BÁO hay không.
 *   · Có bấm "khách xuống sớm" / "khẩn cấp"  → đáng lẽ bấm Kết thúc
 *   · Không bấm gì cả (bỏ khách)             → đáng lẽ bấm Huỷ
 *
 * Bấm nhầm nút là KTV mất oan cả buổi làm, hoặc ngược lại được trả cho một tua
 * họ đã bỏ khách. Nên trước khi chốt, quầy phải được cảnh báo khi thao tác
 * NGƯỢC với những gì KTV đã bấm.
 *
 * Nguồn dữ liệu: `StaffNotifications` — chính là nơi /api/ktv/interaction ghi
 * lại mỗi lần KTV bấm nút trên app.
 */

/** Các loại bấm được coi là "KTV có báo về quầy". */
const LOAI_BAO = ['EARLY_EXIT', 'EMERGENCY'];

export interface KtvNotifyStatus {
    /** KTV có bấm báo gì cho đơn này không. */
    daBao: boolean;
    /** Loại bấm gần nhất: EARLY_EXIT (khách xuống sớm) hoặc EMERGENCY (khẩn cấp). */
    loai?: string | null;
    /** Lúc bấm. */
    luc?: string | null;
    /** Nội dung đã gửi về quầy. */
    noiDung?: string | null;
}

/**
 * KTV đã bấm báo gì cho đơn này chưa?
 *
 * @param bookingIds  cả đơn cha lẫn đơn con — KTV bấm trên đơn nào thì ghi
 *                    theo đơn đó, mà quầy có thể đang thao tác ở cấp khác.
 */
export async function layTrangThaiBaoCuaKtv(
    supabase: SupabaseClient,
    bookingIds: string[]
): Promise<KtvNotifyStatus> {
    const ids = (bookingIds || []).filter(Boolean);
    if (ids.length === 0) return { daBao: false };

    const { data, error } = await supabase
        .from('StaffNotifications')
        .select('type, message, createdAt')
        .in('bookingId', ids)
        .in('type', LOAI_BAO)
        .order('createdAt', { ascending: false })
        .limit(1);

    if (error) {
        // Không chặn thao tác vì một truy vấn cảnh báo hỏng — chỉ mất cảnh báo.
        console.error('[ktv-notify-check] không đọc được StaffNotifications:', error.message);
        return { daBao: false };
    }

    const row = (data || [])[0];
    if (!row) return { daBao: false };

    return {
        daBao: true,
        loai: row.type,
        luc: (row as any).createdAt,
        noiDung: row.message,
    };
}

/** Câu cảnh báo cho quầy, hoặc null nếu thao tác khớp với những gì KTV đã bấm. */
export function canhBaoLechKichBan(
    thaoTac: 'FINISH_EARLY' | 'CANCEL',
    tt: KtvNotifyStatus
): string | null {
    if (thaoTac === 'FINISH_EARLY' && !tt.daBao) {
        return 'KTV CHƯA bấm báo "khách xuống sớm" hay "khẩn cấp" cho đơn này. '
            + 'Kết thúc sớm vẫn TÍNH TIỀN và GIỜ cho KTV. '
            + 'Nếu KTV bỏ khách không báo thì phải bấm Huỷ, không phải Kết thúc.';
    }
    if (thaoTac === 'CANCEL' && tt.daBao) {
        const nhan = tt.loai === 'EMERGENCY' ? 'BÁO ĐỘNG KHẨN CẤP' : 'khách xuống sớm';
        return `KTV ĐÃ bấm "${nhan}" cho đơn này. `
            + 'Huỷ sẽ khiến KTV mất sạch tiền, giờ tích luỹ và lượt tua. '
            + 'Nếu khách xuống sớm thật thì nên bấm Kết thúc để KTV được tính giờ đã làm.';
    }
    return null;
}
