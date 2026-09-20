# KẾ HOẠCH TOÀN DIỆN: KHẮC PHỤC TIMEOUT ĐIỂM DANH, THẺ OFFICE NGÀY OFF & FLOW ĐIỂM DANH OFF BẮT BUỘC GIỜ TAN CA

> **Mã công việc:** [MỨC 2] KHẮC PHỤC TRIỆT ĐỂ 3 VẤN ĐỀ TRỌNG YẾU  
> **Worktree:** `/Users/charlotte/Desktop/NGÂN HÀ/CTY TechGalaxy Group/Quan_Tri_Va_KTV-shift-extension`  
> **Branch:** `fix/shift-extension-phase1`  
> **Commit cơ sở (HEAD):** `1f50f480`  
> **Trạng thái tuân thủ:** Chờ lệnh `"Duyệt sửa file ổn định"` theo Rule 11 và CLAUDE.md. Không sửa source code trước khi được phê duyệt.

---

## MỤC LỤC
1. [P0: Chẩn đoán & Xử lý Timeout Điểm danh Ngày Đi Làm (ECONNRESET / Aborted)](#1-p0-chẩn-đoán--xử-lý-timeout-điểm-danh-ngày-đi-làm)
2. [P1: Thẻ Office & Modal Ngày OFF Cho KTV Loại D](#2-p1-thẻ-office--modal-ngày-off-cho-ktv-loại-d)
3. [P2: KTV OFF Nhận Tua → Đến Tiệm Điểm Danh Bắt Buộc Nhập Giờ Tan Ca](#3-p2-ktv-off-nhận-tua--đến-tiệm-điểm-danh-bắt-buộc-nhập-giờ-tan-ca)
4. [Bảng Khảo Sát Ảnh Hưởng Chéo (KTV ↔ Quản lý ↔ Dùng chung)](#4-bảng-khảo-sát-ảnh-hưởng-chéo)
5. [Bảng Hệ Quả Nghiệp Vụ Spa (Theo CLAUDE §13 — 17 Khía Cạnh)](#5-bảng-hệ-quả-nghiệp-vụ-spa-theo-claude-13)
6. [Xử Lý Race Condition, Partial Failure & Idempotency](#6-xử-lý-race-condition-partial-failure--idempotency)
7. [Actual Unified Diff Hoàn Chỉnh (Zero Placeholders)](#7-actual-unified-diff-hoàn-chỉnh-zero-placeholders)
8. [Kế Hoạch Kiểm Thử (Test Plan) & Phương Án Rollback](#8-kế-hoạch-kiểm-thử-test-plan--phương-án-rollback)

---

## 1. P0: Chẩn đoán & Xử lý Timeout Điểm danh Ngày Đi Làm

### 1.1. Phân biệt dữ kiện đã chứng minh vs. Giả thuyết runtime chưa xác minh
* **Dữ kiện đã chứng minh (Code Truth):**
  1. **Tài nguyên bị rò rỉ tại `lib/apiClient.ts`:** Hàm `fetchWithTimeout` thiết lập `const id = setTimeout(() => controller.abort(), timeout);` với `DEFAULT_TIMEOUT = 15000` (15 giây). Nếu `fetch` bị lỗi mạng, drop kết nối hoặc reject trước khi timer nổ, câu lệnh `clearTimeout(id)` ở dòng 85 **bị bỏ qua hoàn toàn**. Timer tiếp tục sống trong event loop và abort ngầm.
  2. **Thác nước truy vấn tuần tự khổng lồ (Sequential Network Waterfall):** Trong một request `POST /api/ktv/attendance`, backend thực hiện hơn 20 truy vấn tuần tự ra Supabase Database và Storage:
     - Auth: `requireActiveStaff()` + `requireStaffMatches()`
     - Users lookup (`code`, `fullName`, `role`)
     - Staff lookup (`work_type`)
     - SystemConfigs (`spa_wifi_ips`)
     - Tasks check (`incompleteTasks`)
     - GuestArrivalEvents check
     - Step 0.6: Lại truy vấn Staff (`work_type`), đọc Cutoff, đọc Business Date, đọc `KTVTypeDDailyRegistration` bằng `.single()`
     - Vòng lặp upload ảnh tuần tự: `photoBase64` duyệt từng ảnh một, gọi `supabase.storage.from('attendance').upload(...)` và `getPublicUrl(...)` tuần tự
     - Insert `KTVAttendance`
     - Gọi `arriveAtVenue` (lại đọc Staff, Users, cập nhật KTVShifts cũ, tạo KTVShifts mới, `applyArrivalToTurnQueue`, cập nhật Registration, cập nhật Staff)
     - Đọc Staff `feature_flags`
     - SystemConfigs (`laundry_fee`) + WalletAdjustments
     - `createNotification` (StaffNotifications - 2 lần)
  3. **Lỗ hổng `.single()` tại Step 0.6:** Khi truy vấn `KTVTypeDDailyRegistration` bằng `.single()`, nếu không tìm thấy bản ghi hoặc có nhiều hơn 1 bản ghi, PostgREST trả mã lỗi `PGRST116` ném ngoại lệ làm route rơi vào `catch` block trả 500, nhưng trước đó không có log có cấu trúc.
  4. **Import thừa `sharp`:** File `app/api/ktv/attendance/route.ts` import thư viện C++ native `sharp` nhưng hoàn toàn không dùng ở bất cứ dòng nào.
  5. **Client-side Abort:** Với `DEFAULT_TIMEOUT = 15000` (15s), khi KTV chụp 3–5 ảnh base64 gửi lên kèm mạng di động 4G/Wi-Fi yếu, thời gian truyền tải và xử lý chuỗi 20 truy vấn trên rất dễ vượt ngưỡng 15 giây. Khi đó, client tự ngắt kết nối (`controller.abort()`), Node.js server nhận tín hiệu `aborted` / `ECONNRESET`.

* **Giả thuyết runtime chưa xác minh (Cần đo đạc bằng telemetry):**
  - Timeout xuất phát từ Next.js body parser khi parse JSON base64 quá lớn, hay nghẽn tại Supabase Storage upload, hay nghẽn tại Supabase Database lock/latency?
  - Vì vậy: **KHÔNG tự ý tăng bừa timeout global lên 60s hay 120s** (vì sẽ làm treo UI khi lỗi thật), **KHÔNG tự ý retry POST Attendance** (vì sẽ gây duplicate side-effects).

### 1.2. Giải pháp chẩn đoán & cô lập lỗi (Actionable Architecture)
1. **Sửa dứt điểm rò rỉ timer tại `lib/apiClient.ts`:**
   Bọc `fetch` trong khối `try ... finally { clearTimeout(id); }`. Đảm bảo timer luôn bị hủy dù `fetch` thành công hay thất bại.
2. **Thêm Structured Diagnostic Telemetry vào `POST /api/ktv/attendance`:**
   - Tạo `requestId` duy nhất cho mỗi lượt điểm danh (`att_<timestamp>_<rand>`).
   - Ghi nhận `startMs = Date.now()` và hàm log giai đoạn `logStage(stage, metadata)` đo `elapsedMs`.
   - Các trạm đo (Checkpoints):
     - `stage: 'body_parsed'` (kèm kích thước payload byte, số lượng ảnh)
     - `stage: 'auth_verified'`
     - `stage: 'wifi_checked'`
     - `stage: 'tasks_checked'`
     - `stage: 'registration_checked'`
     - `stage: 'photos_uploaded'` (kèm thời gian upload từng ảnh)
     - `stage: 'attendance_inserted'`
     - `stage: 'venue_arrival_applied'`
     - `stage: 'notifications_sent'`
   - Trong khối `catch (error)`: Ghi nhận chính xác `request.signal.aborted`, tên lỗi `error.name`, mã `error.code`, `elapsedMs` và `lastStage` mà không làm lộ dữ liệu nhạy cảm (không log base64, không log auth cookie/token).
3. **Loại bỏ import chết `sharp`:** Tránh overhead nạp module native C++.
4. **Thay thế `.single()` bằng `.maybeSingle()`:** Kiểm tra tường minh `registrationError` và trả lỗi 503 thân thiện nếu database lỗi, không làm sập route.

---

## 2. P1: Thẻ Office & Modal Ngày OFF Cho KTV Loại D

### 2.1. Phân tích nguyên nhân gốc rễ
1. **API `app/api/ktv/office-score/route.ts`:**
   - Xác thực qua `requireBusinessUser().techCode`. Chỉ áp dụng cho `TYPE_D` và kiểm tra gate `canSeeOfficePoints`.
   - Sử dụng ngày lịch `today = vnToday()`.
   - Tính toán `scores = await KtvOfficeScoreService.computeMonth(...)`.
   - Khi KTV OFF, không có `todayEntry` trong mảng `m.days`, code hiện tại fallback `todayScore: todayEntry ? todayEntry.dayScore : 100`. Hậu quả: KTV OFF vẫn thấy điểm hôm nay là `100/100` và `"Chưa bị trừ lỗi nào"`, gây hiểu nhầm KTV đang đi làm và được chấm 100 điểm.
   - API chưa tra cứu trạng thái đăng ký của ngày hôm nay từ `KTVTypeDDailyRegistration`.
2. **Dashboard Logic `app/ktv/dashboard/KTVDashboard.logic.ts`:**
   - Lệnh gọi `/api/ktv/office-score` bị kẹp chung vào một `useEffect` khổng lồ phía sau KPI, Discipline và Turns. Nếu turns API bị lỗi hoặc chậm, Office score không bao giờ được gọi.
   - Khối `catch` của Office gán `setOfficeScore(null)`, dẫn đến việc thẻ Office biến mất hoàn toàn khỏi màn hình thay vì hiển thị trạng thái lỗi có nút thử lại.
3. **Màn hình `ScreenDashboard.tsx` & Modal `modals.tsx`:**
   - Card Office kiểm tra `logic.officeScore` và hiển thị `os.todayScore + '/100'`.
   - Trong `modals.tsx`, hàm tính điểm ngày có đoạn:
     `const dayScore = entry ? entry.dayScore : (isToday ? (view?.todayScore ?? 100) : null);`
     Nếu API trả `todayScore: null`, toán tử `?? 100` trong modal sẽ tự động biến `null` thành `100`! Do đó, chỉ sửa backend trả `null` là **chưa đủ**, modal vẫn bị bug hiển thị `100/100`.

### 2.2. Kiến trúc giải pháp
1. **Backend (`app/api/ktv/office-score/route.ts`):**
   - Giữ nguyên toàn bộ auth và gate `canSeeOfficePoints`.
   - Truy vấn trạng thái đăng ký của KTV trong ngày `today`:
     ```typescript
     const { data: registration, error: registrationError } = await supabase
         .from('KTVTypeDDailyRegistration')
         .select('status')
         .eq('staff_id', staffId)
         .eq('work_date', today)
         .maybeSingle();
     if (registrationError) throw registrationError;
     const todayRegistrationStatus = registration?.status ?? null;
     const isOffToday = todayRegistrationStatus === 'OFF_REGISTERED';
     ```
   - Trả về trong payload:
     `todayRegistrationStatus`, `isOffToday: boolean`,
     `todayScore: isOffToday ? null : (todayEntry ? todayEntry.dayScore : 100)`.
   - Giữ nguyên toàn bộ `todayHits`, `days`, `revokedHits`, `monthScore`, `hasData`, `fundDue`.
2. **Dashboard Logic (`KTVDashboard.logic.ts`):**
   - Tách việc fetch Office score thành một `useEffect` độc lập trong cùng file (không tạo file mới theo quy định CLAUDE §8).
   - Thêm cleanup flag (`active`) chống race condition khi đổi tài khoản hoặc unmount.
   - Thêm các state quản lý: `officeScoreLoading`, `officeScoreError`, `officeScoreReloadKey`, và hàm `reloadOfficeScore`.
3. **Giao diện (`ScreenDashboard.tsx`):**
   - Giữ thẻ Office luôn hiển thị khi KTV có quyền (`logic.officeScore` truthy).
   - Nếu `isOffToday === true`:
     - Điểm hôm nay hiển thị: `"Hôm nay là OFF"` (font chữ vừa vặn, không chèn `/100`).
     - Dòng mô tả hiển thị: `"Xem lịch sử và điểm tháng"` (không hiển thị `"Chưa bị trừ lỗi nào"`).
     - Gradient màu trung tính dịu mắt (slate/zinc), nút vẫn click được để mở Modal bình thường.
4. **Modal Chi Tiết (`modals.tsx`):**
   - Khắc phục triệt để bug fallback `?? 100`:
     ```typescript
     const isOffToday = isToday && view?.isOffToday === true;
     const dayScore = isOffToday
         ? null
         : entry
             ? entry.dayScore
             : isToday
                 ? (view?.todayScore ?? null)
                 : null;
     ```
   - Khi `isOffToday`, ô điểm ngày hiển thị `"Hôm nay là OFF"`, mô tả `"Xem lịch sử và điểm tháng"`.
   - Khi xem các ngày lịch sử hoặc chuyển tháng, giữ nguyên dữ liệu gốc; `isOffToday` chỉ tác động đến ngày hôm nay.
5. **Từ điển i18n (`app/ktv/dashboard/OfficeScore.i18n.ts`):**
   - Tập trung toàn bộ chuỗi hiển thị của Office Card/Modal, không hard-code tiếng Việt trong JSX.

---

## 3. P2: KTV OFF Nhận Tua → Đến Tiệm Điểm Danh Bắt Buộc Nhập Giờ Tan Ca

### 3.1. Phân tích luồng nghiệp vụ & Lỗ hổng hiện tại
1. **Trạng thái ON-CALL ngày OFF:**
   - KTV Loại D đăng ký OFF nhưng bật nhận đơn ngoài giờ (`goOnline`):
     - `Staff.online_status = 'ONLINE'`, `Staff.available_until = ...`
     - Bảng `KTVTypeDDailyRegistration` vẫn giữ nguyên `status = 'OFF_REGISTERED'`.
     - KTV chưa đến tiệm thì vẫn là OFF, không phát sinh nghĩa vụ đi làm, không bị phạt vắng.
2. **Lỗ hổng tại `app/ktv/attendance/page.tsx`:**
   - Điều kiện hiển thị input giờ về dự kiến và validation hiện đang gắn với `!isOffToday`:
     `{formType === 'CHECK_IN' && !isOffToday && (activeShiftType || workType === 'TYPE_C') ...}`
   - Khi KTV OFF bấm "Oria Xin chào", form ẩn mất ô nhập giờ về và không truyền `estimatedEndTime` lên server!
3. **Lỗ hổng đột biến sớm (Premature Mutation) tại `app/api/ktv/attendance/route.ts`:**
   - Tại Step 0.6 (dòng 227-231):
     ```typescript
     if (registration && registration.status === 'OFF_REGISTERED') {
         await supabase.from('KTVTypeDDailyRegistration')
           .update({ status: 'REGISTERED', expected_time: format(vnNow(), 'HH:mm') })
           .eq('id', registration.id);
     }
     ```
   - Đoạn code này cập nhật database chuyển sang `REGISTERED` **trước cả khi upload ảnh, trước khi insert KTVAttendance, và trước khi gọi arriveAtVenue**.
   - Hậu quả nghiêm trọng: Nếu upload ảnh lỗi, hoặc IP sai, hoặc insert attendance thất bại, KTV đã bị đổi lịch thành `REGISTERED` nhưng chưa hề điểm danh thành công! Ngoài ra, lệnh update này **chưa ghi nhận `expected_end_time`**.

### 3.2. Thiết kế giải pháp chuẩn mực
1. **Phía Client (`app/ktv/attendance/page.tsx` & `Attendance.logic.ts`):**
   - Xác định rõ trường hợp điểm danh từ ngày OFF của Loại D:
     ```typescript
     const isTypeDOffCheckIn =
         workType === 'TYPE_D'
         && todayRegistration?.status === 'OFF_REGISTERED'
         && (formType === 'CHECK_IN' || formType === 'LATE_CHECKIN');
     ```
   - Khi mở form: Nếu là Loại D, gợi ý `availableUntil` (đã cắt định dạng `HH:mm`) vào ô giờ về, nhưng cho phép KTV chỉnh sửa tự do.
   - Khi submit form: Nếu `isTypeDOffCheckIn`, **bắt buộc** phải có `estimatedEndTime` hợp lệ định dạng `HH:mm`. Nếu thiếu, chặn lại và báo lỗi `t.offEndTimeRequired`.
   - Hiển thị ô nhập `time` cho `isTypeDOffCheckIn` và không disabled theo điều kiện của Loại B.
   - Trong `Attendance.logic.ts`:
     - Cập nhật an toàn: `setAvailableUntil(statusRes.availableUntil ?? null)` và `setTodayRegistration(statusRes.todayRegistration ?? null)`.
     - Sau khi POST thành công, tự động gọi `refreshAttendanceStatus()` và `shiftExtension.refresh()` để đồng bộ trạng thái ngay lập tức.
2. **Phía Server (`app/api/ktv/attendance/route.ts`):**
   - **Xóa bỏ mutation sớm tại Step 0.6.**
   - Đọc đăng ký bằng `.maybeSingle()`, nếu lỗi trả 503.
   - Ghi nhận cờ `const wasOffRegistered = registration?.status === 'OFF_REGISTERED';`.
   - **Validation cho OFF Check-in:**
     - Bắt buộc có `estimatedEndTime` dạng `HH:mm`.
     - Kiểm tra giờ kết thúc phải nằm sau thời điểm check-in thực tế trong cùng ngày làm việc (sử dụng hàm chuẩn `phutTrongNgayLamViec` với `cutoffHours`). Nếu nhỏ hơn hoặc bằng giờ đến, từ chối với mã 400.
     - Không cho phép giờ tan ca vượt qua mốc cutoff sang ngày làm việc tiếp theo.
     - Không áp phạt trễ cho KTV từ lịch OFF đi làm tự nguyện (`wasOffRegistered` bỏ qua kiểm tra trễ).
   - **Tiến trình cập nhật nhất quán (Atomic Sequencing):**
     - Upload ảnh thành công.
     - Insert bản ghi `KTVAttendance` với `estimatedEndTime` chuẩn.
     - Gọi `KtvTypeDOnlineService.arriveAtVenue(...)` (mở KTVShifts, lên hàng đợi TurnQueue, đổi `Staff.online_status = 'AT_VENUE'`).
     - Cập nhật `KTVTypeDDailyRegistration`:
       `status: 'REGISTERED'`, `expected_time: format(nowVn, 'HH:mm')`, `expected_end_time: finalEstimatedEndTime`, `check_in_at: nowUtc.toISOString()`.
     - Cập nhật `Staff.available_until: finalEstimatedEndTime`.
     - Gửi thông báo và phản hồi thành công.
3. **Liên kết với Shift Extension (`useShiftExtension.ts`):**
   - Sau khi OFF check-in thành công, `todayRegistration.expected_end_time` đã có giá trị.
   - Hook `useShiftExtension` nhận diện `baseEndTime` chính xác, nút "Gia hạn giờ làm" trên Dashboard và Attendance page sẽ sẵn sàng cho phép KTV gia hạn tối thiểu 60 phút khi có nhu cầu.

---

## 4. Bảng Khảo Sát Ảnh Hưởng Chéo

Tuân thủ nghiêm ngặt **CLAUDE.md §4.1**:

| Hạng mục | Phía KTV (`app/ktv/*`, `app/api/ktv/*`) | Phía Quản lý (`app/admin/*`, `app/reception/*`) | Phía Dùng chung (`lib/*`, DB, Realtime) | Kết luận |
|---|---|---|---|---|
| **Thẻ Office Card & Modal** | - Hiện card khi OFF.<br>- Hiện `"Hôm nay là OFF"` thay cho `100/100`.<br>- Modal xem lịch sử tháng bình thường. | `app/admin/ktv-office/staff/[id]`: Giữ nguyên tính toán `computeMonth`, không thay đổi. | `KtvOfficeScoreService.computeMonth` giữ nguyên 100% công thức tính điểm và quỹ. | Khớp số liệu hoàn toàn giữa KTV và Quản lý. Không lệch 1 điểm nào. |
| **API `/api/ktv/office-score`** | Bổ sung `todayRegistrationStatus` và `isOffToday`. Trả `todayScore: null` khi OFF. | Admin không gọi endpoint này (Admin gọi `/api/admin/ktv-office/*`). | Không đổi chữ ký service dùng chung. | An toàn, không ảnh hưởng phía quản lý. |
| **Luồng OFF Check-in & Giờ về** | - Form Oria Xin chào bắt buộc nhập giờ về `HH:mm`.<br>- Chuyển OFF → REGISTERED.<br>- Đồng bộ `estimatedEndTime`. | `app/reception/dispatch` và `app/reception/turns`: Nhận diện KTV đã check-in qua `checkedInStaffIds` và TurnQueue. | `KTVTypeDDailyRegistration`: Ghi nhận đúng `expected_end_time` và `status = 'REGISTERED'`. `Staff.available_until` khớp giờ về. | Lễ tân thấy KTV xuất hiện trong hàng đợi với giờ khả dụng chính xác. |
| **Gia hạn ca (Shift Extension)** | KTV Loại D sau khi check-in từ OFF được phép gia hạn ca thêm tối thiểu 60 phút. | Lễ tân và Admin thấy giờ tan ca mới cập nhật trên hệ thống. | `KTVAttendance` ghi nhận event `OVERTIME`. Index chống trùng 1 lần/ca được bảo toàn. | Hoạt động mượt mà, đúng quy chế ca Loại D. |
| **Kỷ luật & Phạt trễ** | KTV OFF tự nguyện đi làm KHÔNG bị tính phạt trễ so với giờ đăng ký gốc. | Lịch sử kỷ luật Admin không phát sinh biên bản phạt oan. | `KtvTypeDDisciplineService.deductDailyViolation` không bị kích hoạt cho `wasOffRegistered`. | Công bằng, khuyến khích KTV đi làm thêm vào ngày nghỉ. |
| **Phân quyền & Bảo mật** | - Chặn thao tác hộ qua `requireStaffMatches`.<br>- Kiểm tra IP Wi-Fi nghiêm ngặt.<br>- Gate `canSeeOfficePoints` giữ nguyên. | Admin quản lý cờ tính năng `allow_on_call` và `show_overtime_on_dashboard`. | `requireBusinessUser` xác thực bằng JWT an toàn. | Tuyệt đối an toàn, không rò rỉ dữ liệu hay quyền hạn. |

---

## 5. Bảng Hệ Quả Nghiệp Vụ Spa (Theo CLAUDE §13)

Phân tích toàn diện **17 khía cạnh** khi KTV Loại D từ ngày OFF chuyển sang đi làm tại tiệm:

| STT | Khía cạnh nghiệp vụ | Trạng thái trước điểm danh (OFF ON-CALL) | Trạng thái sau điểm danh thành công (AT VENUE) | Ghi chú & Ràng buộc kỹ thuật |
|---|---|---|---|---|
| 1 | **Tiền tua (Commission)** | Không có | Tính bình thường theo từng đơn hoàn thành | Áp dụng đúng công thức Loại D |
| 2 | **Giờ tích lũy (Hours)** | 0 giờ | Bắt đầu tích lũy giờ làm thực tế theo tua | Ghi vào `KTVServiceHoursLedger` |
| 3 | **Lượt tua (Turns)** | Chưa có lượt trong ngày | Tính lượt tua bình thường | Theo dõi qua `TurnLedger` |
| 4 | **Thưởng / Phạt ngày** | Không phạt vắng, không thưởng | Áp dụng quy chế thưởng/phạt ngày công bình thường | Không phạt trễ cho ca OFF |
| 5 | **Đánh giá của khách** | Không có | Khách đánh giá tính cho KTV thực hiện | Lưu `Reviews` và tính vào KPI |
| 6 | **Dọn phòng / Bàn giao** | Không có | Phải chụp ảnh bàn giao phòng sau dịch vụ | Áp dụng đúng quy trình Handover |
| 7 | **Nợ phòng / Chặn tan ca** | Không | Bị chặn tan ca nếu còn nợ phòng chưa bàn giao | Bảo vệ tiêu chuẩn vận hành spa |
| 8 | **Hạn mức bỏ qua bàn giao** | Giữ nguyên hạn mức cá nhân | Áp dụng hạn mức chung theo cấu hình | Đọc từ `SystemConfigs` |
| 9 | **Hàng đợi (TurnQueue)** | Chưa có mặt hoặc ở trạng thái chờ kích hoạt | Xếp vào TurnQueue với trạng thái `waiting` (hoặc giữ `busy` nếu đã được gán đơn trước) | Hàm `applyArrivalToTurnQueue` xử lý |
| 10 | **Màn hình KTV App** | Hiện thẻ On-Call, thẻ Office báo "Hôm nay là OFF" | Chuyển sang màn hình ca làm việc, thẻ Office chuyển sang hiện điểm hôm nay | Tự động cập nhật qua state & refresh |
| 11 | **Đồng hồ đếm giờ (Timer)** | Không chạy | Chạy đồng hồ dịch vụ khi nhận khách | Absolute Time chuẩn theo CLAUDE §8 |
| 12 | **Tự chốt đơn** | Không | Tự động hoàn tất theo cấu hình hệ thống | Khi hết giờ dịch vụ |
| 13 | **Thẻ Kanban Quầy lễ tân** | Không hiện trên bảng điều phối tại tiệm | Hiện thẻ KTV sẵn sàng đón khách tại tiệm | Đồng bộ Realtime tức thì |
| 14 | **Cùng làm với (Co-workers)** | Không có | Hiển thị tên đồng nghiệp nếu làm đơn đôi/nhóm | `coWorkersOf` |
| 15 | **Lịch sử KTV** | Ghi nhận đăng ký OFF ban đầu | Ghi nhận thời gian check-in thực tế và giờ tan ca | `KTVAttendance` lưu vết đầy đủ |
| 16 | **Nhật ký quầy (Audit Log)** | Không ghi nhận đến tiệm | Ghi nhận thông báo điểm danh tự động | `StaffNotifications` [AUTO] |
| 17 | **Lý do / Ghi chú** | "Đăng ký nghỉ ngày" | "Tự nguyện đến làm từ lịch OFF" | Ghi nhận rõ ràng, minh bạch |

---

## 6. Xử Lý Race Condition, Partial Failure & Idempotency

1. **Chống Double-Click & Đa Tab (Concurrency & Idempotency):**
   - Phía Client: Khóa nút bằng ref `isSubmittingRef` và state `checkStatus === 'LOADING_GPS'`. Chặn mọi thao tác click trùng trong thời gian request đang bay.
   - Phía Server: Kiểm tra bản ghi `KTVAttendance` trong ngày làm việc. Nếu đã tồn tại bản ghi `CHECK_IN` hoặc `LATE_CHECKIN` đang `CONFIRMED` và KTV chưa `CHECK_OUT`, từ chối request trùng lặp.
2. **Xử lý Thất bại Cục bộ (Partial Failure Mitigation):**
   - **Upload ảnh thất bại:** Request dừng ngay lập tức, trả lỗi 400/500 cho client. Database không bị biến động, `KTVTypeDDailyRegistration` vẫn giữ nguyên `OFF_REGISTERED`.
   - **Insert Attendance thất bại:** Không thực hiện bất kỳ bước tiếp theo nào. Trả lỗi về cho client hiển thị thông báo.
   - **Lỗi ở bước ArriveAtVenue sau khi đã insert Attendance:** Khối `catch` ghi log chi tiết mã lỗi. Vì KTVAttendance đã ghi nhận, hệ thống cho phép KTV bấm "Thử lại" hoặc liên hệ Lễ tân để kích hoạt lại trạng thái hàng đợi mà không làm mất lượt.
   - **Lỗi gửi thông báo Realtime:** Xem như lỗi phụ (non-blocking), ghi log và vẫn trả response thành công cho KTV, không làm gián đoạn ca làm việc của nhân viên.
3. **Tính toàn vẹn múi giờ và mốc cắt ngày (Business Date vs. Calendar Date):**
   - Khảo sát kỹ lưỡng khoảng thời gian nhạy cảm: `23:30 → 01:00` sáng hôm sau.
   - Hàm `phutTrongNgayLamViec(hhmm, cutoffHours)` chuẩn hóa toàn bộ mốc giờ thành số phút tính từ thời điểm mở cửa ngày làm việc (mặc định 07:00 = phút 0, 23:59 = phút 1019, 01:50 = phút 1130). Nhờ vậy, phép so sánh giờ đến và giờ về luôn chính xác 100%, không bị ảnh hưởng bởi việc đổi ngày lịch.
   - Không chuyển bừa hệ ngày của Office sang Business Date trong task này; `work_date` tra cứu đăng ký OFF luôn khớp chính xác với ngày mà API Office đang đại diện.

---

## 7. Actual Unified Diff Hoàn Chỉnh (Zero Placeholders)

Dưới đây là mã nguồn diff thực tế, đối chiếu chính xác từng dòng theo commit HEAD `1f50f480`.

### 7.1. `lib/apiClient.ts`
```diff
--- a/lib/apiClient.ts
+++ b/lib/apiClient.ts
@@ -66,19 +66,21 @@ class ApiClient {
     const givenHeaders = fetchOptions.headers instanceof Headers
       ? Object.fromEntries(fetchOptions.headers.entries())
       : (fetchOptions.headers as Record<string, string> | undefined) || {};
 
-    const response = await fetch(url, {
-      // ⚠️ KHÔNG để trình duyệt cache. Mọi đường trong `/api` ở đây đều là dữ
-      // liệu sống — điểm, ví, tua, cờ tính năng. Trước đây không đặt gì cả, mà
-      // các route này cũng không gắn Cache-Control, nên Safari trên iOS giữ lại
-      // bản JSON cũ: admin tắt một tính năng, KTV mở app vẫn thấy y như cũ, F5
-      // cũng vậy, phải xoá dữ liệu web mới hết.
-      //
-      // Vẫn cho ghi đè qua `options` nếu chỗ nào thật sự muốn cache.
-      cache: 'no-store',
-      ...fetchOptions,
-      headers: { ...getActorHeaders(), ...givenHeaders },
-      signal: controller.signal
-    });
-    
-    clearTimeout(id);
-    return response;
+    try {
+      const response = await fetch(url, {
+        // ⚠️ KHÔNG để trình duyệt cache. Mọi đường trong `/api` ở đây đều là dữ
+        // liệu sống — điểm, ví, tua, cờ tính năng. Trước đây không đặt gì cả, mà
+        // các route này cũng không gắn Cache-Control, nên Safari trên iOS giữ lại
+        // bản JSON cũ: admin tắt một tính năng, KTV mở app vẫn thấy y như cũ, F5
+        // cũng vậy, phải xoá dữ liệu web mới hết.
+        //
+        // Vẫn cho ghi đè qua `options` nếu chỗ nào thật sự muốn cache.
+        cache: 'no-store',
+        ...fetchOptions,
+        headers: { ...getActorHeaders(), ...givenHeaders },
+        signal: controller.signal
+      });
+      return response;
+    } finally {
+      clearTimeout(id);
+    }
   }
 
   private async request<T>(url: string, options: ApiOptions = {}): Promise<T> {
```

### 7.2. `app/api/ktv/office-score/route.ts`
```diff
--- a/app/api/ktv/office-score/route.ts
+++ b/app/api/ktv/office-score/route.ts
@@ -56,6 +56,17 @@ export async function GET(request: Request) {
         const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam! : today.slice(0, 7);
 
+        // Tra cứu đăng ký làm việc của ngày hôm nay để nhận diện trạng thái OFF
+        const { data: registration, error: registrationError } = await supabase
+            .from('KTVTypeDDailyRegistration')
+            .select('status')
+            .eq('staff_id', staffId)
+            .eq('work_date', today)
+            .maybeSingle();
+
+        if (registrationError) throw registrationError;
+
+        const todayRegistrationStatus = registration?.status ?? null;
+        const isOffToday = todayRegistrationStatus === 'OFF_REGISTERED';
+
         const scores = await KtvOfficeScoreService.computeMonth(supabase, [staffId], month, { withRevoked: true });
         const m = scores.get(staffId)!;
 
@@ -82,7 +93,9 @@ export async function GET(request: Request) {
                 today,
                 month,
+                todayRegistrationStatus,
+                isOffToday,
                 // Mỗi ngày mặc định 100đ, chỉ giảm khi có phiếu trừ. Không có phiếu nào
                 // thì vẫn là 100 — đúng nguyên tắc "bắt đầu từ 100, trừ dần".
-                todayScore: todayEntry ? todayEntry.dayScore : 100,
+                todayScore: isOffToday ? null : (todayEntry ? todayEntry.dayScore : 100),
                 todayHits: todayEntry ? mapHits(todayEntry.hits) : [],
```

### 7.3. `app/ktv/dashboard/OfficeScore.i18n.ts` (Tạo mới)
```diff
--- /dev/null
+++ b/app/ktv/dashboard/OfficeScore.i18n.ts
@@ -0,0 +1,6 @@
+export const officeScoreText = {
+    offToday: 'Hôm nay là OFF',
+    viewHistory: 'Xem lịch sử và điểm tháng',
+    unavailable: 'Chưa tải được điểm Office',
+    retry: 'Thử lại',
+} as const;
```

### 7.4. `app/ktv/dashboard/KTVDashboard.logic.ts`
```diff
--- a/app/ktv/dashboard/KTVDashboard.logic.ts
+++ b/app/ktv/dashboard/KTVDashboard.logic.ts
@@ -197,6 +197,9 @@ export function useKTVDashboard(config?: DashboardConfig) {
     const [officeScore, setOfficeScore] = useState<any>(null);
     // Type D whose points wallet is switched off: the tile shows the maintenance
     // notice instead of disappearing (server answers applicable + disabled).
     const [officeScoreDisabled, setOfficeScoreDisabled] = useState(false);
+    const [officeScoreLoading, setOfficeScoreLoading] = useState(false);
+    const [officeScoreError, setOfficeScoreError] = useState<string | null>(null);
+    const [officeScoreReloadKey, setOfficeScoreReloadKey] = useState(0);
     /**
      * Có ví nào đang mở không. `null` = chưa biết (đang nạp hoặc nạp hỏng).
@@ -341,18 +344,6 @@ export function useKTVDashboard(config?: DashboardConfig) {
                     });
                 }
 
-                // Điểm Office — API tự nhận diện KTV qua phiên đăng nhập, không nhận staffId
-                // từ client để KTV không xem được điểm của người khác.
-                try {
-                    const officeJson = await apiClient.get<any>('/api/ktv/office-score');
-                    setOfficeScore(officeJson?.applicable && !officeJson?.disabled ? officeJson.data : null);
-                    setOfficeScoreDisabled(officeJson?.disabled === true);
-                } catch {
-                    setOfficeScore(null); // không có điểm Office thì ẩn ô, không chặn dashboard
-                    setOfficeScoreDisabled(false);
-                }
-
                 // Cùng một nguồn với trang Ví (WalletAccessService) để hai màn không
                 // nói hai chuyện. Trang Ví coi là "bảo trì" khi cả ví Tua lẫn ví
                 // Bonus đều tắt — ở đây dùng đúng điều kiện đó.
@@ -367,6 +358,49 @@ export function useKTVDashboard(config?: DashboardConfig) {
     }, [ktvId]);
 
+    // 🔄 Tách riêng effect fetch Office score độc lập
+    useEffect(() => {
+        let alive = true;
+        if (!ktvId) {
+            setOfficeScore(null);
+            setOfficeScoreDisabled(false);
+            setOfficeScoreLoading(false);
+            setOfficeScoreError(null);
+            return;
+        }
+
+        const fetchOffice = async () => {
+            setOfficeScoreLoading(true);
+            setOfficeScoreError(null);
+            try {
+                const officeJson = await apiClient.get<any>('/api/ktv/office-score');
+                if (!alive) return;
+                if (officeJson?.applicable) {
+                    if (officeJson.disabled) {
+                        setOfficeScore(null);
+                        setOfficeScoreDisabled(true);
+                    } else {
+                        setOfficeScore(officeJson.data);
+                        setOfficeScoreDisabled(false);
+                    }
+                } else {
+                    setOfficeScore(null);
+                    setOfficeScoreDisabled(false);
+                }
+            } catch (err: any) {
+                if (!alive) return;
+                setOfficeScore(null);
+                setOfficeScoreDisabled(false);
+                setOfficeScoreError(err?.message || 'Chưa tải được điểm Office');
+            } finally {
+                if (alive) {
+                    setOfficeScoreLoading(false);
+                }
+            }
+        };
+
+        fetchOffice();
+        return () => { alive = false; };
+    }, [ktvId, officeScoreReloadKey]);
+
     // 🔄 Full reset of ALL transient state when booking.id changes
@@ -2781,6 +2815,10 @@ export function useKTVDashboard(config?: DashboardConfig) {
         turnData,
         officeScore,
         officeScoreDisabled,
+        officeScoreLoading,
+        officeScoreError,
+        reloadOfficeScore: () => setOfficeScoreReloadKey(k => k + 1),
         walletAnyOn,
         kpiData,
         disciplineStatus,
```

### 7.5. `app/ktv/dashboard/_screens/ScreenDashboard.tsx`
```diff
--- a/app/ktv/dashboard/_screens/ScreenDashboard.tsx
+++ b/app/ktv/dashboard/_screens/ScreenDashboard.tsx
@@ -19,6 +19,7 @@ import { motion, AnimatePresence } from 'motion/react';
 import { supabase } from '@/lib/supabase';
 import { useToast } from '@/components/ui/Toast';
 import { fmtHours } from '@/lib/hours-format';
+import { officeScoreText } from '../OfficeScore.i18n';
 
 /**
  * Giao diện một dòng trong danh sách chuông, theo NHÓM thông báo.
@@ -663,7 +664,10 @@ export function ScreenDashboard({ logic }: { logic: any }) {
              {/* ĐIỂM OFFICE HÔM NAY — chỉ KTV Loại D mới có */}
              {logic.officeScore && (() => {
                const os = logic.officeScore;
+               const isOffToday = os.isOffToday === true;
                // Xanh khi chưa bị trừ gì, hổ phách khi có lỗi trong ngày.
-               const tone = os.todayHits.length === 0
+               const tone = isOffToday
+                 ? 'from-slate-600 to-slate-700'
+                 : os.todayHits.length === 0
                  ? 'from-emerald-500 to-green-600'
                  : 'from-amber-500 to-orange-600';
                return (
@@ -679,7 +683,11 @@ export function ScreenDashboard({ logic }: { logic: any }) {
                      <div className="text-left">
                        <h3 className="font-bold text-[10px] uppercase tracking-widest text-white/80">Điểm hôm nay</h3>
                        <p className="font-black text-xl leading-none mt-1">
-                         {os.todayScore}<span className="text-sm font-medium opacity-80 ml-0.5">/100</span>
+                         {isOffToday ? (
+                           <span className="text-base font-bold">{officeScoreText.offToday}</span>
+                         ) : (
+                           <>{os.todayScore}<span className="text-sm font-medium opacity-80 ml-0.5">/100</span></>
+                         )}
                        </p>
                        <p className="text-[10px] font-bold text-white/85 mt-1">
-                         {os.todayHits.length > 0 ? `${os.todayHits.length} lỗi bị trừ hôm nay` : 'Chưa bị trừ lỗi nào'}
+                         {isOffToday
+                           ? officeScoreText.viewHistory
+                           : os.todayHits.length > 0
+                           ? `${os.todayHits.length} lỗi bị trừ hôm nay`
+                           : 'Chưa bị trừ lỗi nào'}
                        </p>
                      </div>
                    </div>
```

### 7.6. `app/ktv/dashboard/_components/modals.tsx`
```diff
--- a/app/ktv/dashboard/_components/modals.tsx
+++ b/app/ktv/dashboard/_components/modals.tsx
@@ -23,6 +23,7 @@ import { fmtDayFull, shiftMonth, currentMonthVn } from '@/lib/services/KtvOffice
 import { FeatureMaintenanceNotice } from '@/components/shared/FeatureMaintenanceNotice';
 import { TurnQueueRow } from '@/lib/types/turn-queue';
 import { fmtHours } from '@/lib/hours-format';
+import { officeScoreText } from '../OfficeScore.i18n';
 
 /**
  * Lịch chọn ngày trong tháng — chấm màu báo ngày nào có lỗi (đỏ), ngày nào
@@ -578,5 +579,9 @@ export function OfficeScoreModal({ data, onClose }: { data: any, onClose: () =>
   const entry = byDate[selected];
   const isToday = selected === today;
+  const isOffToday = isToday && view?.isOffToday === true;
   // Ngày đi làm mà không có phiếu trừ nào vẫn là 100 — đúng nguyên tắc "bắt đầu
   // từ 100, trừ dần". Ngày không đi làm thì không có điểm để hiện.
-  const dayScore = entry ? entry.dayScore : (isToday ? (view?.todayScore ?? 100) : null);
+  const dayScore = isOffToday
+    ? null
+    : entry
+      ? entry.dayScore
+      : isToday
+        ? (view?.todayScore ?? null)
+        : null;
   const hits = entry ? entry.hits : (isToday ? (view?.todayHits || []) : []);
@@ -669,7 +674,9 @@ export function OfficeScoreModal({ data, onClose }: { data: any, onClose: () =>
               </p>
               <p className="text-2xl font-black text-slate-800 mt-1">
-                {dayScore === null ? '—' : `${dayScore}/100`}
+                {isOffToday
+                  ? officeScoreText.offToday
+                  : dayScore === null ? '—' : `${dayScore}/100`}
               </p>
               <p className="text-[11px] text-slate-400 font-bold mt-1">
-                {dayScore === null
+                {isOffToday
+                  ? officeScoreText.viewHistory
+                  : dayScore === null
                   ? 'Ngày này bạn không đi làm'
                   : hits.length === 0 ? 'Chưa bị trừ lỗi nào' : `${hits.length} lỗi bị trừ`}
               </p>
```

### 7.7. `app/ktv/attendance/Attendance.i18n.ts`
```diff
--- a/app/ktv/attendance/Attendance.i18n.ts
+++ b/app/ktv/attendance/Attendance.i18n.ts
@@ -37,6 +37,7 @@ export const t = {
     reasonOptional: 'Lý do/Ghi chú (tùy chọn)',
     reasonRequiredGeneral: 'Lý do/Ghi chú (*)',
+    offEndTimeRequired: 'Vui lòng chọn giờ dự kiến tan làm hợp lệ.',
 
     // Photo
     addPhoto: (count: number, max: number) => `Thêm ảnh (${count}/${max})`,
```

### 7.8. `app/ktv/attendance/Attendance.logic.ts`
```diff
--- a/app/ktv/attendance/Attendance.logic.ts
+++ b/app/ktv/attendance/Attendance.logic.ts
@@ -107,7 +107,7 @@ export const useKTVAttendance = () => {
                 if (statusRes.success) {
                     if (statusRes.workType) setWorkType(statusRes.workType);
-                    if (statusRes.availableUntil) setAvailableUntil(statusRes.availableUntil);
+                    setAvailableUntil(statusRes.availableUntil ?? null);
                     if (statusRes.incompleteTasksCount !== undefined) setIncompleteTasksCount(statusRes.incompleteTasksCount);
                     if (statusRes.roomDebt) setRoomDebt(statusRes.roomDebt);
                     if (statusRes.guestArrivalLock) setGuestArrivalLock(statusRes.guestArrivalLock);
-                    if (statusRes.todayRegistration) setTodayRegistration(statusRes.todayRegistration);
+                    setTodayRegistration(statusRes.todayRegistration ?? null);
                     setCanRequestWithdraw(statusRes.canRequestWithdraw !== false);
                     setWithdrawWalletOff(statusRes.withdrawWalletOff === true);
@@ -339,6 +339,12 @@ export const useKTVAttendance = () => {
                 setCheckStatus('PENDING');
             }
+            // Refresh status & shift extension ngay sau khi điểm danh thành công
+            try {
+                await refreshAttendanceStatus();
+                await shiftExtension.refresh();
+            } catch (refErr) {
+                console.error('❌ [Attendance] Non-blocking refresh error:', refErr);
+            }
         } catch (err: any) {
             const errorMessage = err.message || 'Lỗi không xác định';
             setErrorMsg(errorMessage);
@@ -350,7 +356,7 @@ export const useKTVAttendance = () => {
         }
-    }, [user?.id, addToast]);
+    }, [user?.id, addToast, refreshAttendanceStatus, shiftExtension]);
```

### 7.9. `app/ktv/attendance/page.tsx`
```diff
--- a/app/ktv/attendance/page.tsx
+++ b/app/ktv/attendance/page.tsx
@@ -290,3 +290,3 @@ const KTVAttendancePage = () => {
             if (type === 'CHECK_IN' && availableUntil) {
-                setEstimatedEndTime(availableUntil);
+                setEstimatedEndTime(workType === 'TYPE_D' ? availableUntil.slice(0, 5) : availableUntil);
             } else {
@@ -428,2 +428,8 @@ const KTVAttendancePage = () => {
     const handleSubmitForm = () => {
         setFormError(null);
+        const isTypeDOffCheckIn =
+            workType === 'TYPE_D'
+            && todayRegistration?.status === 'OFF_REGISTERED'
+            && (formType === 'CHECK_IN' || formType === 'LATE_CHECKIN');
+
+        if (isTypeDOffCheckIn && !/^([01]\d|2[0-3]):[0-5]\d$/.test(estimatedEndTime)) {
+            setFormError(t.offEndTimeRequired);
+            return;
+        }
+
         if (selectedShiftType === 'SUDDEN_OFF') {
@@ -455,4 +461,4 @@ const KTVAttendancePage = () => {
             (formType === 'CHECK_IN' || formType === 'CHECK_OUT') ? selectedShiftType : null,
-            (formType === 'CHECK_IN' && !isOffToday && (activeShiftType || workType === 'TYPE_C') && (selectedShiftType === 'VIP' || selectedShiftType === 'FREE' || isTypeBFlow)) ? estimatedEndTime : null,
+            (isTypeDOffCheckIn || (formType === 'CHECK_IN' && !isOffToday && (activeShiftType || workType === 'TYPE_C') && (selectedShiftType === 'VIP' || selectedShiftType === 'FREE' || isTypeBFlow))) ? estimatedEndTime : null,
             wantsToWithdraw,
             isLiveCaptureMode
         );
@@ -920,3 +926,8 @@ const KTVAttendancePage = () => {
 
-                            {formType === 'CHECK_IN' && !isOffToday && (activeShiftType || workType === 'TYPE_C') && (isTypeBFlow || selectedShiftType === 'FREE' || selectedShiftType === 'VIP') && (
+                            {(() => {
+                                const isTypeDOffCheckIn =
+                                    workType === 'TYPE_D'
+                                    && todayRegistration?.status === 'OFF_REGISTERED'
+                                    && (formType === 'CHECK_IN' || formType === 'LATE_CHECKIN');
+                                return (isTypeDOffCheckIn || (formType === 'CHECK_IN' && !isOffToday && (activeShiftType || workType === 'TYPE_C') && (isTypeBFlow || selectedShiftType === 'FREE' || selectedShiftType === 'VIP'))) && (
                                 <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                     <label className="text-sm font-semibold text-gray-700 block text-left flex gap-1 items-center">
                                         Dự kiến về lúc mấy giờ? <span className="text-rose-500">(*)</span>
                                     </label>
                                     <input 
                                         type="time" 
                                         value={estimatedEndTime} 
                                         onChange={e => setEstimatedEndTime(e.target.value)}
-                                        className={`w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-medium text-gray-700 ${isTypeBFlow && !!availableUntil ? 'bg-gray-100 cursor-not-allowed opacity-70' : 'bg-white'}`} 
+                                        className={`w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-medium text-gray-700 ${!isTypeDOffCheckIn && isTypeBFlow && !!availableUntil ? 'bg-gray-100 cursor-not-allowed opacity-70' : 'bg-white'}`} 
                                         required
-                                        disabled={isTypeBFlow && !!availableUntil}
+                                        disabled={!isTypeDOffCheckIn && isTypeBFlow && !!availableUntil}
                                     />
                                     <p className="text-xs text-gray-500 font-medium">Giúp Lễ tân nắm bắt thời gian để sắp xếp khách cho bạn.</p>
                                 </div>
-                            )}
+                            );})()}
```

### 7.10. `app/api/ktv/attendance/route.ts`
```diff
--- a/app/api/ktv/attendance/route.ts
+++ b/app/api/ktv/attendance/route.ts
@@ -8,3 +8,2 @@ import { KtvTypeDOnlineService } from '@/lib/services/KtvTypeDOnlineService';
 import { KtvTypeDDisciplineService } from '@/lib/services/KtvTypeDDisciplineService';
-import sharp from 'sharp';
 import { requireActiveStaff, requireStaffMatches } from '@/lib/auth-server';
@@ -20,3 +19,10 @@ const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
 export async function POST(request: Request) {
+    const reqStartMs = Date.now();
+    const reqTraceId = `att_${reqStartMs}_${Math.random().toString(36).slice(2, 7)}`;
+    const logCheckpoint = (stepName: string, meta?: Record<string, any>) => {
+        const elapsed = Date.now() - reqStartMs;
+        console.log(`⏱️ [AttendanceCheck:${reqTraceId}] Stage: ${stepName} | Elapsed: ${elapsed}ms`, meta ? JSON.stringify(meta) : '');
+    };
+
     try {
+        logCheckpoint('start');
         const lockedError = await requireActiveStaff();
@@ -25,2 +31,3 @@ export async function POST(request: Request) {
         const body = await request.json();
+        logCheckpoint('body_parsed', { payloadBytes: JSON.stringify(body).length });
         const parseResult = AttendanceSchema.safeParse(body);
@@ -209,2 +216,4 @@ export async function POST(request: Request) {
         const isTypeD = workType === 'TYPE_D';
+        let wasOffRegistered = false;
+        let typeDRegistrationId: string | null = null;
 
         if (isTypeD && (checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN')) {
@@ -219,13 +228,34 @@ export async function POST(request: Request) {
             const todayStr = await getBusinessToday(supabase);
-            const { data: registration } = await supabase
+            const { data: registration, error: regLookupError } = await supabase
                 .from('KTVTypeDDailyRegistration')
                 .select('id, status, expected_time, late_expected_time')
                 .eq('staff_id', staffCode)
                 .eq('work_date', todayStr)
-                .single();
+                .maybeSingle();
 
-            if (registration && registration.status === 'OFF_REGISTERED') {
-                await supabase.from('KTVTypeDDailyRegistration')
-                  .update({ status: 'REGISTERED', expected_time: format(vnNow(), 'HH:mm') })
-                  .eq('id', registration.id);
+            if (regLookupError) {
+                console.error(`❌ [Attendance:${reqTraceId}] Lỗi đọc KTVTypeDDailyRegistration:`, regLookupError);
+                return NextResponse.json({ success: false, error: 'Không thể kiểm tra lịch làm việc của bạn.' }, { status: 503 });
+            }
+
+            if (registration) {
+                typeDRegistrationId = registration.id;
+                wasOffRegistered = registration.status === 'OFF_REGISTERED';
+            }
+
+            // Validation cho trường hợp KTV OFF đến tiệm làm
+            if (wasOffRegistered) {
+                if (!estimatedEndTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(estimatedEndTime)) {
+                    return NextResponse.json({ success: false, error: 'Vui lòng nhập giờ dự kiến tan ca hợp lệ (HH:mm).' }, { status: 400 });
+                }
+                const phutDen = phutTrongNgayLamViec(format(vnNow(), 'HH:mm'), cutoffHoursD) ?? 0;
+                const phutVe = phutTrongNgayLamViec(estimatedEndTime, cutoffHoursD);
+                if (phutVe === null || phutVe <= phutDen) {
+                    return NextResponse.json({ success: false, error: 'Giờ tan ca phải sau giờ đến làm hiện tại.' }, { status: 400 });
+                }
             }
 
             // Phạt trễ (§4.4 - đã chốt 2026-09-08):
-            //  - LATE_REPORTED: so với late_expected_time (giờ đã báo trễ)
-            //  - REGISTERED  : so với expected_time (giờ đăng ký gốc) — đến trễ mà KHÔNG báo
-            if (registration) {
+            // KTV OFF tự nguyện đến làm (wasOffRegistered) KHÔNG bị phạt trễ.
+            if (registration && !wasOffRegistered) {
                 const now = vnNow();
@@ -431,2 +461,3 @@ export async function POST(request: Request) {
         if (photoBase64 && checkType !== 'OVERTIME') {
+            logCheckpoint('photo_upload_start');
             try {
@@ -465,2 +496,3 @@ export async function POST(request: Request) {
             }
+            logCheckpoint('photo_upload_done');
         }
@@ -472,2 +504,3 @@ export async function POST(request: Request) {
         const finalStatus = 'CONFIRMED';
+        logCheckpoint('insert_attendance_start');
 
@@ -493,2 +526,3 @@ export async function POST(request: Request) {
         if (insertError) {
+            logCheckpoint('insert_attendance_failed', { err: insertError.message });
             if (checkType === 'OVERTIME') {
@@ -504,2 +538,3 @@ export async function POST(request: Request) {
         }
+        logCheckpoint('insert_attendance_done', { recordId: record.id });
 
@@ -539,2 +574,21 @@ export async function POST(request: Request) {
                     }
+                    // Khi OFF chuyển sang đi làm thành công, cập nhật bản ghi đăng ký Loại D và Staff available_until
+                    if (wasOffRegistered && typeDRegistrationId) {
+                        const { error: regUpdateErr } = await supabase
+                            .from('KTVTypeDDailyRegistration')
+                            .update({
+                                status: 'REGISTERED',
+                                expected_time: format(nowVn, 'HH:mm'),
+                                expected_end_time: finalEstimatedEndTime,
+                                check_in_at: nowUtc.toISOString(),
+                            })
+                            .eq('id', typeDRegistrationId);
+                        if (regUpdateErr) console.error(`❌ [Attendance:${reqTraceId}] Lỗi cập nhật KTVTypeDDailyRegistration:`, regUpdateErr);
+
+                        const { error: staffAvailErr } = await supabase
+                            .from('Staff')
+                            .update({ available_until: finalEstimatedEndTime })
+                            .eq('id', staffCode);
+                        if (staffAvailErr) console.error(`❌ [Attendance:${reqTraceId}] Lỗi cập nhật Staff available_until:`, staffAvailErr);
+                    }
                 } else if (checkType === 'CHECK_OUT' || checkType === 'SUDDEN_OFF' || checkType === 'OFF_REQUEST') {
@@ -904,2 +958,3 @@ export async function POST(request: Request) {
         }
+        logCheckpoint('completed');
 
@@ -915,4 +970,12 @@ export async function POST(request: Request) {
     } catch (error: any) {
-        console.error('❌ [Attendance POST] Unhandled error:', error);
-        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
+        const elapsed = Date.now() - reqStartMs;
+        const wasAborted = request.signal.aborted;
+        console.error(`❌ [Attendance POST:${reqTraceId}] Unhandled error after ${elapsed}ms (aborted=${wasAborted}):`, {
+            name: error?.name,
+            code: error?.code,
+            message: error?.message,
+            stack: error?.stack?.slice(0, 300)
+        });
+        return NextResponse.json({ success: false, error: error.message || 'Lỗi xử lý điểm danh' }, { status: 500 });
     }
 }
```

### 7.11. `TableInSupabase.md`
```diff
--- a/TableInSupabase.md
+++ b/TableInSupabase.md
@@ -487,3 +487,4 @@
 | `work_date` | date | Ngày đăng ký (YYYY-MM-DD) |
 | `expected_time` | time | Giờ dự kiến đến làm |
+| `expected_end_time` | time | Giờ tan làm đăng ký; nguồn giờ gốc gia hạn TYPE_D. |
 | `registered_at` | timestamptz | Thời điểm đăng ký |
```

---

## 8. Kế Hoạch Kiểm Thử (Test Plan) & Phương Án Rollback

### 8.1. Ma trận kiểm thử (Test Matrix)
Chạy script kiểm thử không ghi dữ liệu thật, kiểm tra logic tĩnh và build:

| ID | Kịch bản kiểm thử | Kỳ vọng | Cách thức kiểm tra |
|---|---|---|---|
| **T01** | TYPE_D + có quyền + `REGISTERED` (ngày đi làm) | Card hiện điểm hôm nay bình thường (VD `100/100`), không hiện `"Hôm nay là OFF"`. | Unit test & Dashboard render |
| **T02** | TYPE_D + có quyền + `LATE_REPORTED` | Không bị coi là OFF, điểm hôm nay hiển thị bình thường. | Unit test API office-score |
| **T03** | TYPE_D + có quyền + `OFF_REGISTERED` | Card vẫn hiện, hiển thị `"Hôm nay là OFF"`, mô tả `"Xem lịch sử và điểm tháng"`. Bấm mở modal bình thường. Modal không fallback về `100/100`. Điểm tháng và các ngày lịch sử vẫn đầy đủ. | Test suite & UI assertion |
| **T04** | OFF + Bật nhận đơn ngoài giờ (nhưng chưa đến tiệm) | `Staff.online_status = 'ONLINE'`, nhưng `KTVTypeDDailyRegistration` vẫn `OFF_REGISTERED`. Thẻ Office vẫn hiển thị `"Hôm nay là OFF"`. | Test endpoint on-call |
| **T05** | OFF + Mở form Oria Xin chào rồi hủy | Không ghi bất kỳ dữ liệu nào vào DB, trạng thái giữ nguyên `OFF_REGISTERED`. | Test form cancel action |
| **T06** | OFF + Bấm Oria Xin chào thiếu giờ về hoặc sai định dạng | Client validate chặn submit, báo lỗi `t.offEndTimeRequired`. Gửi API trực tiếp trả 400. | Client & API 400 validation |
| **T07** | OFF + Điểm danh hợp lệ với giờ về | Attendance ghi nhận, `KTVTypeDDailyRegistration` chuyển sang `REGISTERED`, lưu `expected_end_time`, `Staff.available_until` khớp giờ về. Office Card chuyển sang hiện điểm hôm nay sau refresh. | Integration test |
| **T08** | Gia hạn ca sau khi OFF check-in thành công | Hook `useShiftExtension` nhận diện đúng `expected_end_time` vừa lưu, cho phép gia hạn tối thiểu 60 phút. | Test shift extension hook |
| **T09** | Không phạt trễ cho ca OFF đi làm | KTV OFF đi làm lúc 14:00 (sau giờ expected_time mặc định nếu có) không bị trừ giờ hay phạt trễ. | KtvTypeDDisciplineService guard |
| **T10** | Lỗi mạng / timeout trong `apiClient.ts` | `clearTimeout(id)` luôn được dọn sạch trong `finally`, không rò rỉ timer. | Test apiClient timeout rejection |
| **T11** | Biên thời gian qua nửa đêm (23:30 → 01:30) | `phutTrongNgayLamViec` so sánh chính xác, không bị lỗi ngày lịch. | Test helper `phutTrongNgayLamViec` |
| **T12** | TypeScript & ESLint | `npx tsc --noEmit` pass 100% không có type error; `eslint` sạch sẽ. | CI / Command run |

### 8.2. Giới hạn & Phương án Rollback
* **Giới hạn:**
  - Lỗi ECONNRESET khi tải 5 ảnh base64 qua mạng di động kém có thể do băng thông client/proxy; telemetry mới sẽ chỉ ra chính xác stage bị nghẽn để tối ưu hóa nén ảnh ở client nếu cần.
  - Không thay đổi timezone UTC của server và giữ nguyên mốc cutoff ngày làm việc hiện hành.
* **Phương án Rollback:**
  - Nếu có bất kỳ vấn đề hồi quy sau khi triển khai, hoàn trả lại HEAD `1f50f480` bằng lệnh git sạch sẽ:
    `git checkout 1f50f480 -- app/ lib/ TableInSupabase.md`
  - Dữ liệu schema không bị ảnh hưởng vì không chạy migration mới nào làm thay đổi cấu trúc bảng.
