# Current KTV Policy Architecture Audit

> **Báo cáo kỹ thuật chi tiết về hiện trạng kiến trúc KTV, Chế độ làm việc (Work Mode), Chấm công, Ca làm, Điều phối, Tiền tua, Ví và Quy chế phạt.**
> 
> *Tài liệu phục vụ kiến trúc sư / AI thiết kế lại hệ thống theo mô hình Dynamic Policy / Config-Driven.*
> *Nguyên tắc audit: Khảo sát hiện trạng thực tế trong codebase, trích dẫn chính xác File, Line, Function, Table, Column, API; không suy đoán, không refactor.*

---

## 1. Executive Summary

Hệ thống quản lý KTV (Kỹ thuật viên) hiện tại đang ở trạng thái **chuyển giao giữa kiến trúc đơn khối (monolithic hard-coded) và mô hình đa chế độ thử nghiệm (hybrid multi-tier)**. Ban đầu hệ thống được xây dựng cho một loại KTV duy nhất (KTV cơ hữu, cố định tại spa). Qua các giai đoạn phát triển kinh doanh, hệ thống đã mở rộng thêm các loại KTV: Loại B (hợp tác / nhận đơn linh hoạt), Loại C (thợ ngoài / nhập tay vãng lai), và Loại D (tự chủ ca / tính giờ tích lũy / xếp hạng tự động / khấu trừ sao).

Tuy nhiên, việc mở rộng này chưa được thiết kế thành một tầng Policy trừu tượng (Policy Engine) mà chủ yếu được thực hiện bằng cách:
1. **Phân nhánh điều kiện `if / else` và `switch(work_type)`** rải rác khắp các tầng: Client React components, Next.js Server Actions, Route Handlers (API), và các Stored Procedures (PL/pgSQL RPC) trong Supabase.
2. **Hard-code tiền tố mã dịch vụ (Service ID Prefix)**: Hệ thống sử dụng quy ước tiền tố chuỗi (`NHP`, `NHT`, `VIP` vs `NHS`) để quyết định đơn giá tính tiền tua thay vì dùng bảng quan hệ hoặc ma trận giá dịch vụ theo chế độ.
3. **Logic tính tiền tua bị nhân bản 4 nơi**: Cùng một công thức tính tiền theo mốc phút (milestones) và giờ được viết độc lập bằng TypeScript trên server, bằng PL/pgSQL trong SQL migration RPC, bằng TypeScript trên Client UI, và một Engine riêng biệt cho KTV Loại D.
4. **Xung đột giữa dữ liệu Snapshot và Dynamic Recalculation**: Sổ cái hàng ngày (`KTVDailyLedger`) ghi nhận snapshot doanh thu, nhưng hàm tính số dư ví (`get_ktv_wallet_balance`) lại quét lại toàn bộ dữ liệu lịch sử từ ngày `2026-05-04` và tính toán lại theo cấu hình hiện tại của `SystemConfigs`. Khi admin đổi mốc tiền tua, toàn bộ thu nhập quá khứ bị tính lại.
5. **Nhập nhằng giữa các khái niệm thời gian**: "Giờ theo lịch" (Scheduled Time), "Giờ có mặt" (Attendance Time), "Giờ sẵn sàng" (Availability Time) và "Giờ làm thực tế" (Service Time) bị phụ thuộc chéo vào nhau trong bảng `TurnQueue` và `KTVShifts`.

---

## 2. Current Architecture

Hệ thống xác định danh tính và chế độ hoạt động của KTV thông qua hai bảng chính trong cơ sở dữ liệu Supabase: `Users` (tài khoản đăng nhập) và `Staff` (hồ sơ nhân sự và nghiệp vụ spa).

### 2.1. Các loại / Chế độ KTV hiện hữu
Codebase hiện định nghĩa 4 giá trị trong union type `WorkType`:
- **`TYPE_A` (Cơ bản / Cơ hữu)**: KTV làm việc toàn thời gian tại cơ sở, có ca làm cố định (Ca 1, Ca 2, Ca 3), chấm công qua Wi-Fi spa, xếp lượt phục vụ theo vòng quay vật lý (`TurnQueue`).
- **`TYPE_B` (Hợp tác / Linh hoạt)**: KTV hợp tác từ xa hoặc tại chỗ. Không gắn với ca cố định. Có khả năng bật nhận đơn ngoài giờ (On-call / Go Online) từ xa với thời gian di chuyển (travel minutes). Hưởng đơn giá tua cao hơn khi phục vụ dịch vụ VIP.
- **`TYPE_C` (Nhập tay / Freelance)**: Thợ hỗ trợ đột xuất hoặc thợ ngoài. Được hệ thống tự động sinh mã hồ sơ (`EXT_xxxxx`) khi thu ngân/quầy nhập tay tên một thợ không có sẵn trong danh sách. Loại C được miễn hoàn toàn kiểm tra chấm công khi điều phối.
- **`TYPE_D` (Tự chủ / Chấm sao)**: Nhóm KTV hoạt động theo cơ chế tự chủ, được vận hành bởi một Engine sổ cái độc lập (`KtvDLedgerEngine`). Thu nhập tính theo phút thực tế (chặn trần theo phút gán), bị khấu trừ theo sao đánh giá (thang 4 sao), tích lũy giờ làm việc ròng (`net_hours`) và chịu chế tài trừ giờ nghiêm ngặt khi vi phạm.

### 2.2. Nơi lưu trữ và kiểu dữ liệu
- **File định nghĩa Type**: `lib/types/staff.types.ts`
  - Line 1: `export type WorkType = 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';`
- **File nhãn hiển thị**: `lib/constants/staff.constants.ts`
  - Lines 6–11:
    ```typescript
    export const WORK_TYPE_LABELS = {
        TYPE_A: 'Cơ bản',
        TYPE_B: 'Hợp tác',
        TYPE_C: 'Nhập tay',
        TYPE_D: 'D'
    };
    ```
- **Database Table & Column**:
  - Table: `public.Staff`
  - Column: `work_type` (`text` / `varchar`, cho phép `NULL`, mặc định ứng dụng gán `'TYPE_A'`).
  - Column: `feature_flags` (`jsonb`): Chứa các cờ bật/tắt tính năng bổ trợ riêng cho từng KTV (ví dụ: `allow_on_call`, `laundry_deduction`, `bonus_wallet`).
  - Column: `online_status` (`text`, enum ứng dụng: `'OFFLINE' | 'ONLINE' | 'AT_VENUE'`).
  - Database Constraint: Trong migration `supabase/migrations/20260901000000_add_type_d_support.sql`, cột `work_type` có ràng buộc kiểm tra: `CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'))`.

### 2.3. Luồng đăng nhập và nạp chế độ (Login & Mode Loading)
- **API / Action**: `app/login/actions.ts` -> function `authenticateUser`
- **Luồng thực thi**:
  1. Người dùng nhập `username` và `password`.
  2. Xác thực tài khoản qua Supabase Auth (JWT) hoặc fallback bảng `Users`.
  3. Lấy thông tin tài khoản từ `Users` (`id, code, role, fullName`).
  4. Truy vấn bảng `Staff` bằng mã nhân viên (`code`):
     ```typescript
     const { data: staffData } = await supabase
         .from('Staff')
         .select('avatar_url, feature_flags, status')
         .eq('id', user.code)
         .maybeSingle();
     ```
  5. **Điểm bất thường**: Action login **không** trực tiếp nạp `work_type` vào session `spa_auth_user`. Session lưu trong `sessionStorage` chỉ gồm: `{ id, code, name, roleId, avatarUrl, featureFlags }`.
  6. Các màn hình nghiệp vụ KTV (Dashboard, Chấm công, Lịch làm) sau đó phải tự thực hiện query thứ cấp vào bảng `Staff` để lấy `work_type` nhằm render giao diện tương ứng.

### 2.4. Sự phụ thuộc giữa Frontend và Backend
- **Frontend**:
  - Dựa vào `work_type` để ẩn/hiển thị các tab và nút bấm: Tab Ví Tua / Ví Bonus (`lib/featureFlags.ts`), nút "Bật nhận đơn" (On-call dành cho Type B), bảng chọn ca làm việc.
  - Phụ thuộc vào `user.featureFlags` để mở quyền kiểm tra công việc nội bộ (`enable_employee_tasks`).
- **Backend (API / RPC / Server Actions)**:
  - Route chấm công (`app/api/ktv/attendance/route.ts`): Nhánh logic hoàn toàn khác nhau giữa Type A/D (tác động `TurnQueue`, `KTVShifts`) và Type B (gọi `KtvOnlineService.arriveAtVenue`).
  - Route ca làm (`app/api/ktv/shift/route.ts`): Chủ động loại trừ KTV Type B ra khỏi danh sách ca làm việc.
  - Route điều phối (`app/reception/dispatch/actions.ts`): Bỏ qua kiểm tra điểm danh đối với Type C (`EXT_...`).
  - Tầng tính tiền tua (`KtvCommissionService.ts` & SQL RPC): Dùng `work_type` để chọn mốc giá từ `SystemConfigs` và áp dụng điều kiện tiền tố dịch vụ.

---

## 3. Staff / Work Modes

Dưới đây là bảng kiểm toán toàn diện các vị trí phân nhánh theo `work_type` hoặc `staff_type` trong codebase:

