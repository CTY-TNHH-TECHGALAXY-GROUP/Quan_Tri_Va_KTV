# Plan: Nút "Báo off đột xuất" cho KTV Loại D (sau 07:00)

> Mức 2 — chạm trừ giờ tích luỹ + cron kỷ luật. **Đã duyệt 07/10/2026, đã code.** Edge case 6: cho điểm danh, giữ −10h, không xét trễ thêm.
> Ngày: 07/10/2026 · Nhánh: `feat/bit-lo-hong-phase1`

## 1. Quyết định của user

| Câu hỏi | Chốt |
|---|---|
| Báo off đột xuất bị xử thế nào | **Trừ 10 giờ, KHÔNG khoá tài khoản** (kể cả khi quỹ giờ không đủ) |
| Có cần quầy duyệt | **Không** — bấm là ghi nhận |
| Migration | **Không cần** — dùng lại luồng `SUDDEN_OFF` sẵn có (xem mục 2) |

## 2. Hiện trạng & nguyên nhân gốc

Khái niệm "Nghỉ đột xuất" đã có đủ phần ghi dữ liệu:
- `KTVAttendance.checkType = 'SUDDEN_OFF'`, tự duyệt (`status = CONFIRMED`, `confirmedBy = SYSTEM`), không kiểm IP, không cần ảnh.
- Ghi `KTVLeaveRequests` (`is_sudden_off = true`, `APPROVED`) → quầy thấy ở Lịch OFF và KTV Hub.
- Loại D: trừ giờ `ABSENT_NO_NOTICE` NGAY lúc bấm — **chỉ khi** nhân viên được bật cờ `feature_flags.sudden_leave_penalty`.

Ba lỗ hổng khiến KTV coi như "không có nút báo":
1. **Nút bị giấu**: chỉ là một `<option>` trong ô chọn ca của form "Tới tiệm". Màn `AttendanceTypeD` chỉ có nút "Báo đi muộn". (API `REPORT_ABSENT` có nhưng UI không mở được, và nó chỉ chạy trước 07:00.)
2. **Cron chốt sổ không biết đến SUDDEN_OFF**: `daily-absence-check` chỉ coi `CHECK_IN / LATE_CHECKIN` là có đi làm, còn dòng đăng ký vẫn `REGISTERED` → xử `NO_SHOW_NO_NOTICE` = `DEDUCT_OR_LOCK` → **quỹ giờ không đủ là bị khoá** dù đã báo.
3. **Mức phạt lúc bấm phụ thuộc cờ từng người** → người có cờ bị trừ ngay, người không có cờ thì đợi cron xử như "không báo".

Không cần migration vì: không thêm cột, không thêm giá trị `status` mới. Dùng cột text sẵn có `KTVTypeDDailyRegistration.penalty_applied` để đánh dấu, cấu hình chế tài nằm trong JSON `SystemConfigs.ktv_type_d_discipline_rules`.

## 3. Thay đổi

### 3.1. Luật mới — một nguồn duy nhất (`lib/constants/staff.constants.ts`)
Thêm case vào `TYPE_D_DISCIPLINE_CASES`:
```
SUDDEN_OFF_REPORTED: { action: 'DEDUCT', hours: 10,
  label: 'Báo off đột xuất (sau 07:00)',
  moTa: 'Đã đăng ký đi làm, từ 07:00 bấm Báo off đột xuất. Trừ giờ, không khoá.',
  quetBoi: 'Lúc KTV bấm (+ cron chốt sổ dự phòng)', quetLuc: 'Ngay khi bấm' }
```
Trừ giờ đi qua `KtvTypeDDisciplineService.applyCasePenalty(caseKey = SUDDEN_OFF_REPORTED)` → `ghiPhatGio` upsert `KTVDPenaltyLedger (staff_id, work_date, ABSENT_NO_NOTICE)` → **idempotent**, bấm 2 lần / cron chạy lại không trừ 2 lần.
`DEDUCT` không bao giờ khoá. Không cho chọn `LOCK` / `DEDUCT_OR_LOCK` cho case này ở màn Cài đặt (đúng quyết định "không khoá").

### 3.2. API chấm công (`app/api/ktv/attendance/route.ts`) — chỉ nhánh `SUDDEN_OFF` + `TYPE_D`
- Kiểm trước khi ghi (trả 400 kèm câu tiếng Việt):
  - Có dòng đăng ký ngày làm việc hôm nay, `status ∈ {REGISTERED, LATE_REPORTED}`, chưa `check_in_at`.
  - Đã từ 07:00 (trước 07:00 → "Hãy đổi lịch sang OFF ở màn Lịch").
  - Không `AT_VENUE`.
