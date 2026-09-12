/**
 * ================================================================
 * MỐC GIỜ TRONG MỘT CHẶNG (segment)
 * ================================================================
 * Nguồn duy nhất trả lời: "chặng này KTV làm thực bao nhiêu phút?"
 *
 * ⚠️ TRƯỚC ĐÂY LÀM SAI THẾ NÀY — đừng quay lại:
 * `resumeItem` từng DỜI `actualStartTime` tới trước đúng bằng thời gian đã
 * tạm dừng, để đồng hồ đếm ngược chạy tiếp cho khớp. Đồng hồ thì đúng, nhưng
 * mốc bắt đầu THẬT bị ghi đè mất — ô "Bắt đầu" trên Kanban nhảy muộn đi sau
 * mỗi lần tạm dừng, và không cách nào phục hồi con số gốc.
 *
 * NAY: `actualStartTime` BẤT BIẾN. Mỗi lần tạm dừng ghi thêm một khoảng vào
 * `seg.pauses[]`, và giờ làm thực = (kết − bắt đầu) − Σ(khoảng dừng).
 * Đồng hồ vẫn mượt vì hạn kết thúc tính động: bắt đầu + giờ gán + Σ(dừng).
 *
 *   {
 *     "actualStartTime": "…T04:20:52Z",     // không bao giờ đổi
 *     "actualEndTime":   "…T05:30:00Z",
 *     "pauses": [ { "from": "…T04:40:00Z", "to": "…T04:45:00Z" } ]
 *   }
 *
 * Dữ liệu cũ không có `pauses` → Σ = 0 → công thức thoái về đúng như trước,
 * nên KHÔNG cần migrate.
 *
 * 🔗 Ba nơi tính tiền/giờ đều phải đi qua file này, sót một nơi là lệch lương:
 *   - KtvDLedgerEngine.computeMinutes          (tiền + giờ loại D)
 *   - KtvTypeDTurnService.calculateActualMinutes (giờ tích luỹ → thứ tự tua)
 *   - KtvCommissionService.calculateItemDuration (tiền A/B/C)
 */

/** Mốc giờ trong DB khi thì ISO, khi thì 'YYYY-MM-DD HH:mm:ss' trần. */
export function parseTimeMs(v: any): number {
    if (!v) return NaN;
    if (typeof v !== 'string') return new Date(v).getTime();
    const normalized = v.includes('T') ? v : v.replace(' ', 'T');
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(normalized);
    return new Date(hasZone ? normalized : normalized + 'Z').getTime();
}

/**
 * Chặng bị tước sạch quyền lợi (KTV bị đổi ra, hoặc đơn huỷ do lỗi KTV).
 * Vẫn nằm trong đơn để biết ai từng làm cho khách, nhưng không quy ra tiền/giờ.
 */
export function isVoidedSegment(seg: any): boolean {
    return seg?.voided === true;
}

/**
 * Tổng thời gian đã tạm dừng của một chặng, tính bằng mili giây.
 *
 * @param seg      chặng
 * @param openEnd  mốc dùng để đóng khoảng dừng còn hở (chưa bấm tiếp tục).
 *                 Thường là `actualEndTime` của chặng, hoặc `Date.now()` khi
 *                 đang tính đồng hồ chạy trực tiếp. Bỏ trống thì khoảng còn hở
 *                 được tính là 0.
 */
export function pausedMsOf(seg: any, openEnd?: string | number | null): number {
    const list = Array.isArray(seg?.pauses) ? seg.pauses : [];
    if (list.length === 0) return 0;

    const openEndMs = openEnd == null
        ? NaN
        : (typeof openEnd === 'number' ? openEnd : parseTimeMs(openEnd));

    let total = 0;
    for (const p of list) {
        const from = parseTimeMs(p?.from);
        if (!Number.isFinite(from)) continue;

        let to = parseTimeMs(p?.to);
        if (!Number.isFinite(to)) to = openEndMs;      // còn đang dừng
        if (!Number.isFinite(to) || to <= from) continue;

        total += to - from;
    }
    return total;
}

/**
 * Số mili giây KTV thực sự làm trong chặng, đã trừ các khoảng tạm dừng.
 * Trả `null` khi chặng thiếu mốc để tính (chưa bắt đầu, hoặc chưa kết thúc và
 * người gọi không đưa `endOverride`).
 */
export function workedMsOf(seg: any, endOverride?: string | number | null): number | null {
    const start = parseTimeMs(seg?.actualStartTime);
    if (!Number.isFinite(start)) return null;

    const rawEnd = endOverride ?? seg?.actualEndTime;
    const end = typeof rawEnd === 'number' ? rawEnd : parseTimeMs(rawEnd);
    if (!Number.isFinite(end)) return null;

    const worked = end - start - pausedMsOf(seg, end);
    return worked > 0 ? worked : 0;
}

