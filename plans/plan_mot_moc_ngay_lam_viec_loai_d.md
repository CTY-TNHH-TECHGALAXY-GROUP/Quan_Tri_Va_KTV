# Plan: Một mốc ngày làm việc duy nhất (07:00) cho Loại D

**Mức 2.** Chạm mốc ngày làm việc dùng chung, phạt giờ, khoá tài khoản, cron, điều phối.
**Trạng thái:** đợt 1 xong (commit 3d84aae0, 16/09) · đợt 2 xong (commit c8c628fa, 17/09) · đợt 3 code xong 17/09, CHỜ bật cấu hình 6 → 7 trong SystemConfigs sau khi deploy.

---

## 1. Quyết định nghiệp vụ đã chốt với user (15–16/09)

| # | Quyết định |
|---|---|
| 1 | **Giờ hẹn đến tiệm của Loại D chỉ nằm trong 09:00 – 23:59.** Không có ca nào hẹn 00:00 – 06:59. Tiệm đóng lúc 00:00, Loại D không nhận đơn sau 00:00 |
| 2 | **Ranh giới ngày làm việc = 07:00** (đổi `spa_day_cutoff_hours` từ 6 sang 7). Dùng để gom sổ giờ, tiền, lịch sử, và để xác định "hôm nay" của ca |
| 3 | Hạn sửa lịch / đổi giờ / báo vắng giữ **07:00** — nay trùng đúng lúc ngày làm việc bắt đầu. Không kéo về 06:00, làm vậy là lấy mất của KTV 1 tiếng |
| 4 | Nút **báo đi muộn** chuyển sang ca mới lúc **07:00**, không phải 00:00 |
| 5 | **Cron chốt sổ giữ 00:00.** Người hẹn muộn nhất là 23:59 nên tới 00:00 đã biết ai không đến. Không dời sang 07:05 |
| 6 | Mọi so sánh trễ / sớm dùng **giờ thật**. Giờ cron chạy chỉ là lúc máy làm việc, không quyết định mức phạt |
| 7 | **Phiếu phạt ghi theo NGÀY CỦA CA** (ngày trên dòng đăng ký), không theo "hôm nay" |
| 8 | **Người đang bị khoá vẫn được chốt sổ**, nhưng không trừ giờ, không khoá chồng. Ngày quầy vừa mở khoá thì bỏ qua; từ ngày sau xét như thường — mở khoá rồi mà vẫn không đăng ký thì vẫn bị xử |
| 9 | Loại C xét riêng sau. Plan này chỉ làm Loại D |

---

## 2. Vì sao 07:00 chứ không phải 06:00

- Cron sổ tua loại A/B/C **đã cắt ở 07:00 từ trước tới nay**: cửa sổ `${d}T00:00:00+07:00` so với cột `Bookings.timeStart` (timestamp không múi giờ) bị Postgres bỏ offset, hoá thành 07:00 VN (`lib/business-date.ts:72-80`).
- Hạn sửa lịch và hạn báo vắng đã là 07:00.
- Khung 06:00–06:59 bị đẩy về ngày hôm trước. Từ 01/08 khung này chỉ có **1 đơn** và **1 tua Loại D**, nên gần như không xê dịch dữ liệu.

---

## 3. Đợt 1 — Một nguồn duy nhất cho mốc cắt (KHÔNG đổi hành vi) — ĐÃ XONG

Mục tiêu: sau đợt này, đổi mốc chỉ còn là đổi một giá trị cấu hình.

| File | Sửa |
|---|---|
| `app/api/ktv/booking/_shared/utils.ts:24-30` | Bỏ `getUTCHours() < 6` viết cứng, gọi `toBusinessDate` + `getDayCutoffHours`. Ảnh hưởng: điều phối, `TurnQueue.date`, công nợ phòng |
| `app/ktv/history/KTVHistory.logic.ts:86` | Ngày chọn sẵn đang dùng hằng số `DEFAULT_DAY_CUTOFF_HOURS`; lấy cutoff thật từ `/api/ktv/settings` |
| `lib/services/KtvOnlineService.ts:351` `isTimeExpired` | Số 6 viết cứng thành cutoff từ cấu hình |
| ~10 chỗ tự đọc cấu hình rồi tự `?? 6` (`attendance/route.ts`, `attendance/status`, `attendance/history`, `attendance/confirm`, `KtvTypeDOnlineService`, `KtvOnlineService`, `shift/route.ts`, `Attendance.logic.ts`) | Gọi `getDayCutoffHours` / `getBusinessToday`, bỏ bản sao |
| `lib/business-date.ts` | Thêm `phutTrongNgayLamViec(hhmm, cutoff)` = `(h*60 + m − cutoff*60 + 1440) % 1440` và `daQuaGio(a, b, cutoff)`; mọi chỗ so giờ gọi hàm này |

**Kiểm:** chạy song song hàm cũ và hàm mới trên toàn bộ `Bookings`, `KTVAttendance`, `KTVDTurnLedger` tháng 9 — ngày phải trùng 100%.