- Sau khi ghi `KTVAttendance` như cũ: gọi `applyCasePenalty(SUDDEN_OFF_REPORTED)` bằng **client quản trị** (RLS sổ phạt chỉ cho đọc), rồi set `penalty_applied = 'SUDDEN_OFF_REPORTED'` trên dòng đăng ký. Bọc try/catch: lỗi ghi phạt không làm hỏng request — cron dự phòng (3.3) sẽ xử.
- Bỏ phụ thuộc cờ `sudden_leave_penalty` **cho Loại D**. Loại A/B (phạt tiền) giữ nguyên.
- `SUDDEN_OFF_CHECKOUT` (tan ca sớm khi đã vào ca) **không đổi**.

### 3.3. Cron chốt sổ (`daily-absence-check` + `xetChotSoDem`)
- Thêm 1 truy vấn song song: `KTVAttendance` `checkType = SUDDEN_OFF` ngày vừa qua.
- `xetChotSoDem`:
  - `penalty_applied = 'SUDDEN_OFF_REPORTED'` → đóng sổ (`COMPLETED`), không lỗi nào.
  - Có SUDDEN_OFF nhưng chưa đánh dấu (ghi phạt lúc bấm thất bại) → case `SUDDEN_OFF_REPORTED` (trừ 10h, không khoá), thay vì `NO_SHOW_NO_NOTICE`.
- Hai luật đăng ký (`NO_REGISTRATION`, `UNREGISTERED_NEXT_DAY`) **giữ nguyên**: báo off hôm nay không miễn nghĩa vụ đăng ký ngày mai.

### 3.4. UI KTV (`app/ktv/attendance/_components/AttendanceTypeD.tsx` + i18n)
- Nút **"Báo off đột xuất"** (viền đỏ nhạt, ≥44px) ngay dưới "Báo đi muộn". Hiện khi: đã đăng ký đi làm, chưa điểm danh, không ở tiệm, chưa báo off. Trước 07:00 nút xám + dòng "Trước 07:00 hãy đổi lịch sang OFF (trừ 5 giờ)".
- Bấm → popup xác nhận: "Báo off hôm nay sẽ **trừ 10 giờ tích luỹ**. Tài khoản **không bị khoá**." + ô lý do (không bắt buộc) → gọi `handleAttendance('SUDDEN_OFF', null, lyDo)`.
- Đã báo → thẻ "Đã báo off đột xuất hôm nay — đã trừ 10 giờ", ẩn nút Báo đi muộn. Nút Tới tiệm **vẫn giữ** (xem edge case 6).
- Option "Nghỉ đột xuất" trong form Tới tiệm: giữ, vì server xử giống hệt.

### 3.5. Quản lý
- `KtvTypeDSettingsBlock.tsx`: thêm dòng case mới (chỉ cho chọn `DEDUCT` / `NONE`, ô giờ). Ô cũ "Nghỉ đột xuất — chỉ áp dụng khi bật cờ" bỏ khỏi khối Loại D (không còn đường nào đọc nó cho Loại D).
- `HOURS_PENALTY_VI.ABSENT_NO_NOTICE`: 'Nghỉ đột xuất không báo' → **'Nghỉ đột xuất'** (sổ dùng chung cho cả 2 trường hợp; chi tiết ở `note`).

## 4. Ảnh hưởng chéo (4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn / API | Chấm công Loại D (nút mới), `/api/ktv/attendance` | Cài đặt Loại D; KTV Hub & Lịch OFF đã hiện SUDDEN_OFF sẵn | `KtvTypeDDisciplineService`, `TYPE_D_DISCIPLINE_CASES`, cron chốt sổ | Sửa |
| Số liệu giờ | Bảng xếp hạng giờ đọc `KTVDPenaltyLedger` | `admin/ktv-office/hours` đọc cùng sổ | `quyGioThang` | Khớp — cùng 1 dòng sổ |
| Realtime | Không thêm | KTV Hub đã nghe `KTVAttendance` | — | Đồng bộ |
| Quyền | KTV chỉ báo off cho chính mình (danh tính từ phiên) | Không đổi | Client quản trị chỉ để ghi sổ phạt | Không lộ dữ liệu |

