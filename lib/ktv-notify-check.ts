import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtClock } from '@/lib/hours-format';

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
    /**
     * Từng KTV đã bấm (lần bấm gần nhất của mỗi người). Đơn con có thể có
     * nhiều KTV, mà thẻ chỉ ghi "T007, T069" — phải nói rõ AI bấm, không thì
     * quầy tưởng cả hai cùng báo.
     */
    nguoiBao?: { ktv: string | null; loai: string; luc: string | null }[];
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
        .select('type, message, createdAt, employeeId')
        .in('bookingId', ids)
        .in('type', LOAI_BAO)
        .order('createdAt', { ascending: false })
        .limit(50);

    if (error) {
        // Không chặn thao tác vì một truy vấn cảnh báo hỏng — chỉ mất cảnh báo.
        console.error('[ktv-notify-check] không đọc được StaffNotifications:', error.message);
        return { daBao: false };
    }

    const row = (data || [])[0];
    if (!row) return { daBao: false };

    // Mới nhất trước → gặp KTV lần đầu là lần bấm gần nhất của người đó.
    const theoKtv = new Map<string, { ktv: string | null; loai: string; luc: string | null }>();
    for (const r of data as any[]) {
        const key = r.employeeId || '';
        if (!theoKtv.has(key)) theoKtv.set(key, { ktv: r.employeeId || null, loai: r.type, luc: r.createdAt || null });
    }

    return {
        daBao: true,
        loai: row.type,
        luc: (row as any).createdAt,
        noiDung: row.message,
        nguoiBao: Array.from(theoKtv.values()),
    };
}

/** Câu cảnh báo cho quầy, hoặc null nếu thao tác khớp với những gì KTV đã bấm. */
export function canhBaoLechKichBan(
    thaoTac: 'FINISH_EARLY' | 'CANCEL',
    tt: KtvNotifyStatus
): string | null {
    // Ngắn gọn — quầy đang vội, đọc một dòng là đủ hiểu.
    if (thaoTac === 'FINISH_EARLY' && !tt.daBao) {
        return 'KTV chưa bấm báo. Kết thúc vẫn tính tiền và giờ — bỏ khách thì phải bấm Huỷ.';
    }
    if (thaoTac === 'CANCEL' && tt.daBao) {
        const nhanCua = (loai?: string | null) => (loai === 'EMERGENCY' ? 'khẩn cấp' : 'khách xuống sớm');
        const ds = tt.nguoiBao && tt.nguoiBao.length > 0
            ? tt.nguoiBao
            : [{ ktv: null, loai: tt.loai || '', luc: tt.luc || null }];
        // Vd: 'T069 đã bấm "khẩn cấp" lúc 20:17' — ghi đúng người bấm, cũ nhất trước.
        const ai = ds.slice().reverse().map(n => {
            const gio = fmtClock(n.luc);
            return `${n.ktv || 'KTV'} đã bấm "${nhanCua(n.loai)}"${gio ? ` lúc ${gio}` : ''}`;
        }).join('; ');
        return `${ai}. Huỷ là mất sạch tiền, giờ và tua.`;
    }
    return null;
}
