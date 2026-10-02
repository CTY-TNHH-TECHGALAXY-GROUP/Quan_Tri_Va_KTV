# Plan: KTV loại C điểm danh như loại B + điều phối quay lại bắt điểm danh

> ⛔ **ĐÃ GỘP (14/09/2026)** vào `plans/plan_dieu_phoi_ktv_chua_diem_danh.md` — KHÔNG làm theo file này.


> **Mức 2** — chạm luồng điều phối (`app/reception/dispatch/actions.ts`, `useDispatchBoard.logic.ts`) và API chấm công.
> Ngày lập: 14/09/2026. Nhánh: `feat/bit-lo-hong-phase1`.
> **Phạm vi: CHỈ loại C.** Loại A/B/D giữ nguyên hành vi, kể cả các lỗi có sẵn (theo yêu cầu user).
> **Chưa sửa code — chờ duyệt.**

---

## 0. User chốt (14/09/2026)

1. Loại C chấm công **giống B**: Bật nhận đơn + báo số phút tới → **Oria xin chào** khi tới tiệm → đi thì **Oria xin cảm ơn / Tắt nhận đơn**.
2. C **tắt nhận đơn → ẩn khỏi ô chọn KTV**.
3. **Đổi lại quyết định 13/09**: điều phối loại C **phải có điểm danh** (không còn "luôn hiện, không xét gì").

---

## 1. Nguyên nhân gốc — vì sao C không chấm công được

- Màn chấm công chỉ có giao diện riêng cho B (`AttendanceTypeB`) và D (`AttendanceTypeD`). **C rơi vào giao diện A** (`app/ktv/attendance/page.tsx:487`).
- Luồng A bắt buộc có ca: `fetchShift` (`Attendance.logic.ts:185-211`) không thấy `KTVShifts` ACTIVE mà KTV không OFF → `shiftFetchError = true`.
- Form hiện *"Không tải được ca làm việc"*, nút gửi khoá bởi `formType === 'CHECK_IN' && shiftFetchError && !isOffToday` (`page.tsx:1041`).
- DB (14/09): 5 tài khoản C (KTV01–KTV05) — **0 dòng `KTVShifts`, 0 lần chấm công**. Quyền `ktv_attendance` và cờ `allow_on_call` đều đúng → không phải lỗi phân quyền.

---

## 2. Luồng B đang có (C sẽ đi y hệt)

| Bước | Giao diện | Server |
|---|---|---|
| Bật nhận đơn + số phút tới | `AttendanceTypeB` → popup phút | `POST /api/ktv/on-call` → `feature_flags.is_on_call = true` + `KtvOnlineService.goOnline` (`online_status = ONLINE`, `travel_minutes`) — **không** tạo dòng TurnQueue |
| Oria xin chào (tới tiệm) | nút ở trạng thái Tắt / Đang chờ đơn | `POST /api/ktv/attendance` nhánh `isTypeB` → `KtvOnlineService.arriveAtVenue` → `AT_VENUE` + upsert **TurnQueue `waiting`** |
| Oria xin cảm ơn / Tắt nhận đơn | chặn khi còn việc / nợ phòng | `goOffline` → `OFFLINE` + **TurnQueue `off`** |

**Hệ quả ở điều phối (đúng cho B hôm nay, C sẽ giống):**
- Bật nhận đơn ở nhà → ô chọn KTV hiện **tua ảo "⌛ Rảnh lúc HH:mm"** (`useDispatchBoard.logic.ts`, lọc `is_on_call`).
- Nhưng `processDispatch` bắt dòng TurnQueue ≠ `off` → **chỉ điều phối được sau khi Oria xin chào** (hoặc quầy bật ở Sổ tua). Không có đường nào phía quầy tự đưa KTV on-call tới tiệm (đã grep).

---

## 3. Thay đổi đề xuất

Nguyên tắc: thêm **một** điều kiện "đi luồng B" = `TYPE_B || TYPE_C`; mọi nhánh riêng của B/D/A khác **không đổi**.

### 3.1 Phía KTV — màn chấm công

| File | Chỗ | Đổi |
|---|---|---|
| `app/ktv/attendance/Attendance.logic.ts` | mới | export `usesTypeBAttendanceFlow(workType)` = `TYPE_B \|\| TYPE_C` |
| `Attendance.logic.ts:260` | `checkIsLate` | C không tính đi muộn (như B) |
| `Attendance.logic.ts:469` | `shiftFetchError` | trả `false` cho C (như D) → hết khoá nút gửi |
| `page.tsx:294` | `openForm` | C chọn ca `VIP` (như B) |
| `page.tsx:437, 450, 927, 938` | giờ dự kiến về | C bắt nhập giờ dự kiến như B |
| `page.tsx:480, 487` | render | C dùng `AttendanceTypeB` + khung "Đang gửi điểm danh" |
| `page.tsx:762-763` | tiêu đề form | "Báo Cáo Đến Tiệm / Tan Ca" như B |
| `page.tsx:798` | chọn ca | ẩn ô chọn ca với C |
| `page.tsx:1008, 1010, 1041` | lý do đi muộn | C không bắt lý do muộn (như B) |

### 3.2 Phía server