| STT | File & Dòng | Biểu thức điều kiện / Logic | Hành vi nghiệp vụ tương ứng | Hard-coded? | Ghi chú kiến trúc |
|---|---|---|---|---|---|
| 1 | `lib/types/staff.types.ts`:1 | `type WorkType = 'TYPE_A' \| 'TYPE_B' \| 'TYPE_C' \| 'TYPE_D'` | Khai báo 4 chế độ hợp lệ | CÓ | Không thể thêm Type E/F nếu không sửa TypeScript |
| 2 | `lib/constants/staff.constants.ts`:6-11 | `WORK_TYPE_LABELS` | Gán nhãn Tiếng Việt cho từng Type | CÓ | Nhãn hiển thị gắn cứng trong mã nguồn |
| 3 | `app/admin/employees/actions.ts`:16 | `.neq('work_type', 'TYPE_C')` | Ẩn KTV vãng lai / nhập tay khỏi danh sách nhân viên của Admin | CÓ | Admin không thể xem/sửa KTV Type C trên UI nhân sự |
| 4 | `app/admin/employees/actions.ts`:131-133 | `work_type === 'TYPE_B' ? DEFAULT_FEATURE_FLAGS_TYPE_B : DEFAULT_FEATURE_FLAGS_TYPE_A` | Gán cờ tính năng mặc định khi tạo mới nhân viên | CÓ | Type D phải gán cờ thủ công hoặc qua script riêng |
| 5 | `app/reception/dispatch/actions.ts`:532, 549 | `eq('work_type', 'TYPE_C')` & `insert({ work_type: 'TYPE_C' })` | Tự động tạo KTV Type C mã `EXT_` khi quầy gõ tên mới | CÓ | Quy ước sinh mã `EXT_` cứng trong server action |
| 6 | `app/reception/dispatch/actions.ts`:592 | `!id.startsWith('C_') && !id.startsWith('EXT')` | Miễn kiểm tra chấm công cho Type C khi điều phối | CÓ | Lọc theo tiền tố chuỗi ID |
| 7 | `app/api/ktv/attendance/route.ts`:70 | `const isTypeB = staffData?.work_type === 'TYPE_B'` | Rẽ nhánh toàn bộ luồng điểm danh cho Type B | CÓ | Type B không vào TurnQueue mà cập nhật Online Status |
| 8 | `app/api/ktv/attendance/route.ts`:133 | `block_checkout_incomplete_tasks_${staffRow.work_type}` | Chặn tan ca nếu còn việc chưa nghiệm thu theo Type | BÁN PHẦN | Đọc key động từ SystemConfigs |
| 9 | `app/api/ktv/attendance/route.ts`:490 | `if (workType === 'TYPE_D')` | Xử lý phạt nghỉ đột xuất: Type D trừ 10 giờ, Type A/B trừ 500k tiền mặt | CÓ | Phạt giờ vs phạt tiền rẽ nhánh cứng |
| 10 | `app/api/ktv/shift/route.ts`:108-109 | `eq('work_type', 'TYPE_B')` | Loại trừ hoàn toàn Type B khỏi danh sách quản lý ca | CÓ | Cố định giả định: "Type B không bao giờ có ca" |
| 11 | `lib/services/KtvOnlineService.ts`:60 | `staff.work_type === 'TYPE_B' \|\| staff.feature_flags?.allow_on_call` | Cho phép bật nhận đơn On-call | CÓ | Type B được bật mặc định, Type khác phải có cờ |
| 12 | `lib/services/KtvCommissionService.ts`:38 | `const typeSuffix = '_TYPE_' + workType.replace('TYPE_', '')` | Tạo key cấu hình mốc hoa hồng động | BÁN PHẦN | Đọc SystemConfigs theo hậu tố |
| 13 | `lib/services/KtvCommissionService.ts`:96 | `else if (workType === 'TYPE_B') { ratePer60 = 180000; }` | Fallback đơn giá giờ cho Type B khi thiếu config | CÓ | 180,000 đ/h gắn cứng trong code |
| 14 | `lib/services/KtvCommissionService.ts`:237-244 | `if (workType === 'TYPE_B') { if (!isPremium) activeConfig = commConfigs['TYPE_A']; }` | Type B làm dịch vụ phổ thông (NHS) bị ép về giá Type A | CÓ | Kiểm tra tiền tố dịch vụ NHP/NHT |
| 15 | `migrations/20260801160000_fix_type_b_nhs_commission.sql`:150-155 | `IF v_work_type = 'TYPE_B' THEN IF v_item.service_id LIKE 'NHP%' ...` | Nhân bản logic kiểm tra tiền tố dịch vụ trong SQL RPC | CÓ | Cùng một điều kiện bị viết lại trong SQL |
| 16 | `app/api/cron/sync-daily-ledger/route.ts`:111 | `if (staff.work_type === 'TYPE_D') continue;` | Bỏ qua Type D trong cron chốt sổ ngày truyền thống | CÓ | Type D chạy worker tái tính toán riêng |
| 17 | `lib/services/WalletAccessService.ts`:32, 84 | `ktv_wallet_${wallet}_enabled_${workType}` | Kiểm tra công tắc ví theo từng Work Type | BÁN PHẦN | Cấu hình trong SystemConfigs |
| 18 | `app/api/finance/adjustment/route.ts`:33 | `work_type_snapshot: workType` | Lưu vết loại KTV tại thời điểm điều chỉnh ví | CÓ | Ghi cứng cột snapshot |

---

## 4. Chấm công / Attendance

### 4.1. Trace toàn bộ luồng điểm danh
Điểm danh được thực hiện từ Client UI (`app/ktv/attendance/page.tsx` và `Attendance.logic.ts`) gửi request POST tới `app/api/ktv/attendance/route.ts`.

```
[KTV App: Bấm Điểm Danh]
       │
       ▼ (Gửi Base64 ảnh, IP, Tọa độ GPS, checkType)
[POST /api/ktv/attendance/route.ts]
       │
       ├─► 1. Kiểm tra dải IP Wi-Fi (spa_wifi_ips) qua 2 octet đầu
       │     └─► Mismatch: Log vào SecurityAuditLogs & ghi SystemConfigs -> Chặn 403
       │
       ├─► 2. Kiểm tra việc chưa nghiệm thu (Tasks table) nếu là CHECK_OUT
       │     └─► Có việc chưa PASSED: Chặn 403
       │
       ├─► 3. Upload ảnh chấm công lên Supabase Storage bucket 'attendance'
       │
       ├─► 4. Tự động duyệt: isAutoApprove = true (Hard-coded dòng 213)
       │     └─► Ghi bản ghi vào bảng KTVAttendance (status = 'CONFIRMED')
       │
       ├─► 5. Rẽ nhánh theo Chế độ KTV (work_type):
       │     │
       │     ├─► [Nếu là TYPE_B]:
       │     │     ├─ CHECK_IN / LATE_CHECKIN: Gọi KtvOnlineService.arriveAtVenue()
       │     │     │   └─ Set Staff.online_status = 'AT_VENUE'
       │     │     │   └─ Mở KTVShifts (shiftType = 'VIP', status = 'ACTIVE')
       │     │     └─ CHECK_OUT / SUDDEN_OFF: Gọi KtvOnlineService.goOffline()
       │     │         └─ Set Staff.online_status = 'OFFLINE'
       │     │         └─ Set TurnQueue.status = 'off'
       │     │         └─ Đóng KTVShifts (status = 'REPLACED')
       │     │         └─ Ghi nhận KTVLeaveRequests (nếu SUDDEN_OFF)
       │     │
       │     └─► [Nếu là TYPE_A / TYPE_D / Khác]:
       │           ├─ CHECK_IN:
       │           │   ├─ Users.isOnShift = true
       │           │   ├─ Cập nhật KTVShifts nếu có chọn ca tạm thời
       │           │   └─ Thêm/kích hoạt KTV trong TurnQueue (status = 'waiting', cấp số thứ tự)
       │           └─ CHECK_OUT / SUDDEN_OFF:
       │               ├─ Users.isOnShift = false
       │               ├─ KTVShifts.status = 'COMPLETED', actualEndTime = now
       │               ├─ TurnQueue.status = 'off'
       │               └─ Ghi nhận KTVLeaveRequests (nếu SUDDEN_OFF)
       │
       └─► 6. Khấu trừ tự động theo Feature Flags:
             ├─ Giặt đồ (laundry_deduction): Trừ 20,000đ trong WalletAdjustments (1 lần/ngày)
             └─ Phạt nghỉ đột xuất (sudden_leave_penalty):
                 ├─ Type D: KtvTypeDDisciplineService.deductDailyViolation (trừ 10 giờ)
                 └─ Type khác: Trừ 500,000đ trong WalletAdjustments
```

### 4.2. Trả lời 5 câu hỏi trọng tâm
1. **Điều kiện cho phép KTV check-in:**
   - Phải kết nối đúng mạng Wi-Fi của spa: IP của request phải khớp 2 octet đầu (ví dụ: `14.191.x.x`) với danh sách IP trong `SystemConfigs.spa_wifi_ips`.
   - Phải có ảnh chụp khuôn mặt trực tiếp (client canvas validate độ sáng, server upload storage).
   - Tọa độ GPS được gửi lên nhưng server **không** validate bán kính geofence mà chỉ dùng để tạo link Google Maps trong thông báo Telegram/Audit.
2. **Điều kiện bắt buộc check-in:**
   - KTV cơ hữu (Type A/D) bắt buộc phải check-in để được nạp vào hàng đợi xoay vòng (`TurnQueue`). Nếu chưa check-in, chức năng điều phối tại Quầy sẽ chặn không cho gán đơn (`app/reception/dispatch/actions.ts`: L605-610).
3. **Loại không cần check-in:**
   - **`TYPE_C` (Nhập tay / Freelance)**: Hoàn toàn không cần check-in. Khi điều phối gán mã `EXT_...`, hệ thống bỏ qua kiểm tra `TurnQueue`.
   - **`TYPE_B` khi nhận đơn từ xa (On-call)**: Không cần check-in tại spa để nhận đơn, chỉ cần bật trạng thái Online từ app ở nhà. Khi tới cơ sở mới bấm xác nhận tới nơi.
