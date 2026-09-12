# Plan — Ví gom giao dịch theo NGÀY LÀM VIỆC, kèm giờ thật

> **Mức 2** — chạm ví/tiền (`app/api/ktv/wallet/timeline/route.ts`, `app/ktv/wallet/page.tsx`).
> **Trạng thái**: ✅ Đã làm (12/09/2026), user duyệt: gom theo ngày làm việc + ghi thêm giờ thật.
> **Ngày**: 12/09/2026 · **Nhánh**: `feat/bit-lo-hong-phase1`

---

## 1. Hiện tượng

Ví gom giao dịch theo **ngày lịch**, trong khi spa chốt ngày làm việc lúc **6h sáng** (`cutoff = 6`). Tua chạy sau nửa đêm bị xếp sang ngày hôm sau.

Số thật từ sổ cái:

| Đơn | Ngày **làm việc** | Giờ làm thật | Ngày **lịch** | Ví đang xếp vào |
|---|---|---|---|---|
| `007-10092026-A` | **10/09** | 00:57 sáng 11/09 | 11/09 | ❌ 11/09 |
| `WB-11092026-003` | **11/09** | 22:02 tối 11/09 | 11/09 | ✅ 11/09 |

Nhóm "11/09" trên Ví đang trộn hai ngày làm việc, và tua của ngày 10/09 nằm dưới cùng như thể là tua mở màn ngày 11/09.

**Tiền từng đơn KHÔNG sai** (16.667đ và 25.000đ đều đúng). Sai ở **ngày mà tua được xếp vào**.

## 2. Nguyên nhân gốc rễ

`app/ktv/wallet/page.tsx` dòng ~118 — `groupedTimeline` tự dựng khoá nhóm từ mốc giờ:

```
new Date(item.created_at).toLocaleDateString('vi-VN', { weekday, day, month, year })
```

Đây là **ngày lịch**, không xét cutoff. Hai lỗi cùng lúc:
1. Sai nghiệp vụ — không dùng ngày làm việc của spa.
2. Vi phạm mục 4.2 — công thức ngày nằm trong `.tsx` của riêng phía KTV, thay vì lấy từ server/service.

Sổ cái đã ghi sẵn `work_date` đúng (`007-10092026-A` → `2026-09-10`); Ví chỉ đơn giản không đọc tới nó.

## 3. Đề xuất (một phương án)

**Server gắn sẵn ngày làm việc cho từng dòng; trang chỉ gom theo trường đó.**

| # | File | Thay đổi |
|---|---|---|
| 1 | `app/api/ktv/wallet/timeline/route.ts` | Mỗi dòng trả thêm `business_date`. Dòng tua loại D lấy thẳng `g.work_date` của sổ cái (khỏi tính lại). Dòng còn lại (giặt đồ, thưởng/phạt, rút tiền, tip, và toàn bộ nhánh A/B/C) suy ra bằng `toBusinessDate(new Date(created_at), cutoffHours)` với `cutoffHours = await getDayCutoffHours(supabase)`. |
| 2 | `app/ktv/wallet/page.tsx` | `groupedTimeline` gom theo `item.business_date`, không tự tính ngày nữa. Tiêu đề nhóm dựng từ chuỗi `YYYY-MM-DD` đó. |
| 3 | `app/ktv/wallet/page.tsx` | Mỗi thẻ hiện giờ bằng `fmtClockOnDate(created_at, business_date)` của `lib/hours-format.ts` — tự thêm ngày lịch khi giờ rơi sang hôm sau: `00:57 (11/09)`. Đây đúng hàm màn Office của quầy đang dùng. |

Dùng lại `toBusinessDate` / `getDayCutoffHours` (`lib/business-date.ts`) và `fmtClockOnDate` (`lib/hours-format.ts`) — không viết công thức mới.

**Không đụng tới tiền**: không đổi số tiền, không đổi thứ tự sắp xếp (vẫn mới nhất lên trên, cùng mốc thì trừ trên cộng), không đổi số dư luỹ kế.