| File | Đổi |
|---|---|
| `app/api/ktv/attendance/route.ts:76` | `isTypeB` → `TYPE_B \|\| TYPE_C` → C check-in gọi `arriveAtVenue` (TurnQueue `waiting`), check-out gọi `goOffline` (TurnQueue `off`) |
| `app/api/ktv/on-call/route.ts` (tắt nhận đơn) | đọc `block_checkout_incomplete_tasks_TYPE_C` khi KTV là C; loại khác vẫn đọc key `TYPE_B` như cũ (không đổi A/D đang có `allow_on_call`) |

**Không sửa** lỗi có sẵn `KtvOnlineService` tìm `Users.staffCode` (cột không tồn tại → không ghi ca / `isOnShift`). C không cần ca: màn chấm công đọc trạng thái từ `KTVAttendance`, điều phối đọc `TurnQueue` — cả hai đều được ghi đúng.

### 3.3 Điều phối — quay lại bắt điểm danh (hoàn tác một phần `f01cc0a7`)

| File | Đổi |
|---|---|
| `useDispatchBoard.logic.ts` `mergeTurnsWithStaff` | **Bỏ** tua ảo "luôn có" cho loại C. Chỉ còn tua ảo on-call (theo `is_on_call`) — C bật nhận đơn thì hiện "Rảnh lúc HH:mm" như B. C chưa bật / đã tắt → **ẩn**. |
| `actions.ts` `processDispatch` | **Bỏ miễn** cho C: C phải có TurnQueue hôm đó ≠ `off`. Câu lỗi riêng cho C: *"Cộng tác viên [Tên] chưa điểm danh (Oria xin chào) hoặc chưa được bật ở Sổ tua."* |
| `TurnQueueBoard.tsx` tab C | chữ mô tả → *"Bật để quầy chọn được ở Điều phối"* (công tắc giữ nguyên = điểm danh hộ) |

**Giữ nguyên:** `f1282c2e` (đổi KTV sang C chưa có dòng → tạo dòng `working`; nay chỉ xảy ra với C đang bật nhận đơn) · sửa `queue_position` · Sổ tua tab C ẩn mã nhập tay.

---

## 4. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Chấm công C: giao diện B, gửi được | Ô chọn KTV: C chỉ hiện khi bật nhận đơn / đã điểm danh / quầy bật; Sổ tua tab C | `KTVAttendance`, `TurnQueue`, `Staff.online_status`, `feature_flags.is_on_call` | Sửa |
| Tiền / tua / giờ | Không đổi — thưởng ca C mặc định tắt; tua theo `TurnLedger` | Không đổi | `KtvCommissionService` | Khớp |
| Realtime | Như B | Điều phối & Sổ tua đã subscribe `TurnQueue`, `Staff` | `TurnQueue`, `Staff` | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | — | Không lộ |
| Loại A/B/D | **Không ảnh hưởng — vì** mọi điều kiện mới chỉ thêm `TYPE_C`; key cấu hình của loại khác giữ nguyên | như trái | — | Không đổi |

---

## 5. Rủi ro vận hành

- Sau deploy, C **không còn tự hiện** ở ô chọn KTV. Quầy phải nhắc C Oria xin chào (hoặc tự bật ở Sổ tua) — ngược với hướng dẫn đã áp từ 13/09.
- `Staff.online_status` không reset theo ngày (DB 14/09: B còn `AT_VENUE` từ hôm trước). C dùng chung nên cũng dính; không ảnh hưởng điều phối vì điều phối đọc `TurnQueue` theo ngày làm việc.
- Bản ở quầy vẫn chạy code cũ tới khi deploy — trong đó C bị chặn "chưa chấm công" và cũng không chấm công được → hiện chỉ quầy bật ở Sổ tua mới dùng được C.

---

## 6. Kiểm thử

**Mô phỏng Node (rule 9.8, 10)** — cổng `processDispatch` + `mergeTurnsWithStaff`, chạy thêm `TZ=UTC`:

| Ca | Mong đợi |
|---|---|
| 1KTV-1DV: C chưa điểm danh, không on-call | ẩn ở ô chọn; server chặn câu lỗi C |
| 1KTV-1DV: C bật nhận đơn (chưa tới tiệm) | hiện "Rảnh lúc HH:mm"; server chặn (như B) |
| 1KTV-1DV: C đã Oria xin chào (TurnQueue `waiting`) | hiện, server cho qua |
| 2KTV-1DV: C đã điểm danh + A đã điểm danh | qua |
| 2KTV-1DV: C chưa điểm danh + A đã điểm danh | chặn vì C |
| 1KTV-2DV (gộp): C đã điểm danh | qua |
| C tắt nhận đơn (TurnQueue `off`, `is_on_call=false`) | ẩn; server chặn |
| Quầy bật C ở Sổ tua | hiện, qua |
| Ca đêm qua 0h | cổng so theo `date` ngày làm việc |
| B / D / A cùng các ca trên | **y như trước khi sửa** |

**Chạy thật trên app (user làm, cần đăng nhập):** KTV01 vào Chấm công → Bật nhận đơn 20' → quầy thấy "Rảnh lúc" → Oria xin chào (chụp ảnh) → quầy phân đơn được → Oria xin cảm ơn → quầy không còn thấy KTV01.

Sau đó `npx tsc --noEmit`, `qa_swap_ktv_e2e.ts` vẫn 121/121, cập nhật `plans/plan_ktv_loai_c_tai_khoan_that.md` (mục 7 bị thay bởi plan này).