4. **Mối quan hệ giữa Check-in và các nghiệp vụ:**
   - **Nhận đơn**: Có liên quan trực tiếp. Quầy chỉ gán được KTV có `TurnQueue.status != 'off'` (trừ Type C).
   - **Tính tiền**: **Không phụ thuộc trực tiếp**. Tiền tua tính theo `BookingItems` đã hoàn thành. Nếu một KTV quên check-in nhưng Quầy lách bằng cách gán đơn, KTV vẫn được tính tiền tua trên đơn đó.
   - **Tính giờ / Tích lũy giờ**: Điểm danh **không** dùng để tính giờ làm khách. Giờ làm khách được tính từ `BookingItems.segments`. Tuy nhiên, giờ điểm danh dùng để phạt vi phạm (đi trễ, nghỉ đột xuất).
   - **Trạng thái online**: Check-in ép trạng thái `Users.isOnShift = true` và `Staff.online_status = 'AT_VENUE'`.
5. **Trường hợp Check-out / Tan ca bị chặn:**
   - Khi KTV còn công việc trong ngày chưa được Admin nghiệm thu: `Tasks.inspection_status != 'PASSED'` (nếu cấu hình `block_checkout_incomplete_tasks_${work_type}` bật).
   - Khi chưa tới giờ kết thúc ca (`SHIFT_END_TIMES`), trừ khi có bật cấu hình cho phép về sớm (`allow_early_checkout`) hoặc ca làm thuộc loại linh hoạt (`FREE`, `REQUEST`, `VIP`).

### 4.3. Phân biệt 4 khái niệm thời gian trong Codebase
Codebase hiện tại đang có sự nhập nhằng nghiêm trọng giữa các khái niệm thời gian:
1. **Scheduled Time (Thời gian theo ca)**: Lưu tại `KTVShifts` (`shiftType`, ví dụ Ca 1: 09:00 - 17:00).
2. **Attendance Time (Thời gian có mặt)**: Lưu tại `KTVAttendance` (`created_at` lúc check-in đến `actualEndTime` lúc check-out).
3. **Availability Time (Thời gian sẵn sàng)**: Lưu tại `Staff.available_from` và `Staff.available_until` (chỉ áp dụng cho Type B on-call).
4. **Service Time (Thời gian phục vụ khách)**: Lưu tại `BookingItems.segments` (`actualStartTime`, `actualEndTime`, `pauses`).

*Điểm gộp nhập nhằng*:
- Trong `KTVShifts`, khi KTV Type B bấm tới tiệm, hệ thống mở một ca ảo gọi là `VIP` (00:00 - 23:59) để hợp thức hóa việc KTV đang có mặt, biến Scheduled Time thành Attendance Time.
- Trong `TurnQueue`, cột `start_time` và `estimated_end_time` bị ghi đè liên tục giữa giờ của ca làm việc và giờ của đơn hàng đang phục vụ (`app/reception/dispatch/actions.ts`: L1158-1159).

---

## 5. Ca làm / Scheduling

### 5.1. Cấu trúc lưu trữ và các loại ca
- **Database Table**: `public.KTVShifts`
- **Columns**: `id, employeeId, employeeName, shiftType, effectiveFrom, previousShift, reason, status, estimatedEndTime, actualEndTime, createdAt, reviewedBy, reviewedAt`.
- **Ràng buộc Status**: `'ACTIVE' | 'REPLACED' | 'PENDING' | 'COMPLETED'`.
- **Các loại ca (Hard-coded trong `app/api/ktv/shift/route.ts`: L7-16)**:
  - `SHIFT_1`: 09:00 - 17:00 (Ca 1)
  - `SHIFT_2`: 11:00 - 19:00 (Ca 2)
  - `SHIFT_3`: 17:00 - 00:00 (Ca 3)
  - `DEV_SHIFT`: 09:00 - 21:00 (Ca Dev)
  - `FREE`: 00:00 - 23:59 (Ca tự do)
  - `REQUEST`: 00:00 - 23:59 (Làm khách yêu cầu)
  - `SUPPORT`: 00:00 - 23:59 (Ca Hậu cần)
  - `VIP`: 00:00 - 23:59 (Ca VIP)

### 5.2. Mối quan hệ giữa Ca làm và Chế độ KTV
- **Có bắt buộc mọi KTV phải có ca không?**
  - **Không**. Hệ thống hiện tồn tại KTV không có ca cố định.
  - Cụ thể: `app/api/ktv/shift/route.ts` dòng 108–110 chủ động query danh sách KTV Type B và loại trừ họ ra khỏi toàn bộ màn hình và API quản lý ca:
    ```typescript
    const { data: staffData } = await supabase.from('Staff').select('id').eq('work_type', 'TYPE_B');
    const typeBIds = new Set(staffData?.map(s => s.id) || []);
    // Dòng 147:
    if (!typeBIds.has(shift.employeeId) && !dedupMap.has(shift.employeeId)) { ... }
    ```
- **KTV Type C**: Hoàn toàn không có bản ghi nào trong `KTVShifts`.
- **Đè ca ngày lễ (`holiday_shift2_dates`)**:
  - `app/api/ktv/shift/route.ts`: L51-60 đọc mảng ngày từ `SystemConfigs.holiday_shift2_dates` (ví dụ: `['04-30', '09-02', '12-31']`).
  - Nếu ngày hiện tại trùng ngày lễ, hệ thống đè toàn bộ ca của tất cả KTV thành `SHIFT_2` (L168).
- **Tự động hoàn ca tạm (Auto-revert temporary shifts)**:
  - Khi điểm danh, KTV có thể tự chọn ca khác cho ngày hôm đó (`reason: 'Tự chọn ca lúc điểm danh'`).
  - Khi sang ngày kinh doanh mới, API GET `/api/ktv/shift` tự động chạy một vòng lặp kiểm tra: nếu ca tạm đã hết hạn (`effectiveFrom < businessDateStr`), hệ thống tự động update ca tạm thành `REPLACED` và insert lại ca gốc với `reason: 'Khôi phục ca gốc sau điểm danh'`.

---

## 6. Sẵn sàng / Availability

### 6.1. Luồng Bật / Tắt nhận đơn (Availability Flow)
Tính năng bật nhận đơn ngoài cơ sở chủ yếu phục vụ KTV Type B (hoặc KTV có cờ `allow_on_call = true`).

```
KTV (Tại nhà) 
  │
  ▼ Bấm "Bật nhận đơn" (chọn thời gian di chuyển: 5 - 60 phút)
[POST /api/ktv/online/route.ts] (action: 'go_online')
  │
  ▼ Gọi KtvOnlineService.goOnline()
  ├─ 1. Validate thời gian di chuyển (5 <= travelMinutes <= 60)
  ├─ 2. Kiểm tra quyền: staff.work_type === 'TYPE_B' || staff.feature_flags?.allow_on_call === true
  │     └─ Sai: Trả lỗi 403 "Lỗ hổng bảo mật: KTV chưa được cấp quyền nhận đơn ngoài giờ!"
  ├─ 3. Cập nhật Staff:
  │     online_status = 'ONLINE'
  │     travel_minutes = travelMinutes
  │     available_from = HH:mm hiện tại
  │     available_until = HH:mm (+ 4 tiếng hoặc hết khung)
  │
  ▼ Quầy Điều Phối (Dispatch Board)
  ├─ Hiển thị thẻ KTV màu xanh On-call kèm thời gian di chuyển ETA
  ├─ Khi Quầy gán đơn -> KTV nhận được thông báo điều phối -> Di chuyển tới spa
  │
  ▼ KTV tới Spa -> Bấm "Đã tới tiệm" (action: 'arrive')
  ├─ KtvOnlineService.arriveAtVenue()
  ├─ Staff.online_status = 'AT_VENUE'
  ├─ Mở KTVShifts (shiftType = 'VIP', status = 'ACTIVE')
  └─ TurnQueue: Đưa vào hàng đợi với status = 'waiting' (hoặc 'working' nếu đã gán đơn)
  │
  ▼ Tan ca / Tắt nhận đơn (action: 'go_offline')
  ├─ KtvOnlineService.goOffline()
  ├─ Staff.online_status = 'OFFLINE', travel_minutes = 0
  ├─ TurnQueue.status = 'off'
  └─ KTVShifts: status = 'REPLACED' (reason: 'KTV tự tắt app')
```

### 6.2. Các điều kiện tiên quyết
- **Có cần check-in trước không?**: Để bật nhận đơn từ xa (`go_online`), **không** cần check-in Wi-Fi. Nhưng khi tới spa để làm khách (`arrive`), hệ thống sẽ kích hoạt trạng thái có mặt.
- **Có giới hạn theo ca không?**: Không bị giới hạn bởi ca làm việc. KTV Type B có thể bật bất cứ lúc nào trong ngày.
- **Khác biệt theo loại KTV**:
  - Type A: Mặc định không được bật nhận đơn từ xa (bị chặn ở `KtvOnlineService.goOnline`: L60-62), chỉ online bằng cách tới spa check-in Wi-Fi.
  - Type D: Cờ `allow_on_call` mặc định là `false` (`DEFAULT_FEATURE_FLAGS_TYPE_D`). Type D chịu quy chế kỷ luật giờ nghiêm ngặt nên việc nhận đơn tự do bị hạn chế tối đa.

---

## 7. Điều phối Dịch vụ / Service Assignment

### 7.1. Cấu trúc đơn và cấp độ gán KTV
- **Order Level vs Service Level**:
  - Bảng `Bookings` đại diện cho Đơn hàng cha (Order Level). Bảng này có cột `technicianCode` (lưu mã KTV chính / KTV đại diện).
  - Bảng `BookingItems` đại diện cho từng dịch vụ trong đơn (Service Level). Mỗi dòng có cột `technicianCodes` (`text[]` hoặc JSON string chứa mảng các mã KTV).
  - Bảng `BookingGuests` đại diện cho từng khách đi theo nhóm trong cùng 1 Bill.
