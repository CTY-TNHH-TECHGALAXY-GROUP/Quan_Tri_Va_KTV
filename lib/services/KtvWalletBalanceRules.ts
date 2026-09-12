/**
 * Quy tắc SỐ DƯ của ví KTV — nguồn duy nhất.
 *
 * Tách khỏi `app/api/ktv/wallet/timeline/route.ts` để hai chuyện:
 *  1. Đúng mục 4.2 của CLAUDE.md — công thức nằm ở `lib/services/*`.
 *  2. Mô phỏng được bằng mock data (mục 10). Nhánh `HELD` của A/B/C hiện KHÔNG
 *     có dữ liệu thật nào chạm tới, nên nếu không tách ra thì không cách nào
 *     chứng minh nó xử lý đúng.
 */

/** Một dòng trên timeline ví — chỉ khai những trường quyết định số dư. */
export interface WalletTimelineEntry {
    type?: string;
    status?: string;
    amount: number | string;
    created_at?: string;
    is_provisional?: boolean;
    running_balance?: number;
    [key: string]: any;
}

/**
 * Dòng này có được tính vào SỐ DƯ chưa.
 *
 * Phải khớp đúng định nghĩa của `KtvWalletService.getBalance` — hai bên lệch
 * nhau là màn Ví hiện hai con số khác nhau (T069 từng lệch 10.500đ vì số dư lớn
 * bỏ tua tạm tính còn số dư luỹ kế thì cộng vào).
 *
 * KHÔNG tính:
 *  · `TIP` — KTV cầm tiền mặt trực tiếp, không qua ví
 *  · dòng bị từ chối
 *  · tua CHƯA CHỐT: loại D `is_provisional` (chờ khách đánh giá), A/B/C `HELD`
 *    (đang tạm giữ). `getBalance` cũng chỉ cộng tua đã qua `checkIsItemPassed`.
 *
 * ⚠️ Lệnh rút tiền `PENDING` thì VẪN TÍNH — số dư lớn đã trừ `total_pending`.
 * Nên KHÔNG được chặn theo `status === 'PENDING'` chung chung.
 *
 * ⚠️ `HELD` hiện là nhánh ngủ: `KtvCommissionService.checkIsItemPassed` đã bị
 * rút ruột thành `return { isPassed: true }` ở commit `bddf3272` ("loại bỏ hoàn
 * toàn cơ chế Hold Salary theo yêu cầu khách hàng"), nên không dòng `HELD` nào
 * được sinh ra nữa. Giữ nhánh này để nếu quy chế giam tiền quay lại thì số dư
 * không âm thầm sai.
 */
export function countsTowardBalance(item: WalletTimelineEntry): boolean {
    if (item.type === 'TIP') return false;
    if (item.status === 'REJECTED') return false;
    if (item.is_provisional === true) return false;
    if (item.status === 'HELD') return false;
    return true;
}

/**
 * Gắn số dư luỹ kế cho từng dòng.
 *
 * Cộng theo chiều THỜI GIAN TĂNG DẦN; cùng một mốc giờ thì cộng trước trừ sau,
 * tức đúng chiều ngược với thứ tự hiển thị. Nhờ vậy dòng trên cùng của danh
 * sách mang số dư hiện tại.
 *
 * Dòng chưa chốt vẫn được gắn `running_balance` (bằng số dư của dòng chốt gần
 * nhất) — giao diện tự quyết có hiện hay không.
 *
 * ⚠️ Nhánh loại D trước đây `return` trước khi tới đoạn này nên MỌI dòng đều
 * thiếu `running_balance`, giao diện đổ về 0 — KTV vừa được cộng 33.333đ mà
 * dòng nào cũng ghi "Số dư: 0đ".
 */
export function attachRunningBalance(timeline: WalletTimelineEntry[], minDeposit = 0): void {
    const asc = timeline.slice().sort((a, b) => {
        const dt = new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime();
        if (dt !== 0) return dt;
        return (Number(a.amount) < 0 ? 1 : 0) - (Number(b.amount) < 0 ? 1 : 0);
    });

    let balance = 0;
    for (const item of asc) {
        if (countsTowardBalance(item)) {
            balance += Number(item.amount);
        }
        item.running_balance = balance - minDeposit;
    }
}
