# Plan — Tag khách (Khách cũ / Đã từng tới / Khách mới) một nguồn + tỉ lệ huỷ đơn

- **Mức**: 1 (nhiều file, đổi logic hiển thị 2 phía; không chạm DB, không chạm tiền/tua/giờ, không chạm `FinanceReportService.ts`).
- **Ngày**: 2026-10-06. **Trạng thái**: đã code (user OK 06/10), chưa commit. QA `scripts/qa/qa_21_customer_visit_status.ts` 17/17 (local + UTC). Đã probe 4 câu truy vấn mới trên DB thật.
- **Điều chỉnh khi code**: CRM và kiosk gắn nhãn theo trạng thái **đầu ngày hôm nay** (`computeProfileVisit`), số lượt & tỉ lệ huỷ tính toàn bộ. Lý do: nếu CRM tính cả đơn đang mở hôm nay thì khách lần đầu thành "Đã từng tới" ở CRM nhưng "Khách mới" trên thẻ. Web Booking bỏ khớp theo tên (trùng tên ≠ cùng người). Bảng điều phối bỏ đếm khách không liên hệ theo tên → "Khách mới".
- **Nhánh**: `feat/bit-lo-hong-phase1`.

---

## 1. Vấn đề

Khách `tohjenny76@yahoo.com.sg`: CRM gắn "Khách cũ", thẻ điều phối đơn 06/10 gắn "Khách mới". Nguyên nhân: **4 công thức "khách cũ" khác nhau** đang chạy song song (vi phạm rule 4.2, lệch đúng điểm 4.3-1 "điều kiện lọc trạng thái"):

| Nơi | Lọc trạng thái | Ngưỡng | Tính đơn hiện tại? |
|---|---|---|---|
| CRM `/api/customers` | mọi đơn trừ CANCELLED (kể cả NEW) | > 1 | Có |
| Dispatch `getDispatchData` | DONE/COMPLETED/FEEDBACK/CLEANING | ≥ 1 | Không |
| Web Booking `app/reception/web-booking/actions.ts` | COMPLETED/DONE/FEEDBACK (thiếu CLEANING) | ≥ 1 | Không |
| Kiosk `api/customers/identify` | 4 trạng thái hoàn tất | > 1 | Không rõ |

Thêm vào đó có **421 đơn cha kẹt NEW** từ trước 04/10 (169 đơn tháng 9), CRM đang đếm hết vào "lượt ghé".

## 2. Định nghĩa đã chốt với user (06/10)

Một hàm duy nhất trả về nhãn, **không tính đơn đang xem**:

| Nhãn | Điều kiện | Màu |
|---|---|---|
| **Khách cũ** (`RETURNING`) | ≥ 1 lượt trước đó **đã hoàn tất** | tím (giữ) |
| **Đã từng tới** (`VISITED`) | chưa có lượt hoàn tất, nhưng **(a)** có lượt trước đó chưa huỷ mà khách **thật sự có mặt**: nguồn walk-in (`*_WALK_IN`, `*_MENU`) bất kể trạng thái, hoặc nguồn web/booking (`WEB_BOOKING`, `WebBooking`, `*_BOOKING`) với trạng thái **khác NEW**; **hoặc (b)** hồ sơ `Customers` tạo trước ngày của đơn đang xem | vàng nhạt |
| **Khách mới** (`NEW`) | không có gì ở trên | xám (giữ) |

- "Lượt" = nhóm đơn theo `parent_booking_id || id` (đơn cha + các đơn con tách ra là **một lượt**). Lượt hoàn tất khi đơn cha hoặc **bất kỳ** đơn con ở DONE/COMPLETED/FEEDBACK/CLEANING. Đơn cha `SPLIT` không tự tính là hoàn tất.
- Đơn web NEW chưa check-in **không** tính "đã từng tới" (user chốt).
- **Tỉ lệ huỷ** = số lượt `CANCELLED` ÷ (lượt CANCELLED + lượt hoàn tất), tính trên lượt đã kết thúc; lượt còn mở không tính. Hiện dạng `2/7 · 29%`. Không có lượt kết thúc → hiện `—`.

## 3. Các bước

### Bước 1 — `lib/services/CustomerVisitService.ts` (mới, thuần tính toán, không gọi DB)
```ts
export type VisitStatus = 'RETURNING' | 'VISITED' | 'NEW';
export interface VisitBookingRow { id; status; source; parent_booking_id; bookingDate; createdAt; }
export function computeCustomerVisit(rows: VisitBookingRow[], opts: { excludeBookingId?: string; profileCreatedAt?: string|null; asOf?: string }): {
  status: VisitStatus; completedVisits: number; attendedVisits: number; cancelledVisits: number; closedVisits: number; cancelRate: number|null;
}
export const VISIT_LABEL: Record<VisitStatus, string>  // 'Khách cũ' | 'Đã từng tới' | 'Khách mới'
```
Nhận mảng đơn đã lấy sẵn → gom lượt → tính. Mọi nơi gọi chung; mock được (QA).

### Bước 2 — Dispatch `app/reception/dispatch/actions.ts` (`getDispatchData`)
- Thay khối "Fetch historical visits" (dòng ~308–385) bằng: lấy đơn trước đó theo `customerId` (có) / phone thật / email thật, **kèm `status, source, parent_booking_id, createdAt`**, bỏ lọc `COMPLETED_STATUSES`, rồi gọi `computeCustomerVisit` với `excludeBookingId = b.id`.
- Trả thêm `visitStatus`, `cancelRate` lên `PendingOrder` (`types.ts`, `useDispatchBoard.logic.ts`); giữ `isReturning = status === 'RETURNING'` để code cũ không gãy.
- **Cô lập (rule 4.5-4):** toàn bộ khối này bọc `try/catch`; lỗi → mọi đơn `visitStatus = 'NEW'`, log cảnh báo, **bảng điều phối vẫn tải**.
- Thẻ Kanban `page.tsx` ~2760: 3 nhãn thay 2; tooltip `Đã hoàn tất N lần · Huỷ M lần`.