- **Một Order có nhiều Service không?**: CÓ. Một Bill có thể có nhiều `BookingItems` (ví dụ: Massage Body 90p + Ngâm chân thuốc bắc + Phòng riêng).
- **Mỗi Service có thể có KTV riêng không?**: CÓ. Mỗi `BookingItem` lưu danh sách `technicianCodes` độc lập.
- **Một Service có thể có nhiều KTV không?**: CÓ. Trường hợp làm 4 tay (2 KTV phục vụ 1 khách) hoặc KTV đổi ca giữa chừng. Trong `BookingItems.segments`, mỗi KTV có một chặng thời gian riêng:
  ```json
  [
    { "ktvId": "NH016", "duration": 60, "actualStartTime": "...", "actualEndTime": "..." },
    { "ktvId": "NH020", "duration": 60, "actualStartTime": "...", "actualEndTime": "..." }
  ]
  ```

### 7.2. Cơ chế Đổi KTV giữa chừng (KTV Swap / Pause / Resume)
Được hiện thực trong `lib/services/BookingItemPauseService.ts`:
1. **Tạm ngưng (`pauseItem`)**: Chuyển trạng thái `BookingItems.status = 'PAUSED'`, ghi nhận `pauseStart = now`.
2. **Tiếp tục (`resumeItem`)**: Tính `pauseDurationMs = now - pauseStart`. Để tránh đồng hồ đếm ngược của KTV bị sai, code cũ tịnh tiến `Bookings.timeStart` tới trước. Code mới (`lib/segment-time.ts`) ghi nhận khoảng dừng vào mảng `pauses: [{ from, to }]` của segment.
3. **Đổi KTV (`swapKtvOnPausedItem`)**:
   - **Xử lý KTV cũ (Bị rút ra)**:
     - Nếu `keepTurnForOldKtv === true`: Cập nhật `TurnLedger.update({ is_punished: true })` -> Giữ lượt tua nhưng đánh dấu phạt.
     - Nếu `keepTurnForOldKtv === false`: Xóa hẳn bản ghi khỏi `TurnLedger` (`.delete()`) -> Hủy lượt tua của KTV cũ.
     - Trong segment cũ: Chốt `endTime = pauseTime`, ghi `note = 'Bị đổi người (Phạt)'` hoặc `'Rút ra làm dịch vụ khác'`. Đưa KTV cũ về `TurnQueue.status = 'waiting'`.
   - **Xử lý KTV mới (Vào thay / Cứu hộ)**:
     - Tính thời lượng hưởng hoa hồng: `customCommissionDuration = originalDuration + extraTimeMins`. KTV mới được hưởng **toàn bộ thời lượng gốc của dịch vụ cộng thêm thời gian bù**, không cần biết KTV cũ đã làm bao nhiêu phút.
     - Cấp lượt tua mới trong `TurnLedger` cho KTV mới (`.insert()`).
     - Đưa KTV mới lên `TurnQueue.status = 'working'`.
     - Thêm segment mới với `note = 'Vào cứu bộ'` và gán `customCommissionDuration`.

### 7.3. Tạo và Xóa bản ghi Lượt tua (`TurnLedger`)
- **Tạo mới**: Khi Quầy xác nhận điều phối đơn qua RPC `dispatch_confirm_booking`. RPC này thực hiện `INSERT INTO "TurnLedger"` với quy tắc: **1 KTV × 1 Booking = 1 Lượt tua** (bất kể KTV đó làm bao nhiêu dịch vụ trong đơn). Ràng buộc UNIQUE: `("date", "booking_id", "employee_id")`.
- **Hủy / Xóa**: Khi Quầy hủy đơn (`cancelBooking` trong `app/reception/dispatch/actions.ts`: L1134):
  - Nếu đơn bị hủy **trước khi bắt đầu** (`turn.status` là `assigned`, `ready`, hoặc `waiting`): Xóa bản ghi trong `TurnLedger` để hoàn lượt cho KTV.
  - Nếu đơn bị hủy **khi đang làm** (`turn.status === 'working'`): Giữ nguyên bản ghi trong `TurnLedger` để KTV vẫn được tính lượt tua và ghi nhận công.

---

## 8. Tiền Tua / Tour Pay (Trọng tâm nhất)

Hiện tại, hệ thống **chưa** có bảng ma trận chuẩn `SERVICE × KTV_MODE -> TOUR_PAY`. Toàn bộ việc tính tiền tua đang chạy trên các thuật toán nội suy dựa trên **thời lượng phút của dịch vụ**, kết hợp kiểm tra tiền tố mã dịch vụ.

### 8.1. Cơ sở tính tiền tua hiện tại
Tiền tua được tính dựa trên:
1. **Thời lượng phút** của dịch vụ mà KTV thực hiện (chứ không tính theo phần trăm giá trị hóa đơn).
2. **Bảng mốc hoa hồng (Milestones)** lưu trong `SystemConfigs`.
3. **Mã dịch vụ (Service ID Prefix)** để phân loại thường vs VIP.
4. **Loại KTV (`work_type`)**: Quyết định bảng cấu hình mốc nào được nạp.

### 8.2. Bảng mốc hoa hồng mặc định (Milestone Map)
Cấu hình mặc định trong `lib/services/KtvCommissionService.ts` (L82):
```json
{
  "1": 2000,
  "30": 50000,
  "45": 75000,
  "60": 100000,
  "70": 115000,
  "90": 150000,
  "100": 165000,
  "120": 200000,
  "180": 300000,
  "300": 500000
}
```
*(Số phút -> Số tiền VNĐ. Ví dụ: 60 phút = 100,000đ; 90 phút = 150,000đ; 120 phút = 200,000đ).*

### 8.3. Sự khác biệt giữa TYPE_A và TYPE_B (Trích xuất Code Thực tế)
Sự khác biệt cốt lõi giữa Type A và Type B nằm ở việc **ép giá dịch vụ phổ thông về Type A**.

#### A. Trong TypeScript (`lib/services/KtvCommissionService.ts`: L235–245):
```typescript
static calcCommission(
    durationMins: number, 
    commConfigs: Record<string, CommissionConfig>, 
    workType: string, 
    serviceId: string = ''
): number {
    let activeConfig = commConfigs[workType] || commConfigs['TYPE_A'];
    
    if (workType === 'TYPE_B') {
        const sId = String(serviceId || '').toUpperCase();
        const isPremiumService = sId.startsWith('NHP') || sId.startsWith('NHT');
        if (!isPremiumService) {
            // Nếu không phải dịch vụ VIP (NHP/NHT), KTV Loại B bị rơi về giá Loại A (ví dụ dịch vụ NHS)
            activeConfig = commConfigs['TYPE_A'];
        }
    }

    const sMins = String(durationMins);
    if (activeConfig && activeConfig.milestones && activeConfig.milestones[sMins] !== undefined) {
        return Number(activeConfig.milestones[sMins]);
    }
    
    // Fallback nếu số phút không nằm trong mốc (làm tròn đến hàng nghìn):
    const h = durationMins / 60;
    const ratePer60 = activeConfig ? activeConfig.ratePer60 : 100000;
    const comm = Math.round(h * ratePer60);
    return Math.round(comm / 1000) * 1000;
}
```

#### B. Trong SQL RPC (`migrations/20260801160000_fix_type_b_nhs_commission.sql`: L145–162):
```sql
-- RULE: KTV Loại B CHỈ CÓ mã NHP và NHT mới được tính rate TYPE_B, còn lại (NHS, v.v.) thì tính 100k/h (base rate)
DECLARE
    v_active_milestones jsonb := v_milestones;
    v_active_rate numeric := v_rate_60;
BEGIN
    IF v_work_type = 'TYPE_B' THEN
        IF v_item.service_id LIKE 'NHP%' OR v_item.service_id LIKE 'NHT%' THEN
            v_active_milestones := v_milestones_type;
            v_active_rate := v_rate_60_type;
        END IF;
    END IF;

    IF v_active_milestones ? v_ktv_duration::text THEN
        v_total_commission := v_total_commission + (v_active_milestones->>v_ktv_duration::text)::numeric;
    ELSE
        v_total_commission := v_total_commission + (ROUND((v_ktv_duration::numeric / 60) * v_active_rate / 1000) * 1000);
    END IF;
END;
```

### 8.4. Tiền tua của KTV Loại D (`KtvDLedgerEngine.ts`)
Loại D **hoàn toàn không dùng** bảng mốc Milestones trên. Thay vào đó, nó chạy một Engine riêng:
- Phân nhóm dịch vụ qua hàm `rateCategoryOf`:
  ```typescript
  const VIP_PREFIXES = ['NHP', 'NHT', 'VIP'];
  export function rateCategoryOf(serviceId) {
      const sid = String(serviceId || '').toUpperCase();
      return VIP_PREFIXES.some(p => sid.startsWith(p)) ? 'VIP' : 'PT';
  }
  ```
- Tính tiền gross không qua mốc mà tính theo phút tuyến tính:
  ```typescript
  const rate = category === 'VIP' ? configs.rateVIP : configs.ratePT; // ví dụ 150k/h vs 100k/h
  const gross = paid_minutes * (rate / 60);
  ```
- Khấu trừ sao đánh giá của khách (thang 4 sao):
  ```typescript
  // configs.ratingDeductions ví dụ: { '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 }
  const deduction = Number(configs.ratingDeductions[String(rating)] ?? 0);
  const net = gross * (1 - deduction);
  ```

### 8.5. Bốn vị trí nhân bản logic tính tiền tua
| Vị trí | Ngôn ngữ | Chức năng | Nguy cơ sai lệch |
|---|---|---|---|
| `lib/services/KtvCommissionService.ts` | TypeScript (Server) | Dùng cho cron chốt sổ ngày, báo cáo tài chính admin | Logic chuẩn của Node runtime |
| `migrations/20260801160000_...sql` (`get_ktv_wallet_balance`) | PL/pgSQL (Postgres) | Tính số dư ví tức thời trả về cho app KTV | Nếu sửa TS mà quên chạy migration SQL -> Lệch số dư ví |
| `migrations/20260801160000_...sql` (`get_ktv_wallet_timeline`) | PL/pgSQL (Postgres) | Hiển thị lịch sử dòng tiền chi tiết trên app KTV | Viết lại vòng lặp cursor riêng trong SQL |
| `app/ktv/dashboard/KTVDashboard.logic.ts` | TypeScript (Client) | Tính nhẩm tạm tính trên giao diện thợ | Client tự tính độc lập |