/**
 * Hạn kết thúc thực tế của chặng, đã cộng bù thời gian tạm dừng.
 * Dùng cho đồng hồ đếm ngược và cho cột "Kết thúc" dự kiến.
 */
export function expectedEndMs(seg: any, assignedMins: number, now: number = Date.now()): number | null {
    const start = parseTimeMs(seg?.actualStartTime);
    if (!Number.isFinite(start)) return null;
    return start + assignedMins * 60000 + pausedMsOf(seg, now);
}

// ── Thao tác chuẩn trên chặng ───────────────────────────────────────
// Năm chỗ từng chép tay cùng một đoạn "đóng khoảng dừng còn hở", ba chỗ chép
// tay đoạn "tước chặng". Chép tay là sót: mỗi lần thêm một luồng mới lại quên
// một nhánh. Từ đây mọi nơi phải gọi hai hàm dưới.

/** Vì sao khoảng tạm dừng bị đóng lại. */
export type PauseCloseReason = 'RESUME' | 'FINISH' | 'CANCEL' | 'SWAP';

/**
 * Đóng khoảng tạm dừng đang hở của một chặng.
 *
 * ⚠️ `closedBy` KHÔNG phải để trang trí. Khi chốt đơn (FINISH/CANCEL/SWAP) ta
 * đóng khoảng ngay tại mốc bấm dừng, nên `from === to`. Nhìn dữ liệu thô thì
 * nó giống hệt một lần "tạm dừng rồi tiếp ngay" — đã có người (và chính tôi)
 * đọc nhầm T016 thành "có bấm Tiếp" trong khi thực tế không hề. Ghi rõ lý do
 * đóng thì `scenarioOf` phân biệt được, khỏi phải đoán.
 *
 * @returns true nếu có sửa gì đó.
 */
export function closeOpenPause(seg: any, at: string, closedBy: PauseCloseReason): boolean {
    if (!seg || !Array.isArray(seg.pauses)) return false;
    const idx = seg.pauses.findIndex((p: any) => p && p.from && !p.to);
    if (idx === -1) return false;
    seg.pauses[idx] = { ...seg.pauses[idx], to: at, closedBy };
    return true;
}

/**
 * Tước sạch quyền lợi của một chặng: không tiền, không giờ tích luỹ.
 *
 * VẪN giữ `customCommissionDuration` = số phút đã làm thật — đó là bằng chứng
 * đối soát, và là thứ màn hình dùng để hiện "đã làm 25p · 0đ". Đừng xoá.
 */
export function voidSegment(seg: any, endMark: string, note: string): void {
    if (!seg) return;
    const worked = workedMsOf(seg, seg.actualEndTime || endMark);
    if (worked !== null) seg.customCommissionDuration = Math.round(worked / 60000);
    seg.voided = true;
    seg.note = note;
}

// ── Nhận diện kịch bản nghiệp vụ ────────────────────────────────────

/**
 * Sáu kịch bản trong plans/plan_tam_dung_huy_ket_thuc_som.md.
 * A và C4 cố ý gộp — cùng kết quả tiền, và quầy chỉ gõ lý do tự do nên máy
 * không phân biệt được (chốt 06/09/2026).
 */
export type Scenario =
    | 'BINH_THUONG'
    | 'B_RA_SOM'
    | 'C2_DOI_KTV'
    | 'C3_HUY_CO_CONG_GIO'
    | 'A_C4_HUY_MAT_TRANG';

export interface ScenarioInfo {
    /** Kịch bản kết thúc của dịch vụ này. */
    scenario: Scenario;
    /** Số lần quầy thật sự bấm Tạm dừng rồi bấm Tiếp (C1). */
    soLanTamDung: number;
    /** Có chặng nào bị tước quyền lợi không. */
    coChangBiTuoc: boolean;
}

/**
 * Suy ra kịch bản từ một BookingItem. NGUỒN DUY NHẤT — Kanban, lịch sử KTV,
 * báo cáo và script đối soát đều phải gọi hàm này, đừng tự đoán bằng `note`.
 */