---

## 4. Đợt 2 — Loại D dùng ngày làm việc và ngày của ca — ĐÃ XONG

### 4.1. Giới hạn giờ đăng ký (quyết định 1)
- `app/api/ktv/daily-registration/route.ts`: chỉ nhận `expected_time` trong **09:00 – 23:59**, ngoài khung trả lỗi rõ ràng.
- `app/ktv/schedule/page.tsx`: ô giờ đặt `min="09:00" max="23:59"`, kèm câu nhắc.
- Giữ luật sẵn có: đăng ký bù cho hôm nay thì giờ hẹn phải sau giờ hiện tại.
- 3 dòng test cũ (00:05, 00:10, 01:50) không bị đụng, chỉ chặn từ nay.

### 4.2. "Hôm nay" của Loại D = ngày làm việc
| File | Sửa |
|---|---|
| `app/api/ktv/type-d/on-call/route.ts` | `isOffToday` tra theo `getBusinessToday`; trả thêm `businessDate` và `cutoffHours` |
| `app/ktv/attendance/_components/AttendanceTypeD.tsx` | Bỏ `vnToday()` tự tính, dùng `businessDate` từ API để tải dòng đăng ký |
| `app/api/ktv/attendance-adjustment/route.ts` | Báo muộn và báo vắng tra dòng theo `getBusinessToday`. Thêm điều kiện: **chỉ báo vắng khi chưa tới giờ hẹn của ca** |
| `app/api/ktv/attendance/status/route.ts` | `todayRegistration` theo `getBusinessToday` |
| `app/ktv/attendance/page.tsx:863-867` | So giờ bằng `daQuaGio` |

### 4.3. `check_in_at` và các cột giờ lệch
- `lib/services/KtvTypeDOnlineService.ts:207-217`: ghi vào dòng của **ngày làm việc** (`businessDateStr` đã có sẵn trong hàm), và ghi `new Date().toISOString()` thay cho giá trị đang lệch +7 tiếng.
- Các cột lệch cùng kiểu, sửa ngay tại chỗ ghi: `registered_at`, `late_reported_at`, `absent_reported_at`.
- Dữ liệu cũ: mọi chỗ đọc chỉ kiểm tra có hay không, nên **không bắt buộc** sửa. Muốn giờ đúng thì chạy script riêng, có snapshot, hỏi user trước khi ghi.

### 4.4. Phiếu phạt ghi theo ngày của ca (quyết định 7)
- Rà tất cả nơi gọi `KtvTypeDDisciplineService`: `attendance/route.ts` (đến trễ, nghỉ đột xuất), `daily-registration` (bỏ ca), `reject-order` (từ chối tua), `daily-absence-check` (cron), `admin/staff/unlock` (phí kích hoạt).
- Luật: `work_date` = ngày của **dòng đăng ký / ca** đang bị xử. Khoản không gắn ca (phí kích hoạt lại, từ chối tua) dùng ngày làm việc lúc thao tác.
- Hết cảnh một đêm nằm ở hai ngày sổ.

### 4.5. Hiển thị phiếu chốt sổ
- Sổ giờ đang hiện `14/09 · 00:00 (15/09)` cho phiếu do cron ghi. Đổi thành **"cuối ngày 14/09"** trong `components/shared/HoursLedgerSheet.tsx`, vì đây là dấu chốt sổ chứ không phải mốc giờ KTV làm gì.

---

## 5. Đợt 3 — Đổi mốc và dời cron — CODE XONG, CHỜ BẬT CẤU HÌNH

| Việc | Chi tiết |
|---|---|
| `SystemConfigs.spa_day_cutoff_hours` | **6 → 7** |
| `lib/business-date.ts` `DEFAULT_DAY_CUTOFF_HOURS` | 6 → 7, để giá trị dự phòng khớp cấu hình |
| Cron `sync-daily-ledger-type-d` | `30 23 * * *` (06:30) → `30 0 * * *` (**07:30**), vì nó gom theo ngày làm việc |
| Cron `daily-absence-check` | **Giữ 00:00** (quyết định 5) |
| Cron `type-d-registration-reminder` 21:00 | Giữ nguyên |
| `cleanup-online` | Kiểm lại ngưỡng "trước 06:00 coi là sáng hôm sau" sau khi đợt 1 gỡ số 6 |
| `canEditRegistration`, `getRegistrationEditWindow`, luật báo vắng | **Không sửa code.** Mốc 07:00 của chúng tự động mang nghĩa "ngày làm việc bắt đầu" |

---

## 6. Cron chốt sổ và người bị khoá (quyết định 8) — ĐÃ XONG trong đợt 2

