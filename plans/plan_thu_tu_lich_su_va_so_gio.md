# Plan: Sắp đúng thứ tự thời gian ở trang Lịch sử và Sổ giờ tích luỹ

**Mức 2**: phần B sửa `lib/services/KtvOfficeScoreService.ts`, là service tính số dư giờ. Phần A thuộc Mức 1.
**Trạng thái:** đã làm xong (14/09). User duyệt "OK làm luôn đi".

Kết quả test trên DB thật, chạy cả giờ máy và `TZ=UTC`, hai lần ra giống hệt nhau:
- T016 sổ giờ: Cắt tóc 23:20 (còn 39.98) → Ráy tai 23:01 (39.80) → Phạt 20:36 (39.77) → Test +50h (44.77). Tổng cũ 39.98 bằng tổng mới 39.98, dòng đầu bằng tổng.
- Rà 13 KTV Loại D có sổ giờ tháng 09 (12 người có tua qua nửa đêm): 0 lệch tổng, 0 dòng đầu khác tổng, 0 tua cùng ngày sai thứ tự.
- Lịch sử T016 14/09 qua route thật: NDK-001 (xong 23:39) → 001-B (23:30) → 001-C (23:05).
- `tsc --noEmit` không lỗi. Admin và KTV gọi cùng `hoursLedger` nên tự khớp.

## 1. Lỗi đang gặp (dữ liệu thật T016, ngày 14/09)

Mốc giờ thật, giờ VN:

| Việc | Mốc thật |
|---|---|
| Cộng test +50h | 20:15 (ghi sổ) |
| Phạt đến muộn −5h | 20:36 (lúc điểm danh) |
| 001-14092026-C "Lấy ráy tai" | bắt đầu 23:01, xong 23:05 |
| 001-14092026-B "Gói cắt tóc 1" | bắt đầu 23:20, xong 23:30 |

**A. Danh sách đơn ở Lịch sử:** C đang nằm trên B, trong khi B xong sau.
Nguyên nhân: `KTVHistory.logic.ts:130` sắp theo `createdAt` của **bill**. Hai khách A, B, C cùng một bill nên cùng `createdAt` (10:10), bằng nhau thì thứ tự là ngẫu nhiên.

**B. Sổ giờ tích luỹ:** đang hiện `Phạt 20:36` → `Cắt tóc 23:20` → `Ráy tai 23:01` → `Test +50h`.
Đúng phải là `Cắt tóc 23:20` → `Ráy tai 23:01` → `Phạt 20:36` → `Test +50h 20:15`.
Nguyên nhân nằm ở `KtvOfficeScoreService.hoursLedger` (dòng 475):
1. Có luật cố ý "cùng ngày thì giờ làm trước, phạt sau". Vì vậy phiếu phạt luôn bị đẩy lên đầu ngày trên màn hình, dù xảy ra trước các tua.
2. Mốc giờ được so như **chuỗi**. Tua lưu dạng `2026-09-14 16:01:10` (không có múi giờ), phiếu phạt lưu dạng `2026-09-14T13:36:09+00:00`. Hai kiểu viết khác nhau nên so chuỗi không phản ánh đúng trước sau.
3. Dòng không có giờ bắt đầu (dòng test +50h, và mọi dòng quầy cộng tay) có `at = null`, nên luôn bị xếp là cũ nhất trong ngày.

## 2. Cách sửa

### A. Lịch sử đơn (Mức 1)
- `app/api/ktv/history/route.ts`: mỗi dòng trả thêm `finishedAt`, lấy theo thứ tự ưu tiên:
  1. `actualEndTime` muộn nhất trong các chặng **của chính KTV này**;
  2. `timeEnd` của item;
  3. `timeStart` của bill;
  4. `createdAt`.
  Không đổi trường nào đang có.
- `app/ktv/history/KTVHistory.logic.ts:130`: sắp theo `finishedAt` (thiếu thì dùng `createdAt`), mới nhất trên cùng. Phiếu kỷ luật vẫn dùng `createdAt`.
- Đơn đang làm chưa xong không có giờ xong nên dùng giờ bắt đầu, vẫn nằm đúng chỗ theo lúc bắt đầu.

### B. Sổ giờ (Mức 2)
- Bỏ luật "cùng ngày giờ làm trước, phạt sau". Sắp theo: **ngày làm việc**, sau đó **mốc giờ thật tính ra mili-giây**.
  - Chuỗi không có múi giờ thì gắn `Z`, giống `fmtClock` trong `lib/hours-format.ts`. Nhờ vậy tua và phiếu phạt so được với nhau.
  - Tua không có `booking_time_start` thì dùng `created_at` của dòng sổ (lúc ghi sổ). `normalize()` của `KtvDLedgerReader` chưa trả `created_at` thì bổ sung.
  - Không có mốc nào thì xếp đầu ngày, như hôm nay.
- Số dư "Còn" vẫn cộng dồn theo chiều thời gian, nhưng giờ là thời gian **thật**.

**Hệ quả với con số:**
- Tổng giờ tháng, tổng giờ làm, tổng giờ phạt: **không đổi**, chỉ đổi thứ tự cộng.
- Số "Còn" ở từng dòng trong cùng một ngày sẽ khác hôm nay. VD T016 ngày 14/09:
  - Hôm nay: Test 44h46 → Ráy tai 44h48 → Cắt tóc 44h59 → Phạt 39h59.
  - Sau khi sửa: Test 44h46 → Phạt 39h46 → Ráy tai 39h48 → Cắt tóc 39h59.
  - Dòng mới nhất vẫn là **39h59**, khớp tổng.
- Một ngày bị phạt trước khi có tua thì "Còn" giữa ngày có thể xuống thấp hoặc âm, rồi tăng lại. Đó là đúng diễn biến thật.
- Thứ tự nhận tua, khoá tài khoản, hạn mức từ chối tua: **không bị ảnh hưởng**. Các chỗ đó dùng tổng (`netHoursByStaff`, `quyGioThang`), không dùng số dư từng dòng.

## 3. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Lịch sử (`/api/ktv/history`), Sổ giờ (`/api/ktv/hours-ledger`, `/api/ktv/hours-ranking`) | Office → Giờ (`/api/admin/ktv-office/hours-detail`, `/api/admin/ktv-office/staff/[id]`) | `KtvOfficeScoreService.hoursLedger`, `HoursLedgerSheet` | Sửa ở service, 2 phía đổi cùng lúc |
| Số liệu | Tổng không đổi, "Còn" từng dòng đổi theo thứ tự thật | Giống hệt, cùng service | Công thức giờ ròng không đổi | Khớp |
| Realtime | Không đổi | Không đổi | | Không ảnh hưởng |
| Quyền xem | Không đổi | Không đổi | | Không ảnh hưởng |

Lịch sử đơn (phần A) chỉ có phía KTV. Phía quản lý không có danh sách này nên không bị ảnh hưởng.

## 4. Test

1. Mô phỏng bằng dữ liệu thật T016 tháng 09: in thứ tự và "Còn" trước/sau. Tổng phải bằng nhau, dòng đầu phải bằng tổng.
2. Ca đêm qua 06:00: tua 18:57 và tua 00:54 rạng sáng hôm sau cùng ngày làm việc phải đúng thứ tự (trường hợp comment cũ đã ghi).
3. Chạy thêm dưới `TZ=UTC` (server Vercel chạy UTC).
4. So `hours-detail` (admin) và `hours-ledger` (KTV) cho cùng T016: giống nhau từng dòng.
5. Lịch sử T016 ngày 14/09: B nằm trên C.
6. `tsc --noEmit`.