---

## 9. Menu / Service Pricing & Tour Rate

### 9.1. Schema bảng `Services`
- **Table Name**: `public.Services`
- **Columns quan trọng**:
  - `id`: string (ví dụ: `'NHS0100'`, `'NHP0200'`)
  - `code`: string (mã dịch vụ hiển thị)
  - `nameVN`: string (tên dịch vụ)
  - `priceVND`: numeric (giá bán cho khách, VNĐ)
  - `priceUSD`: numeric
  - `duration`: integer (thời lượng mặc định của dịch vụ, ví dụ 60, 90)
  - `category`: string (nhóm dịch vụ: Body, Foot, Combo...)
  - `is_utility`: boolean (cờ dịch vụ tiện ích như Phòng riêng, Nước ngọt - **không sinh tiền tua cho KTV**)
  - `procedure_desc`: jsonb (quy trình kỹ thuật)

### 9.2. Kiểm tra tồn tại Ma trận: `SERVICE × KTV_MODE -> TOUR_AMOUNT`
> **KẾT QUẢ AUDIT: HOÀN TOÀN CHƯA CÓ.**

Hiện tại:
- Bảng `Services` **không có** bất kỳ cột nào lưu tỷ lệ hoa hồng hay mức tiền tua cho KTV (không có `ktv_amount`, `commission_rate`, `tour_rate`).
- Không có bảng trung gian nào dạng `ServiceCommissionPolicies` hay `WorkTypeServiceRates`.
- **Cách hệ thống giải quyết hiện tại**:
  Hệ thống đọc cột `duration` của dịch vụ (hoặc thời gian KTV làm thực tế trong `segments`), sau đó cầm con số phút đó tra vào ô JSON `SystemConfigs.ktv_commission_milestones`.
  Nếu muốn một dịch vụ có tiền tua cao hơn (VIP), hệ thống **bắt buộc** kỹ thuật viên phải thuộc `TYPE_B` hoặc `TYPE_D` VÀ mã dịch vụ đó **bắt buộc** phải bắt đầu bằng chữ cái `NHP` hoặc `NHT`.

---

## 10. Wallet / Gross / Tax / Net

### 10.1. Cấu trúc Ví và Dòng tiền
Hệ thống quản lý 2 loại ví chính (`lib/featureFlags.ts`):
1. **`TUA` (Ví Tua)**: Chứa tiền hoa hồng dịch vụ hoàn thành hàng ngày.
2. **`BONUS` (Ví Bonus)**: Chứa tiền thưởng ca làm việc, thưởng khách chấm 4 sao, hoặc thưởng doanh số.

### 10.2. Thuế Thu Nhập Cá Nhân (PIT 10%) và Khấu trừ
- **Đối với KTV Type A, B, C**:
  - **Hoàn toàn KHÔNG tính thuế trong code**. Tiền tua tính ra từ mốc hoa hồng được cộng thẳng vào ví. Gross = Net.
  - Các khoản khấu trừ duy nhất là: Tiền giặt đồ (laundry fee: 20,000đ/ngày) và Phạt nghỉ đột xuất (500,000đ), được ghi vào bảng `WalletAdjustments`.
- **Đối với KTV Type D (`KtvDLedgerEngine.ts`: L328–332)**:
  - Có tính thuế PIT: Thuế suất cấu hình tại `configs.taxRate` (mặc định `0.1` = 10%).
  - Điều kiện áp thuế: Chỉ tính khi ngày làm việc `>= configs.taxEffectiveFrom`.
  - Công thức:
    ```typescript
    tax_amount = (commission_net + bonus_amount) * configs.taxRate;
    ```
  - Giá trị thuế **không làm tròn** ở tầng tính toán để tránh lệch tổng lũy kế, chỉ làm tròn khi chi tiền mặt.

### 10.3. Tính bất biến của Transaction (Immutability Risk)
> **RỦI RO KIẾN TRÚC NGHIÊM TRỌNG:**

Bản ghi số dư ví **không bất biến (NOT Immutable)**:
- Hàm RPC `get_ktv_wallet_balance` trong Postgres tính số dư ví bằng cách chạy một vòng lặp `FOR` quét toàn bộ các bản ghi `TurnLedger` của KTV từ mốc thời gian `2026-05-04` đến hiện tại.
- Trong vòng lặp đó, RPC đọc cấu hình mốc giá từ `SystemConfigs` tại thời điểm query:
  ```sql
  SELECT value INTO v_milestones FROM "SystemConfigs" WHERE key = 'ktv_commission_milestones';
  ```
- **Hậu quả**: Nếu hôm nay Admin vào trang Cài đặt đổi mức hoa hồng 60 phút từ 100,000đ lên 120,000đ, thì **toàn bộ các ca làm việc từ tháng 5/2026 của KTV đó trong quá khứ sẽ bị tính lại theo giá 120,000đ**, làm sai lệch toàn bộ số dư ví và đối soát kế toán.
- Ngược lại, cron job `app/api/cron/sync-daily-ledger/route.ts` lại ghi snapshot cố định vào `KTVDailyLedger`. Điều này tạo ra sự **lệch số liệu vĩnh viễn** giữa màn hình xem số dư ví của KTV (chạy qua RPC tính lại) và báo cáo doanh thu của Kế toán (chạy qua Daily Ledger snapshot).

---

## 11. Giờ tích lũy / Priority / Tua

Hệ thống đang sử dụng đồng thời 5 khái niệm định lượng công việc:

| Khái niệm | Định nghĩa nghiệp vụ | Nguồn tính toán trong Code | Nơi lưu trữ | Mục đích sử dụng |
|---|---|---|---|---|
| **A. Service Time** | Thời gian KTV thực sự xoa bóp/phục vụ khách trong phòng | `BookingItems.segments`: `workedMsOf(seg) = (endTime - startTime) - pauses` | `BookingItems.segments` (JSONB) | Hiển thị đồng hồ đếm ngược, tính phút hưởng lương |
| **B. Attendance Time** | Thời gian KTV có mặt tại spa trong ngày | `KTVAttendance.createdAt` (check-in) đến `actualEndTime` (check-out) | `KTVAttendance` | Điểm danh, kiểm tra vi phạm về sớm / đi trễ |
| **C. Shift Time** | Khung giờ làm việc theo quy định ca | Giờ start/end cứng của ca (ví dụ 09:00 - 17:00) | `KTVShifts.shiftType` | Phân ca, ép ca ngày lễ |
| **D. Accumulated Hours** | Tổng giờ tích lũy ròng trong tháng (chỉ có ở Type D) | $\Sigma \frac{\text{actual\_minutes}}{60} - \Sigma \text{hours\_penalty}$ | `KTVDTurnLedger` & `KTVDPenaltyLedger` | Xếp hạng thợ, quyết định quyền từ chối tua, xét KPI |
| **E. Priority / Tour Points** | Thứ tự ưu tiên nhận khách tiếp theo | Thứ tự xếp hàng vật lý trong ngày hoặc điểm thưởng ca | `TurnQueue.queue_position`, `check_in_order` | Xác định ai là người tiếp theo được Quầy gán đơn |

### Điểm chặn trần giờ làm (Duration Inflation Cap)
Tại `lib/services/KtvDLedgerEngine.ts` (L236–242) và `KtvCommissionService.ts`, hệ thống có quy tắc:
- `actual_minutes` (dùng để tính giờ tích lũy) bị chặn trần: `Math.min(thực_tế, gán)`.
- Lý do trong code: Ngày 02/09/2026 từng xảy ra lỗi KTV quên bấm kết thúc dịch vụ, dẫn tới đơn vị chạy tới 1,441 phút (= 24 giờ). Do hệ thống xếp thứ tự ưu tiên nhận khách theo `net_hours DESC`, KTV đó đã đứng đầu hàng ưu tiên nhận khách suốt cả tháng. Vì vậy code buộc phải chặn trần giờ thực tế không được vượt quá giờ gán của dịch vụ.

---

## 12. Quy chế Phạt / Penalty / Deduction

Toàn bộ các quy tắc kỷ luật, giảm trừ tiền và giảm trừ giờ được tổng hợp như sau:

| Tên vi phạm | Đối tượng | Hình thức chế tài | Mức phạt | Nơi định nghĩa & Quản lý |
|---|---|---|---|---|
| **Nghỉ đột xuất đầu ca / Về sớm** | Type A, B | Trừ tiền ví | 500,000 VNĐ | `SystemConfigs.ktv_sudden_off_penalty` |
| **Nghỉ không báo trước (`ABSENT_NO_NOTICE`)** | Type D | Trừ giờ tích lũy | Trừ 10 giờ | `SystemConfigs.ktv_type_d_discipline_rules` -> `CASES.ABSENT_NO_NOTICE.hours = 10` |
| **Báo vắng muộn (`ABSENT_EARLY_NOTICE`)** | Type D | Trừ giờ tích lũy | Trừ 5 giờ | `SystemConfigs.ktv_type_d_discipline_rules` -> `CASES.ABSENT_EARLY_NOTICE.hours = 5` |
| **Đến trễ không cập nhật (`LATE_NO_UPDATE`)** | Type D | Trừ giờ tích lũy | Trừ 5 giờ | `SystemConfigs.ktv_type_d_discipline_rules` -> `CASES.LATE_NO_UPDATE.hours = 5` |
| **Từ chối đơn đã gán (`ORDER_REJECT`)** | Type D | Trừ giờ tích lũy | 3 × Thời lượng dịch vụ (ví dụ gói 60p trừ 3h) | `staff.constants.ts`: `ORDER_REJECT_MULTIPLIER = 3` |
| **Khách chấm dưới 4 sao** | Type D | Trừ % tiền tua | 1★: -75%, 2★: -50%, 3★: -25% | `SystemConfigs.ktv_type_d_discipline_rules.ratingDeductions` |
| **Đổi người giữa chừng (do lỗi KTV)** | Mọi Type | Mất tua hoặc phạt | Xóa TurnLedger hoặc set `is_punished = true` | `BookingItemPauseService.swapKtvOnPausedItem` |
| **Phí giặt ủi đồ hàng ngày** | Type có cờ | Trừ tiền ví | 20,000 VNĐ / ngày | `SystemConfigs.laundry_fee` |