## 4. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Ví (`/api/ktv/wallet/timeline`) — gom nhóm + hiện giờ | Màn Office giờ (`admin/ktv-office/hours`) đã gom theo `work_date` và đã dùng `fmtClockOnDate` | `lib/business-date.ts`, `lib/hours-format.ts` | Sửa phía KTV; **quản lý không ảnh hưởng — vì đã đúng sẵn** |
| Số liệu tiền | Ví đọc `KTVDTurnLedger` | Báo cáo đọc cùng sổ cái | `computeMinutes` | **Không đổi** — chỉ đổi cách gom nhóm hiển thị, không đụng công thức |
| Ngày làm việc | Ví: đang tự tính ngày lịch → chuyển sang `business_date` từ server | Office: `work_date` của sổ cái | `toBusinessDate` + cutoff trong `SystemConfigs` | Sau khi sửa: **khớp** |
| Sổ giờ tích luỹ (KTV) | Đã gom theo `work_date` | Office cùng nguồn | `KtvOfficeScoreService.hoursLedger` | **Không ảnh hưởng — vì đã đúng** |
| Màn Lịch Sử (KTV) | Lọc theo `selectedDates` gửi lên `/api/ktv/history` | — | — | **Cần xác nhận** — chưa rà API đó lọc theo ngày lịch hay ngày làm việc; nếu lệch thì tách việc riêng |
| Realtime / refresh | Ví tự fetch lại | Không | — | Không đổi |
| Quyền xem | KTV chỉ thấy ví mình | — | — | Không đổi |

## 5. Kiểm chứng trước khi apply (mục 10 + 4.3)

1. **Mô phỏng mốc biên** với `cutoff = 6`: 23:59, 00:00, 00:57, 05:59, 06:00, 06:01 → ngày làm việc ra đúng; chạy thêm dưới `TZ=UTC` (mục 13.5).
2. **Ca thật**: `007-10092026-A` phải rơi vào nhóm **10/09** và hiện `00:57 (11/09)`; `WB-11092026-003` giữ nhóm 11/09.
3. **Đối chiếu 2 phía (mục 4.3)**: cùng KTV + cùng ngày làm việc, tổng tiền tua trên Ví phải bằng tổng đọc từ sổ cái theo `work_date`, và số giờ trên Ví khớp màn Office.
4. Kiểm tra không dòng nào mất `business_date` (giặt đồ, rút tiền, tip, thưởng/phạt, nhánh A/B/C).

## 6. Rủi ro

- Các thẻ sẽ **nhảy nhóm ngày** sau khi sửa — tổng của một ngày trên Ví đổi so với hôm qua. Đây là kết quả mong muốn, nhưng nên báo KTV biết để khỏi tưởng mất tiền.
- Nếu quản lý đổi `cutoff` trong `SystemConfigs`, cách gom nhóm đổi theo — đúng thiết kế, nhưng lịch sử cũ sẽ nhìn khác đi.

---

## 7. Kết quả thực hiện

**Code** — đúng 2 file, không đụng công thức tiền:
- `app/api/ktv/wallet/timeline/route.ts`: thêm `attachBusinessDate()` quét MỘT LƯỢT cuối, gắn `business_date` cho mọi dòng bằng `toBusinessDate(created_at, cutoff)`. Áp cho cả nhánh loại D lẫn A/B/C.
- `app/ktv/wallet/page.tsx`: `groupedTimeline` gom theo `item.business_date`; tiêu đề nhóm dựng bằng `fmtWeekday` + `fmtFullDate`; giờ trên thẻ dùng `fmtClockOnDate` → tự kèm ngày lịch khi rơi sau nửa đêm.

**Lệch so với plan:** plan định lấy thẳng `work_date` cho dòng tua loại D và chỉ suy ra cho dòng khác. Thực tế suy từ `created_at` là **đủ cho mọi dòng** — sổ cái cũng tính `work_date` bằng chính `toBusinessDate` trên cùng mốc giờ, nên hai con số luôn trùng (đã đối chiếu 17 cặp, 0 lệch). Quét một lượt cuối an toàn hơn gắn ở 7 chỗ `push`: dòng nào thêm về sau cũng tự có.

**Kiểm chứng**
- Mô phỏng 7 mốc biên (22:02, 23:59, 00:00, 00:57, 05:59, 06:00, 06:01) — đúng cả ngày làm việc lẫn chuỗi giờ; chạy lại dưới `TZ=UTC` cũng đạt.
- API thật: 28/28 dòng có `business_date`. Đơn `007-10092026-A` (00:57 sáng 11/09) nay nằm ở nhóm **10/09**, tách khỏi `WB-11092026-003` của ngày 11/09.
- Đối chiếu 2 phía (mục 4.3): tổng tiền tua trên Ví theo từng ngày làm việc so với sổ cái theo `work_date` — **17 cặp (KTV × ngày), 0 lệch**.
- Typecheck + eslint sạch, trang `/ktv/wallet` trả 200, dev server không lỗi.

## 8. Còn lại

- Màn Lịch Sử lọc theo `selectedDates` gửi lên `/api/ktv/history` — **chưa rà** lọc theo ngày lịch hay ngày làm việc. Tách việc riêng.
- Sau khi deploy, các thẻ sẽ nhảy nhóm ngày; nên báo KTV trước.