### Bước 3 — CRM `/api/customers/route.ts`
- Bỏ `.neq('status','CANCELLED')` ở query Bookings (cần đếm huỷ), **lọc lại** CANCELLED ở các chỗ thống kê cũ (`totalSpent`, khung giờ, KTV quen…) để số liệu không đổi.
- `visitCount` = `completedVisits` (không còn đếm NEW). Thêm `visitStatus`, `cancelledVisits`, `cancelRate`.
- `page.tsx:884` và `CustomerDetailModal.tsx:340`: nhãn theo `visitStatus` (3 nhãn), bỏ `visitCount > 1`. Modal thêm ô "Tỉ lệ huỷ". Bộ lọc "Phân loại" thêm "Đã từng tới".
- `lib/types.ts` `Customer`: thêm 3 trường.

### Bước 4 — Web Booking `app/reception/web-booking/actions.ts` + `WebBookingCard.tsx`
- Thay query "COMPLETED/DONE/FEEDBACK limit 1" bằng lấy đơn trước đó rồi `computeCustomerVisit`. Thẻ hiện 3 nhãn.

### Bước 5 — Kiosk `api/customers/identify/customerIdentify.service.ts`
- `visitCount` = `completedVisits`; `isReturning` = `RETURNING`; câu chào "quay lại lần thứ N" dùng `completedVisits + 1`. "Đã từng tới" → câu chào trung tính (không nói "lần thứ").

### Bước 6 — Báo cáo khách `app/api/finance/reports/customers/route.ts` + `RevenueCustomers`
- Query thêm đơn cha `CANCELLED` trong khoảng ngày (query riêng trong route, **không sửa `FinanceReportService.ts`** để giữ Mức 1).
- Trả `cancelSummary: { cancelled, closed, rate }` toàn kỳ và `cancelRate` cho từng dòng Top khách. UI thêm 1 ô KPI "Tỉ lệ huỷ" + cột trong bảng Top khách.

### Bước 7 — Chữ hiển thị
- `lib/constants/customer-visit.i18n.ts` (mới): 3 nhãn + tooltip + "Tỉ lệ huỷ", dùng chung CRM / Dispatch / Web Booking.

## 4. Bảng Ảnh hưởng chéo (4.1) + Vùng nổ (4.5)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — `app/ktv/*`, `app/api/ktv/*` không đọc `isReturning`/`visitCount` (đã grep) | Dispatch Kanban, CRM list + modal, Web Booking card, Kiosk identify, Báo cáo doanh thu tab Khách | `CustomerVisitService` (mới), `lib/types.ts`, `Bookings` (chỉ đọc) | Sửa phía Quản lý |
| Số liệu | — | `visitCount` CRM đổi nghĩa: từ "số đơn không huỷ" sang "số lượt hoàn tất" → **giảm** với khách có đơn NEW kẹt. Tỉ lệ huỷ mới. | công thức một chỗ | Khớp sau sửa; báo user vì số CRM đổi |
| Realtime | — | Dispatch `fetchData()` sẵn có; CRM tải lại theo trang | `Bookings` | Đồng bộ |
| Quyền xem | KTV không thấy | Quầy/admin như hiện tại | — | Không lộ gì mới |
| **4.5-1 dùng chung** | | `getDispatchData` (đường nóng bảng điều phối), `/api/customers` (đường nóng CRM) | | |
| **4.5-2 nếu sai sập gì** | | Sai ở Bước 2 → bảng điều phối không tải. **Chặn bằng try/catch, fallback `NEW`.** Sai ở Bước 3 → CRM không tải; cũng bọc try/catch quanh phần thống kê mới. | | |
| **4.5-3 luồng khách** | | Kiosk (identify) đổi câu chào; Web Booking card chỉ phía quầy. Email, hoá đơn, voucher: không đụng. | | |
| **4.5-4 cô lập** | | Không thêm cột vào select chính của đường nóng; chỉ thêm cột **đã probe** trên DB thật (`status, source, parent_booking_id, createdAt` — đều có, đã dùng ở probe 06/10). Không migration. | | |

## 5. QA (mục 10) — `scripts/qa/qa_21_customer_visit_status.ts`, mock, không chạm DB
1. Jenny: lượt trước walk-in NEW → `VISITED`; CRM và Dispatch ra cùng nhãn.
2. Lượt trước web NEW chưa check-in → `NEW`; web PREPARING → `VISITED`.
3. Lượt trước DONE → `RETURNING`; đơn cha SPLIT có 1 con DONE → `RETURNING`, đếm 1 lượt.
4. Không tính đơn đang xem; hồ sơ tạo trước ngày đơn, không đơn cũ → `VISITED`.
5. Tỉ lệ huỷ: 2 CANCELLED + 5 hoàn tất + 1 NEW mở → `2/7 · 29%`; không lượt kết thúc → `null`.
6. Chạy thêm `TZ=UTC` (so sánh ngày hồ sơ vs ngày đơn theo business date Asia/Bangkok).
7. In **so sánh 2 phía** cho 5 khách giả: cột CRM vs cột Dispatch phải bằng nhau (rule 4.3).

## 6. Rủi ro & cách lùi
- Revert 1 commit; không migration, không ghi dữ liệu.
- Số "lượt ghé" ở CRM **giảm** với khách có đơn NEW kẹt → cần báo quầy trước. 421 đơn NEW kẹt là việc dọn dữ liệu riêng, không gộp vào plan này.
- Deploy: phase1 là bản đang chạy.