*Cơ chế khóa tài khoản Type D*:
Trong `KtvTypeDDisciplineService.ts`, quy chế có 4 mức xử lý: `NONE`, `DEDUCT`, `LOCK`, `DEDUCT_OR_LOCK`. Nếu quỹ giờ ròng không đủ để trừ phạt, hệ thống chuyển sang chế tài `pending_lock` (chờ hoàn thành xong các đơn đang dở rồi mới khóa tài khoản KTV).

---

## 13. Database Schema (Các bảng cốt lõi)

```
┌────────────────────────┐         ┌────────────────────────┐
│         Staff          │         │         Users          │
├────────────────────────┤         ├────────────────────────┤
│ id (PK, e.g. NH016)    │◄───────►│ id (UUID / PK)         │
│ work_type (A/B/C/D)    │         │ code (FK -> Staff.id)  │
│ feature_flags (JSONB)  │         │ role (TECHNICIAN...)   │
│ online_status          │         │ isOnShift (boolean)    │
│ travel_minutes         │         └────────────────────────┘
│ available_from/until   │
└───────────┬────────────┘
            │
            ├──────────────────────────────────────────┐
            ▼                                          ▼
┌────────────────────────┐                 ┌────────────────────────┐
│       TurnQueue        │                 │       KTVShifts        │
├────────────────────────┤                 ├────────────────────────┤
│ id (UUID, PK)          │                 │ id (UUID, PK)          │
│ employee_id (FK)       │                 │ employeeId (FK->Users) │
│ date (Date)            │                 │ shiftType (SHIFT_1...) │
│ queue_position (int)   │                 │ effectiveFrom (Date)   │
│ status (waiting/work..)│                 │ status (ACTIVE...)     │
│ current_order_id       │                 └────────────────────────┘
└────────────────────────┘
            ▲
            │
┌───────────┴────────────┐                 ┌────────────────────────┐
│       Bookings         │1               *│      BookingItems      │
├────────────────────────┼────────────────►├────────────────────────┤
│ id (UUID / PK)         │                 │ id (UUID, PK)          │
│ billCode (e.g. 001..)  │                 │ bookingId (FK)         │
│ technicianCode         │                 │ serviceId (FK)         │
│ status (DONE/CANCEL..) │                 │ technicianCodes (text[])
│ timeStart (timestamptz)│                 │ segments (JSONB)       │
└────────────────────────┘                 │ status (DONE/PAUSED..) │
            ▲                              └───────────┬────────────┘
            │                                          │
            ├───────────────────────┐                  │
            │                       │                  │
┌───────────┴────────────┐ ┌────────┴───────────┐      │
│      TurnLedger        │ │   KTVDTurnLedger   │◄─────┘
├────────────────────────┤ ├────────────────────┤
│ id (UUID, PK)          │ │ id (UUID, PK)      │
│ date (Date)            │ │ staff_id (FK)      │
│ booking_id (FK)        │ │ booking_item_id(FK)│
│ employee_id (FK)       │ │ assigned/actual_min│
│ is_punished (bool)     │ │ gross/net/tax_amt  │
│ UNIQUE(date,book,emp)  │ │ entry_status       │
└────────────────────────┘ └────────────────────┘
```

### Chi tiết các cột quan trọng theo bảng
1. **`Staff`**:
   - `id` (text, PK): Mã KTV (ví dụ: `'NH001'`, `'EXT_AB12'`).
   - `work_type` (text): Ràng buộc `CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'))`.
   - `feature_flags` (jsonb): Lưu các cờ: `allow_on_call, laundry_deduction, sudden_leave_penalty, bonus_wallet, savings_wallet, maintenance_fee`.
   - `online_status` (text): `'OFFLINE' | 'ONLINE' | 'AT_VENUE'`.
   - `travel_minutes` (integer): Thời gian di chuyển từ nhà tới spa.
2. **`TurnLedger`**:
   - `date` (date), `booking_id` (text), `employee_id` (text).
   - `is_punished` (boolean): Đánh dấu tua bị phạt khi đổi người giữa chừng.
   - Ràng buộc: `UNIQUE (date, booking_id, employee_id)`.
3. **`KTVDTurnLedger`**:
   - Khóa duy nhất: `UNIQUE (staff_id, booking_item_id)`.
   - Lưu trữ chi tiết: `assigned_minutes, actual_minutes, paid_minutes, gross_amount, net_amount, tax_amount, bonus_amount, rating_used, entry_status (OPEN, FINAL, LOCKED, VOID)`.
4. **`WalletAdjustments`**:
   - `staff_id` (text), `amount` (numeric), `type` (`'PENALTY' | 'BONUS' | 'TIP' | 'DEPOSIT'`), `wallet_type` (`'TUA' | 'BONUS'`), `work_type_snapshot` (text).
   - **Thiếu sót**: Không có `idempotency_key`, không có khóa ngoại tới Booking.

---

## 14. Admin UI & Khả năng cấu hình (Admin Configurability)

Tại trang Cài đặt Hệ thống (`app/admin/settings/system/page.tsx`), Admin có giao diện chỉnh sửa được chia thành 4 tab (`TYPE_A`, `TYPE_B`, `TYPE_C`, `TYPE_D`):

| Hạng mục cấu hình | Admin chỉnh được trên UI? | Tên Key trong `SystemConfigs` | Cần Dev / Deploy code? |
|---|---|---|---|
| **Bảng mốc hoa hồng phút** | CÓ | `ktv_commission_milestones_TYPE_X` | Không cần deploy |
| **Đơn giá dự phòng 60 phút** | CÓ | `ktv_commission_per_60min_TYPE_X` | Không cần deploy |
| **Mức phạt nghỉ đột xuất** | CÓ | `ktv_sudden_off_penalty_TYPE_X` | Không cần deploy |
| **Phí giặt ủi đồ** | CÓ | `laundry_fee` | Không cần deploy |
| **Công tắc Bật/Tắt Ví Tua** | CÓ | `ktv_wallet_tua_enabled_TYPE_X` | Không cần deploy |
| **Công tắc Bật/Tắt Ví Bonus** | CÓ | `ktv_wallet_bonus_enabled_TYPE_X` | Không cần deploy |
| **Mức phạt vi phạm Type D** | CÓ | `ktv_type_d_discipline_rules` | Không cần deploy |
| **Đổi loại KTV (A -> B -> D)** | CÓ (ở trang Nhân viên) | `Staff.work_type` | Không cần deploy |
| **Thêm một Work Type mới (Type E)** | **KHÔNG** | N/A | **CẦN SỬA CODE & MIGRATION DB** |
| **Đổi giờ bắt đầu/kết thúc các Ca 1, 2, 3** | **KHÔNG** | N/A (Hard-coded trong TS) | **CẦN DEPLOY CODE** |
| **Đổi tiền tố phân loại VIP (NHP/NHT)** | **KHÔNG** | N/A (Hard-coded trong SQL & TS) | **CẦN SỬA CODE & CHẠY SQL** |
| **Thuế suất TNCN (10%)** | **BÁN PHẦN** | Nằm trong code Engine Type D | Cần cấu hình DB |

---

## 15. Danh mục các Business Rules đang bị Hard-code (Top Hard-coded Rules)

Đây là các rào cản kỹ thuật lớn nhất khiến hệ thống **không thể mở rộng động** nếu không tái cấu trúc:

### 1. Phân loại dịch vụ VIP theo tiền tố chuỗi ID
- **Vị trí**: 
  - `lib/services/KtvCommissionService.ts`: L239 (`sId.startsWith('NHP') || sId.startsWith('NHT')`)
  - `migrations/20260801160000_...sql`: L151 (`v_item.service_id LIKE 'NHP%' OR v_item.service_id LIKE 'NHT%'`)
  - `lib/services/KtvDLedgerEngine.ts`: L30 (`VIP_PREFIXES = ['NHP', 'NHT', 'VIP']`)
- **Hạn chế**: Nếu spa tạo một dịch vụ VIP mới với mã khác (ví dụ: `SPA_VIP_01`), hệ thống sẽ coi là dịch vụ thường và KTV Loại B/D sẽ bị tụt lương.

### 2. Định nghĩa Ca làm việc gắn cứng trong mã nguồn
- **Vị trí**: `app/api/ktv/shift/route.ts`: L8–15 (`SHIFT_TYPES = { SHIFT_1: { start: '09:00', end: '17:00' }... }`)
- **Hạn chế**: Quản lý không thể đổi giờ ca làm của tiệm (ví dụ mùa đông mở cửa từ 10:00) từ Admin UI mà phải nhờ lập trình viên sửa code và deploy.

### 3. Tự động duyệt điểm danh (Auto-approve Attendance)
- **Vị trí**: `app/api/ktv/attendance/route.ts`: L213 (`const isAutoApprove = true;`)
- **Hạn chế**: Luôn luôn tự động phê duyệt mọi yêu cầu điểm danh, xin đi trễ, nghỉ đột xuất mà không qua quản lý duyệt.

### 4. Giả định "KTV Loại B không có ca"
- **Vị trí**: `app/api/ktv/shift/route.ts`: L108-110 & L147
- **Hạn chế**: Lọc bỏ hoàn toàn Type B khỏi hệ thống phân ca. Không thể thiết lập mô hình "KTV hợp tác nhưng đăng ký trực cố định một số ca trong tuần".