`app/api/cron/daily-absence-check/route.ts`:
- Bỏ `.neq('status', 'KHÓA_TÀI_KHOẢN')` ở câu lấy danh sách nhân viên.
- Người **đang bị khoá**: vẫn chốt sổ dòng đăng ký thành `COMPLETED`, **không** trừ giờ, **không** khoá chồng, không ghi `penalty_applied`.
- Ngày quầy **vừa mở khoá** (có `MANUAL_UNLOCK` trong `SecurityAuditLogs` thuộc ngày đang xét): bỏ qua, vì KTV chưa kịp đăng ký.
- Từ ngày kế tiếp: xét như mọi người. Mở khoá rồi mà vẫn không đăng ký thì vẫn bị khoá lại.
- `type-d-registration-reminder` cũng bỏ lọc người bị khoá, để họ nhận nhắc ngay hôm được mở.

---

## 7. Bảng hệ quả

| Tình huống | Hôm nay | Sau plan |
|---|---|---|
| Đăng ký giờ 00:05 hoặc 01:50 | Cho phép, sinh mọi lỗi lệch ngày | Bị chặn ngay khi nhập |
| Bấm Oria Xin chào lúc 00:31, ca hôm trước | Chấm công ghi ca hôm trước, `check_in_at` ghi ngày mới | Cả hai cùng ghi ca hôm trước |
| Nút báo muộn lúc 00:30 | Hiện cho ca ngày mới, bấm được | Vẫn là ca hôm trước nên xám hoặc ẩn; ca mới mở lúc 07:00 |
| Đổi giờ làm lúc 06:30 | Được, tới 06:59 | Được, tới 07:00 — đúng lúc ngày làm việc bắt đầu |
| Chuyển OFF lúc 00:49 | Trừ 5 giờ | Trừ 5 giờ, giữ nguyên |
| Tua làm lúc 06:40 | Tính cho ngày mới | Tính cho **ngày hôm trước** |
| Đang bị khoá, ngày đó có dòng đăng ký | Dòng treo mãi, không ai xét | Chốt sổ, không phạt |
| Mở khoá lúc 10:00, hôm đó không đăng ký | Đêm đó bị khoá lại | Ngày mở khoá bỏ qua; hôm sau không đăng ký thì bị khoá |

Không đổi: công thức tiền tua, giờ tích luỹ, thứ tự nhận tua, hạn mức từ chối tua.

---

## 8. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Điểm danh, báo muộn, Lịch, Lịch sử, Sổ giờ | Điều phối (TurnQueue theo ngày), Office (chấm điểm, giờ), danh sách khoá | `lib/business-date.ts`, `KtvTypeDOnlineService`, cron, `SystemConfigs` | Sửa cả 2 phía |
| Số liệu | Giờ và phiếu phạt về đúng ngày; tổng không đổi | Office và báo cáo cùng trục ngày với KTV | `KtvOfficeScoreService`, `KtvDLedger*` | Khớp |
| Realtime | Không đổi | Tin chốt sổ vẫn gửi lúc 00:00 | `StaffNotifications` | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | | Không lộ dữ liệu |

---

## 9. Test

1. **Đợt 1:** so hàm cũ và hàm mới trên toàn bộ dữ liệu tháng 9 — ngày phải trùng 100%.
2. **Bảng giờ:** giờ hẹn 09:00 · 12:00 · 20:00 · 23:30 · 23:59 × giờ thật 08:00 · 12:30 · 20:36 · 23:59 · 00:30 · 06:30 · 07:30. Chạy cả giờ máy và `TZ=UTC`.
3. **Mô phỏng route thật** với fixture đúng định dạng DB: điểm danh, báo muộn, báo vắng, chuyển OFF, đổi giờ.
4. **Cron `?dry=1` trên DB thật**, trước và sau, so từng người; kiểm riêng người đang khoá và người vừa được mở khoá.
5. **Đối chiếu 2 phía** (CLAUDE.md §4.3): cùng 1 KTV và 1 tháng, sổ giờ phía KTV phải bằng màn Office của quầy.
6. **Trước và sau khi đổi cấu hình 6 → 7:** chụp lại tổng giờ và tổng tiền tháng 9 của toàn bộ Loại D; chỉ được lệch ở đúng các bản ghi rơi vào 06:00–06:59.
7. `tsc --noEmit`.
8. Xong: sửa comment sai trong `daily-absence-check` (đang nói `KTVAttendance.date` là ngày lịch) và cập nhật `TableInSupabase.md` nếu có ghi chú về mốc ngày.

---

## 10. Thứ tự và cách lùi

1. **Đợt 1** → deploy → theo dõi 1 ngày. Lùi = revert, không bản ghi nào bị ghi khác đi.
2. **Đợt 2** → deploy. Lùi = revert; phiếu phạt đã ghi theo ngày của ca thì giữ nguyên, không cần sửa ngược.
3. **Đợt 3** → đổi cấu hình **và** dời cron sổ tua trong cùng một lần. Lùi = đặt cấu hình về 6 và trả lịch cron; bản ghi tạo trong lúc chạy mốc 7 giữ nguyên ngày của chúng.