export function scenarioOf(item: any): ScenarioInfo {
    let segs: any[] = [];
    try { segs = typeof item?.segments === 'string' ? JSON.parse(item.segments) : (item?.segments || []); } catch { }
    if (!Array.isArray(segs)) segs = [];

    let opts: any = item?.options;
    if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { opts = {}; } }
    opts = opts || {};

    // Lần tạm dừng THẬT = có bấm Tiếp. Loại các khoảng bị đóng để chốt đơn:
    // ưu tiên cờ `closedBy`, dữ liệu cũ chưa có cờ thì so MỐC THỜI GIAN
    // (không so chuỗi — '…Z' và '…+00:00' là cùng một lúc mà khác chuỗi).
    let soLanTamDung = 0;
    for (const seg of segs) {
        for (const p of (Array.isArray(seg?.pauses) ? seg.pauses : [])) {
            if (!p?.from || !p?.to) continue;
            if (p.closedBy && p.closedBy !== 'RESUME') continue;
            if (!p.closedBy && parseTimeMs(p.to) <= parseTimeMs(p.from)) continue;
            soLanTamDung++;
        }
    }

    const coChangBiTuoc = segs.some(isVoidedSegment);

    let scenario: Scenario = 'BINH_THUONG';
    if (item?.status === 'CANCELLED') {
        scenario = opts.cancelCredit === 'WORKED' ? 'C3_HUY_CO_CONG_GIO' : 'A_C4_HUY_MAT_TRANG';
    } else if (segs.some((s: any) => s?.note === 'CHANGED')) {
        scenario = 'C2_DOI_KTV';
    } else if (opts.earlyLeave === true) {
        scenario = 'B_RA_SOM';
    }

    return { scenario, soLanTamDung, coChangBiTuoc };
}

/** Nhãn tiếng Việt để hiện lên màn hình. */
export const SCENARIO_LABEL: Record<Scenario, string> = {
    BINH_THUONG: 'Bình thường',
    B_RA_SOM: 'Khách xuống sớm',
    C2_DOI_KTV: 'Đã đổi KTV',
    C3_HUY_CO_CONG_GIO: 'Huỷ — có cộng giờ',
    A_C4_HUY_MAT_TRANG: 'Huỷ — mất trắng',
};

/**
 * Chặng này bị QUẦY chốt hộ, không phải do KTV tự bấm xong?
 *
 * Dùng cho guard chống "ghost completion" trên app KTV: guard đó ép trạng thái
 * ngược về IN_PROGRESS khi `isTimerRunning` còn bật, mà quầy chốt hộ thì KTV
 * chưa hề bấm xong nên cờ vẫn bật → đồng hồ chạy mãi và luồng đứng im.
 *
 * ⚠️ ĐỪNG kiểm bằng MỘT chuỗi note. Đã sai đúng kiểu đó: guard chỉ nhận
 * 'FINISHED_EARLY_ON_PAUSE' nên nút Huỷ (ghi 'CANCELLED_NO_CREDIT', hoặc KHÔNG
 * ghi note nào khi quầy chọn cộng giờ) vẫn bị chặn. Thêm luồng mới là lại sót.
 * Nhận theo DẤU HIỆU chung: khoảng dừng đóng bởi quầy, hoặc chặng bị tước.
 */
export function endedByCounter(seg: any): boolean {
    if (!seg?.actualEndTime) return false;
    if (seg.voided === true) return true;

    const COUNTER_NOTES = ['FINISHED_EARLY_ON_PAUSE', 'CANCELLED_NO_CREDIT', 'CHANGED'];
    if (COUNTER_NOTES.includes(String(seg.note))) return true;

    const pauses = Array.isArray(seg.pauses) ? seg.pauses : [];
    return pauses.some((p: any) => p?.closedBy && p.closedBy !== 'RESUME');
}

/**
 * Mốc thời gian → giờ đồng hồ "HH:mm" THEO GIỜ VIỆT NAM.
 *
 * ⚠️ Đừng dùng `new Date(x).getHours()` ở phía server. Nó trả giờ của MÁY CHỦ, mà
 * máy chủ chạy UTC — ra lệch đúng 7 tiếng. Các cột `seg.startTime` / `seg.endTime`
 * lưu giờ đồng hồ VN (điều phối ghi từ trình duyệt), nên ghi UTC vào là thẻ
 * Kanban vẽ khoảng giờ vô nghĩa: quan sát 11/09/2026 trên đơn WB-10092026-014,
 * T069 vào lúc 03:52 mà thẻ hiện "20:52 → 21:50".
 *
 * Việt Nam không có giờ mùa hè nên cộng cứng +7 là đủ, không phụ thuộc ICU.
 */
export function gioDongHoVN(at: string | number | Date): string {
    const ms = at instanceof Date ? at.getTime() : (typeof at === 'number' ? at : parseTimeMs(at));
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms + 7 * 60 * 60 * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