### 5. Sinh mã KTV vãng lai tự động với tiền tố `EXT_`
- **Vị trí**: `app/reception/dispatch/actions.ts`: L543 (`const newId = 'EXT_' + Math.random()...`)
- **Hạn chế**: Gắn chặt việc phân biệt thợ cơ hữu và thợ ngoài bằng tiền tố chuỗi tên mã `EXT_` hoặc `C_`.

### 6. Ràng buộc cứng WorkType trong Database
- **Vị trí**: `supabase/migrations/20260901000000_add_type_d_support.sql`
- **Hạn chế**: Ràng buộc `CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'))`. Bất kỳ nỗ lực nào nhằm thêm Type E hoặc cấu hình động từ database sẽ bị Postgres từ chối với lỗi Check Constraint Violation.

---

## 16. Bản đồ Phụ thuộc / Coupling Graph

```
                   ┌────────────────────────────────────────┐
                   │            Staff.work_type             │
                   └───────────────────┬────────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         │                             │                             │
         ▼                             ▼                             ▼
┌───────────────────┐        ┌───────────────────┐        ┌───────────────────┐
│  Attendance API   │        │     Shift API     │        │   Dispatch Flow   │
├───────────────────┤        ├───────────────────┤        ├───────────────────┤
│ Type B:           │        │ Type B:           │        │ Type C:           │
│  Bỏ qua TurnQueue │        │  Bị lọc bỏ        │        │  Miễn điểm danh   │
│  Gọi OnlineService│        │  Không hiển thị ca│        │ Type A/D:         │
│ Type A/D:         │        │ Type A/D:         │        │  Bắt buộc có mặt  │
│  Ép vào TurnQueue │        │  Bắt buộc có ca   │        │  trong TurnQueue  │
│  Khấu trừ đồ/phạt │        │  Auto-revert ca   │        │                   │
└────────┬──────────┘        └───────────────────┘        └─────────┬─────────┘
         │                                                          │
         │                                                          ▼
         │                                                ┌───────────────────┐
         │                                                │    TurnLedger     │
         │                                                ├───────────────────┤
         │                                                │ 1 Bill x 1 KTV    │
         │                                                │ = 1 Lượt tua      │
         │                                                └─────────┬─────────┘
         │                                                          │
         ▼                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Tour Pay & Wallet Calculation                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ Type A:                                                                     │
│  -> Đọc SystemConfigs.ktv_commission_milestones                             │
│  -> Đơn giá cơ sở 100k/h                                                    │
│ Type B:                                                                     │
│  -> Kiểm tra tiền tố mã dịch vụ:                                            │
│       IF NHP% OR NHT% -> Đơn giá VIP (180k/h & milestones_TYPE_B)           │
│       ELSE            -> Bị ép về giá Type A (100k/h)                       │
│ Type D:                                                                     │
│  -> Bỏ qua hoàn toàn Milestones                                             │
│  -> Chạy KtvDLedgerEngine (Phút thực chặn trần, Trừ % theo sao, Thuế 10%)   │
│  -> Ghi sổ cái KTVDTurnLedger & KTVDPenaltyLedger                           │
│ Type C:                                                                     │
│  -> Tính hoa hồng cơ bản theo Type A, không có ví, thanh toán tiền mặt      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 17. Mô phỏng 3 Kịch bản Thực tế (End-to-End Examples)

### CASE 1: KTV Cơ hữu có ca cố định (KTV Loại A - Mã `NH016`)
1. **Login**: Đăng nhập bằng mã `NH016`. Session lưu thông tin cơ bản.
2. **Điểm danh (Check-in)**:
   - KTV tới spa, kết nối Wi-Fi (IP khớp dải `14.191.x.x`), mở camera chụp mặt.
   - Hệ thống tự động duyệt (`CONFIRMED`), cập nhật `Users.isOnShift = true`.
   - Kích hoạt `KTVShifts` (Ca 1: 09:00 - 17:00).
   - Thêm vào `TurnQueue` với `status = 'waiting'`, cấp vị trí thứ tự tua trong ngày.
   - Tự động trừ 20,000đ tiền giặt đồ vào `WalletAdjustments`.
3. **Phục vụ đơn (Service)**:
   - Quầy điều phối gán `NH016` vào dịch vụ Body Đá Nóng 60 phút (`NHS0100`).
   - `TurnQueue.status` chuyển thành `'working'`.
   - RPC `dispatch_confirm_booking` ghi 1 dòng vào `TurnLedger` cho ngày hôm nay.
   - KTV bấm bắt đầu -> `BookingItems.segments` ghi `actualStartTime`.
   - Sau 60 phút, KTV bấm kết thúc -> segment ghi `actualEndTime`. Khách đánh giá 5 sao.
4. **Tính tiền & Ví**:
   - Dịch vụ hoàn thành (`DONE`).
   - Cuối ngày cron chạy hoặc app KTV gọi `get_ktv_wallet_balance`.
   - Hệ thống tra thời lượng 60 phút vào `ktv_commission_milestones` -> Hoa hồng: **100,000 VNĐ**.
   - Không bị trừ thuế. Cộng thẳng vào Ví Tua.
5. **Tan ca (Check-out)**:
   - 17:00 KTV bấm Tan ca. Hệ thống kiểm tra không còn `Tasks` nào tồn đọng.
   - `Users.isOnShift = false`, `KTVShifts.status = 'COMPLETED'`.
   - `TurnQueue.status = 'off'`.

---

### CASE 2: KTV Hợp tác linh hoạt (KTV Loại B - Mã `NH088`)
1. **Bật nhận đơn từ xa**:
   - 10:00 sáng KTV đang ở nhà, mở app bấm "Bật nhận đơn", chọn thời gian di chuyển 20 phút.
   - `KtvOnlineService.goOnline` cập nhật `Staff.online_status = 'ONLINE'`, `travel_minutes = 20`. KTV **không** cần check-in Wi-Fi spa.
2. **Nhận đơn & Di chuyển**:
   - Quầy thấy thợ online kèm ghi chú di chuyển 20p, gán KTV vào đơn VIP Chăm sóc Da Chuyên Sâu 90 phút (`NHP0300`).
   - App KTV thông báo đơn mới. KTV di chuyển tới spa.
3. **Tới nơi & Phục vụ**:
   - KTV tới spa bấm "Đã tới tiệm".
   - `KtvOnlineService.arriveAtVenue` cập nhật `Staff.online_status = 'AT_VENUE'`, mở một ca làm việc ảo `VIP` trong `KTVShifts`.
   - KTV thực hiện dịch vụ cho khách.
4. **Tính tiền tua (Phân nhánh theo mã dịch vụ)**:
   - Dịch vụ `NHP0300` có tiền tố `NHP` (VIP) -> Hệ thống nạp bảng giá Type B. Mốc 90 phút hưởng mức giá VIP: **220,000 VNĐ** (thay vì mức 150,000đ của Type A).
   - *(Lưu ý: Nếu cùng ngày đó KTV này làm thêm 1 dịch vụ ngâm chân `NHS0500` thì do tiền tố `NHS`, hệ thống sẽ tự động ép dịch vụ này về bảng giá Type A là 50,000đ).*
5. **Tắt nhận đơn**:
   - KTV bấm tắt app về nhà. `KtvOnlineService.goOffline` đóng ca VIP, gỡ KTV khỏi danh sách điều phối.

---

### CASE 3: KTV Tự chủ / Kỷ luật nghiêm ngặt (KTV Loại D - Mã `NH099`)
1. **Lịch làm & Điểm danh**:
   - KTV Loại D đăng ký trước ngày đi làm.
   - Nếu ngày đó KTV không tới điểm danh và không báo trước: Cron quét vắng mặt kích hoạt `KtvTypeDDisciplineService.deductDailyViolation(..., 'ABSENT_NO_NOTICE')` -> **Trừ thẳng 10 giờ tích lũy** vào `KTVDPenaltyLedger`.
2. **Nhận đơn & Chặn trần thời gian**:
   - KTV được gán dịch vụ Massage Trị Liệu 60 phút (`NHT0100`).
   - KTV làm thực tế 75 phút mới bấm kết thúc.
   - `KtvDLedgerEngine` tính toán:
     - Phút được trả tiền (`paid_minutes`): Chặn trần tại phút gán -> **60 phút** (không được tính 75 phút).
     - Đơn giá VIP (`rateVIP`): 150,000 VNĐ / 60 phút -> Gross = **150,000 VNĐ**.
3. **Đánh giá Sao & Trừ tiền**:
   - Khách chấm 3 sao trên phiếu Feedback.
   - Hệ thống tra bảng phạt sao: 3 sao bị trừ 25% tiền tua.
   - Tiền Net sau trừ sao: $150,000 \times (1 - 0.25) = \mathbf{112,500\text{ VNĐ}}$.
4. **Thuế TNCN (PIT 10%)**:
   - Áp thuế 10%: $112,500 \times 0.1 = \mathbf{11,250\text{ VNĐ}}$.
   - Thực nhận ghi vào sổ cái `KTVDTurnLedger`: **101,250 VNĐ**.
5. **Cập nhật giờ ròng**:
   - Giờ làm tăng thêm: +1.0 giờ.
   - Thứ hạng nhận khách trên bảng xếp hạng tự động điều chỉnh theo tổng `net_hours`.

---

## 18. Đánh giá Mức độ Dynamic Hiện tại

| Phân hệ (Module) | Mức độ Dynamic | Lý do đánh giá chi tiết theo Code |
|---|---|---|
| **Định nghĩa Chế độ (Work Mode)** | **Hard-coded** | Bị khóa cứng bởi TypeScript Union Type (`WorkType`) và Database Check Constraint trong Postgres. Thêm một chế độ mới bắt buộc phải sửa mã nguồn và chạy migration DB. |
| **Bảng mốc hoa hồng (Milestones)** | **Dynamic** | Lưu dưới dạng JSON trong `SystemConfigs`, Admin có thể thêm/bớt mốc phút và sửa số tiền trực tiếp trên UI mà không cần sửa code. |
| **Phân loại dịch vụ hưởng giá tua** | **Hard-coded** | Dựa hoàn toàn vào kiểm tra tiền tố chuỗi (`NHP%`, `NHT%`, `VIP%` vs `NHS%`) trong cả SQL và TypeScript. Không có ma trận quan hệ giữa dịch vụ và chế độ. |
| **Quản lý Ca làm việc (Shifts)** | **Hard-coded** | Tên ca, giờ bắt đầu và giờ kết thúc được gán cứng trong hằng số `SHIFT_TYPES` của route handler. Admin không thể đổi giờ ca trên giao diện. |
| **Quy định Chấm công (Attendance Rules)** | **Partial** | Dải IP Wi-Fi và cờ chặn tan ca khi còn việc được cấu hình trong `SystemConfigs`. Tuy nhiên, điều kiện tự động duyệt (`isAutoApprove = true`) bị hard-code. |
| **Bật/Tắt Ví & Tính năng (Feature Flags)** | **Dynamic** | Hệ thống cờ 2 cấp (Cấp Work Type trong `SystemConfigs` và Cấp cá nhân trong `Staff.feature_flags`) cho phép bật/tắt động rất tốt qua `WalletAccessService`. |
| **Quy chế kỷ luật & Trừ giờ Type D** | **Partial** | Mức phạt giờ và trừ % theo sao lưu trong JSON `SystemConfigs.ktv_type_d_discipline_rules`. Tuy nhiên các case vi phạm (`ABSENT_NO_NOTICE`...) là enum cứng. |
| **Điều phối KTV vãng lai (Type C)** | **Hard-coded** | Quy ước tiền tố `EXT_` và cơ chế tự động tạo nhân viên khi gõ tên mới được viết cứng trong Server Action. |

---

## 19. Những thứ Chưa xác định (Uncertain / Needs Verification)

Các điểm kỹ thuật cần kiểm tra thêm trên môi trường Production thực tế:

1. **Khả năng xung đột Lock khi nhiều KTV cùng bấm nhận đơn**: Trong `app/reception/dispatch/actions.ts`, hàm `processDispatch` gọi RPC `dispatch_confirm_booking` có lock bảng `TurnQueue` ở mức nào (Row-level lock `FOR UPDATE` hay Table lock) cần kiểm tra chi tiết mã nguồn hàm RPC trong Supabase để đánh giá khả năng chịu tải khi đông khách.
2. **Dữ liệu mồ côi của KTV Type C**: Do hệ thống tự động sinh `EXT_xxxxx` mỗi khi quầy gõ một tên mới không khớp, cần kiểm tra xem trên DB thực tế có hàng trăm bản ghi KTV rác do gõ sai chính tả hay không.
3. **Mức độ phụ thuộc vào cron `ktvd-recompute`**: File `vercel.json` có cron chạy mỗi 5 phút (`*/5 * * * *`) để recompute dữ liệu Loại D nhưng Vercel Hobby plan từ chối cron dưới 1 ngày. Cần xác minh xem trên production khách hàng đang dùng gói Vercel Pro hay worker này đang bị ngừng chạy.

---

## 20. Danh mục Tham chiếu Mã nguồn Quan trọng (Important Code References)

Dưới đây là các file đầu não chịu trách nhiệm toàn bộ logic KTV hiện tại:

* **`lib/services/KtvCommissionService.ts`**
  * `getCommissionConfig()`: Phân giải mốc hoa hồng, fallback đơn giá, cờ thưởng từ `SystemConfigs` theo từng `work_type`.
  * `calcCommission()`: Quyết định số tiền tua dựa trên phút, ép giá Type B về Type A nếu không khớp tiền tố NHP/NHT.
  * `calculateItemDuration()`: Trích xuất thời gian làm thực tế từ `segments` để chống gian lận giờ.

* **`lib/services/KtvDLedgerEngine.ts`**
  * `computeRows()`: Hàm thuần túy dựng toàn bộ dòng sổ cái cho KTV Loại D từ Bookings và Config.
  * `computeMinutes()`: Tính toán độc lập `paid_minutes` (tính tiền) và `actual_minutes` (tính giờ), thực hiện chặn trần thời gian.
  * `applyBonusAndTax()`: Tính thưởng 4 sao theo khách và áp thuế TNCN 10%.

* **`lib/services/BookingItemPauseService.ts`**
  * `swapKtvOnPausedItem()`: Nghiệp vụ đổi KTV giữa chừng, phạt KTV cũ, thưởng full giờ cho KTV mới, can thiệp `TurnLedger`.
  * `pauseItem()` / `resumeItem()`: Tạm dừng dịch vụ và tịnh tiến mốc giờ.

* **`app/reception/dispatch/actions.ts`**
  * `processDispatch()`: Tiếp nhận điều phối từ quầy, tự động tạo KTV Type C, kiểm tra điểm danh KTV cơ hữu, gọi RPC transaction.
  * `cancelBooking()`: Hủy đơn, phân biệt hủy trước khi làm (xóa TurnLedger) và hủy khi đang làm (giữ TurnLedger).

* **`app/api/ktv/attendance/route.ts`**
  * `POST()`: Xử lý toàn bộ luồng điểm danh, kiểm tra IP Wi-Fi, tự duyệt, rẽ nhánh giữa Type B (Online Service) và Type A (TurnQueue/Shifts), tự động trừ phí giặt đồ và phạt nghỉ đột xuất.

* **`app/api/ktv/shift/route.ts`**
  * `GET()`: Quản lý ca làm việc, lọc bỏ Type B, đè ca ngày lễ (`holiday_shift2_dates`), tự động hoàn ca tạm sau điểm danh.

* **`lib/services/KtvOnlineService.ts`**
  * `goOnline()` / `arriveAtVenue()` / `goOffline()`: Quản lý vòng đời trực tuyến và thời gian di chuyển của KTV hợp tác từ xa.

* **`lib/services/WalletAccessService.ts`**
  * `getAccess()` / `denyIfDisabled()`: Cổng kiểm soát truy cập ví 2 cấp ở tầng server.

* **`lib/services/KtvTypeDDisciplineService.ts`**
  * `deductDailyViolation()`: Xử lý trừ giờ vi phạm vắng mặt / đi trễ.
  * `deductOrderReject()`: Xử lý phạt từ chối tua theo hệ số nhân.

---

# DATA NEEDED FOR FUTURE DYNAMIC POLICY DESIGN

Để một AI hoặc Kiến trúc sư Hệ thống (System Architect) có thể thiết kế lại toàn bộ phân hệ KTV theo hướng **Dynamic / Data-Driven / Policy-Based**, dưới đây là bản đặc tả các cấu trúc dữ liệu bắt buộc phải được mô hình hóa:

### 1. Work Policy Model (Mô hình Định danh Chế độ)
Thay vì hard-code `TYPE_A, TYPE_B, TYPE_C, TYPE_D`, cần một bảng `WorkPolicies`:
- `id`: string (slug, ví dụ: `'fulltime_core'`, `'partner_oncall'`, `'freelance'`, `'autonomous'`).
- `name`: string (nhãn hiển thị).
- `attendance_required`: boolean (có bắt buộc điểm danh Wi-Fi hay không).
- `scheduling_mode`: enum (`FIXED_SHIFT`, `FLEXIBLE`, `NONE`).
- `dispatch_queue_type`: enum (`PHYSICAL_FIFO`, `RANKING_PRIORITY`, `MANUAL_ONLY`).
- `compensation_scheme_id`: FK tới chính sách tính lương.
- `tax_scheme_id`: FK tới chính sách thuế.

### 2. Service × Pay Mode Matrix (Ma trận Tiền tua theo Dịch vụ)
Chấm dứt hoàn toàn việc kiểm tra tiền tố `NHP/NHT`. Cần bảng ma trận:
- `service_id`: FK tới `Services`.
- `policy_id`: FK tới `WorkPolicies`.
- `calculation_type`: enum (`MILESTONE_MAP`, `HOURLY_RATE`, `FIXED_AMOUNT`, `PERCENTAGE_OF_PRICE`).
- `rate_value`: numeric (ví dụ 180,000đ hoặc 40%).
- `milestones_json`: jsonb (nếu tính theo mốc phút).
- `effective_from` / `effective_to`: Quản lý phiên bản giá theo thời gian (Versioning).

### 3. Policy Versioning & Snapshotting (Bảo vệ Lịch sử Tài chính)
- Mọi giao dịch ghi vào Ledger (`TurnLedger`, `WalletTransactions`) **bắt buộc phải snapshot toàn bộ công thức và số tiền tại thời điểm phát sinh**:
  - `applied_rate`: Đơn giá đã áp dụng.
  - `gross_amount`, `deduction_amount`, `tax_amount`, `net_amount`.
- Số dư ví của KTV phải là **tổng tích lũy các giao dịch bất biến (Immutable Event Sourcing)**, tuyệt đối không được tính lại từ đầu bằng cách đọc cấu hình hiện tại của hệ thống.

### 4. Unified Time Domain Model (Mô hình Hóa Thời gian Đồng nhất)
Tách bạch 4 miền thời gian độc lập trong database:
1. `ScheduleSlot`: Ca được phân công trước.
2. `AttendanceInterval`: Khoảng thời gian thực tế bấm vào/ra spa.
3. `AvailabilityWindow`: Khoảng thời gian KTV đăng ký sẵn sàng nhận việc.
4. `ServiceSegment`: Chặng thời gian thực tế chạm vào khách, gồm `start_time, end_time, paused_duration`.

---
*Báo cáo được khởi tạo tự động từ việc kiểm toán mã nguồn chi tiết tại repo `CTY TechGalaxy Group/Quan_Tri_Va_KTV`.*