## 5. Vùng nổ (4.5)
1. **Dùng chung**: `/api/ktv/attendance` là đường nóng điểm danh của mọi KTV. Code mới chỉ nằm trong `if (checkType === 'SUDDEN_OFF' && isTypeD)`, bọc try/catch phần ghi phạt. Cron chốt sổ chạy cho mọi KTV D.
2. **Nếu sai sập gì**: lỗi trong nhánh mới → chỉ nút báo off hỏng, điểm danh thường không bị đụng. Lỗi truy vấn mới ở cron → cron dừng (giống 3 truy vấn hiện có — cố ý, để không khoá oan cả tiệm) → đêm đó không ai bị xử.
3. **Luồng khách**: Không — không đụng booking, WebBooking, WRB, email, hoá đơn.
4. **Cô lập**: truy vấn SUDDEN_OFF ở cron là query riêng, không chèn vào select đăng ký.

## 6. Hệ quả nghiệp vụ (mục 13) — vai: KTV báo off

| Khía cạnh | Kết quả |
|---|---|
| Giờ tích luỹ | −10h ngay khi bấm, chốt luôn (không "chờ") |
| Khoá tài khoản | Không, kể cả quỹ giờ âm |
| Tiền tua / lượt tua / thưởng / đánh giá | Không áp dụng — chưa vào ca, không có đơn |
| Hàng đợi | `goOffline` như luồng SUDDEN_OFF hiện có; không vào TurnQueue |
| Nợ phòng / chặn tan ca / hạn mức bỏ qua | Không áp dụng — chưa điểm danh |
| Màn app KTV | Thẻ "Đã báo off đột xuất — trừ 10 giờ" |
| Nhật ký quầy / Lịch OFF | Đã có sẵn (KTV Hub "NGHỈ ĐỘT XUẤT", `KTVLeaveRequests`) |
| Lý do | Ô lý do tự do, lưu `KTVAttendance.reason` + `KTVLeaveRequests.reason` |
| Đồng hồ / tự chốt / Kanban / cùng làm với | Không áp dụng — không có đơn |

## 7. Edge case
1. Trước 07:00 → API chặn, chỉ dẫn sang đổi lịch OFF (−5h, luồng cũ).
2. Lịch hôm nay là OFF / chưa đăng ký → chặn (luật khoá chưa đăng ký vẫn chạy).
3. Đã báo trễ rồi báo off → cho phép, −10h, không xử thêm `LATE_REPORTED_NO_SHOW`.
4. Bấm 2 lần / mạng lặp request → upsert sổ phạt, không trừ 2 lần.
5. Kỷ luật Loại D đang TẮT → ghi nhận báo off, không trừ giờ (giống mọi luật D).
6. Báo off rồi vẫn đến điểm danh → **khuyến nghị: cho điểm danh, giữ −10h** (đã chốt thì không lùi). Cần user xác nhận.
7. Ngày: `KTVAttendance.date` theo business date, `work_date` đăng ký theo ngày lịch. Từ 07:00 hai ngày trùng nhau nếu cutoff ≤ 07:00 — sẽ probe `day_cutoff_hours` trên DB thật trước khi code.

## 8. Kiểm thử
- Mock Node (TZ=UTC và Asia/Bangkok) cho `xetChotSoDem`: REGISTERED không báo / báo off có đánh dấu / báo off chưa đánh dấu / báo trễ rồi báo off / OFF / có đi làm. In kết quả case + giờ trừ + có khoá không.
- Đối chiếu: cùng KTV, số giờ ròng ở hours-ranking (KTV) = ktv-office/hours (Quản lý).
- Probe DB thật (chỉ đọc): `KTVTypeDDailyRegistration.penalty_applied`, cấu hình `ktv_type_d_discipline_rules`, `day_cutoff_hours`.

## 9. File dự kiến sửa
- `lib/constants/staff.constants.ts`
- `lib/services/KtvTypeDDisciplineService.ts` (`xetChotSoDem`)
- `app/api/cron/daily-absence-check/route.ts`
- `app/api/ktv/attendance/route.ts` (chỉ nhánh SUDDEN_OFF Loại D)
- `app/ktv/attendance/_components/AttendanceTypeD.tsx` (+ i18n), `app/ktv/attendance/page.tsx` (truyền handler)
- `app/admin/settings/system/KtvTypeDSettingsBlock.tsx`
- `lib/services/KtvOfficeScoreService.ts` (nhãn)
