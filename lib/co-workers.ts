/**
 * KTV nào "LÀM CÙNG" với tôi trên một dịch vụ.
 *
 * "Làm cùng" nghĩa là được gán CÙNG MỘT LÀN, song song trong cùng khoảng thời
 * gian — kiểu Body 4 Hands, hai người cùng làm trên một khách một lúc.
 *
 * ⚠️ Trước đây ba nơi (Dashboard, màn Đếm giờ, Lịch sử) đều lấy thẳng
 * `technicianCodes` rồi bỏ mình ra — tức AI TỪNG có tên trên dịch vụ đều thành
 * "cùng làm". Sai ở hai ca gặp thật:
 *
 *   · ĐỔI KTV: quầy thay T069 bằng T007. Chặng của T069 bị đánh `voided`, nhưng
 *     mã T069 vẫn nằm trong `technicianCodes` → T007 thấy "Cùng làm với T069"
 *     trong khi hai người chưa từng đứng cùng một lúc.
 *   · NỐI TIẾP: người này làm xong người kia mới vào (00:31 → 00:32). Cũng không
 *     phải làm cùng.
 *
 * Nay chỉ tính chặng CÒN HIỆU LỰC (không `voided`) và CHỒNG GIỜ với chặng của
 * tôi. Không đọc được chặng thì trả rỗng — không hiện gì còn hơn hiện sai.
 */

type Seg = {
    ktvId?: string;
    startTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    duration?: number | string;
    voided?: boolean;
};

const parseSegs = (raw: any): Seg[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
    }
    return [];
};

/** Phút-trong-ngày theo giờ VN. Nhận 'HH:MM' hoặc chuỗi ISO. */
const phutTrongNgay = (t?: string): number | null => {
    if (!t) return null;
    const s = String(t);
    const hm = s.match(/^(\d{1,2}):(\d{2})/);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) return null;
    const vn = new Date(ms + 7 * 3600 * 1000);
    return vn.getUTCHours() * 60 + vn.getUTCMinutes();
};

/** Khoảng [bắt đầu, kết thúc) của một chặng, tính bằng phút trong ngày. */
const khoang = (s: Seg): [number, number] | null => {
    // 1. Có ĐỦ giờ thực tế (bắt đầu + kết thúc) thì tin nó — đó là sự thật đã
    //    xảy ra. Gặp thật: đơn S260510-2C4D xếp dự kiến NỐI TIẾP (19:47 rồi
    //    20:47) nhưng thực tế hai người cùng làm 19:48 → 20:48. Tin giờ dự kiến
    //    là bỏ sót một cặp làm cùng thật.
    //    Lệch vài phút giữa hai lần bấm "Bắt đầu" không sao: phép so là CHỒNG
    //    GIỜ, không đòi trùng khít.
    const tb = phutTrongNgay(s.actualStartTime);
    const tk = phutTrongNgay(s.actualEndTime);
    if (tb != null && tk != null && tk > tb) return [tb, tk];

    // 2. Chưa làm xong thì dùng giờ DỰ KIẾN — đó là làn quầy đã xếp.
    const bd = phutTrongNgay(s.startTime) ?? tb;
    if (bd == null) return null;
    const dur = Number(s.duration) || 0;
    return [bd, bd + Math.max(dur, 1)];
};

const cungKtv = (a?: string, b?: string) =>
    String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

export function coWorkersOf(item: any, myKtvId: string): string[] {
    const segs = parseSegs(item?.segments).filter(s => s && !s.voided && s.ktvId);
    const cuaToi = segs.filter(s => cungKtv(s.ktvId, myKtvId)).map(khoang).filter(Boolean) as [number, number][];
    if (cuaToi.length === 0) return [];

    const out = new Set<string>();
    for (const s of segs) {
        if (cungKtv(s.ktvId, myKtvId)) continue;
        const k = khoang(s);
        if (!k) continue;
        // Chồng giờ: bắt đầu người này trước khi người kia kết thúc, và ngược lại.
        if (cuaToi.some(([a, b]) => k[0] < b && a < k[1])) out.add(String(s.ktvId));
    }
    return [...out];
}

/** Gộp đồng đội trên NHIỀU dịch vụ (một dòng lịch sử có thể gộp vài dịch vụ). */
export function coWorkersOfItems(items: any[], myKtvId: string): string[] {
    const out = new Set<string>();
    for (const it of items || []) for (const k of coWorkersOf(it, myKtvId)) out.add(k.trim().toUpperCase());
    return [...out];
}
