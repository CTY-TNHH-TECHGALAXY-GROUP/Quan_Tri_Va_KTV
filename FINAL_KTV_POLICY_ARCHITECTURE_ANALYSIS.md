# FINAL KTV POLICY & SYSTEM ARCHITECTURE AUDIT REPORT
### Báo cáo Toàn diện Kiến trúc Hệ thống: Mục 1 Đến Mục 42

> **Dự án:** Quản Trị & KTV (TechGalaxy Group / Ngân Hà Spa)  
> **Thời điểm hoàn thành:** 16/09/2026  
> **Phạm vi kiểm toán:** Toàn bộ codebase (Front-end Next.js 15, React 19, API Routes, Server Actions, Supabase Migrations, PostgreSQL Functions/Triggers, RLS, Configs, Cron Workers).  
> **Mục tiêu:** Cung cấp tài liệu kỹ thuật trung thực, chi tiết với đầy đủ trích dẫn mã nguồn để phục vụ việc thiết kế lại hệ thống theo mô hình Dynamic / Config-Driven / Policy-Based.  
> **Nguyên tắc:** Trích xuất thực tế từ code, không suy đoán, không refactor, chỉ rõ File, Line, Function, Table, Column, API, Logic.

---

## MỤC LỤC TỔNG QUAN

### PHẦN I: CHẾ ĐỘ KTV, ĐIỀU PHỐI, CHẤM CÔNG & TIỀN TUA (MỤC 1 – 20)
1. [Executive Summary](#1-executive-summary)
2. [Current Architecture](#2-current-architecture)
3. [Staff / Work Modes](#3-staff--work-modes)
4. [Attendance (Chấm công)](#4-attendance-chấm-công)
5. [Scheduling (Ca làm việc)](#5-scheduling-ca-làm-việc)
6. [Availability (Bật/Tắt nhận đơn)](#6-availability-bậttắt-nhận-đơn)
7. [Service Assignment (Gán dịch vụ & Đổi thợ)](#7-service-assignment-gán-dịch-vụ--đổi-thợ)
8. [Tour Pay (Tiền tua & Hoa hồng)](#8-tour-pay-tiền-tua--hoa-hồng)
9. [Menu / Service Pricing & Tour Rate](#9-menu--service-pricing--tour-rate)
10. [Wallet / Gross / Tax / Net](#10-wallet--gross--tax--net)
11. [Accumulated Hours / Priority / Tua](#11-accumulated-hours--priority--tua)
12. [Penalties / Deductions / Rules](#12-penalties--deductions--rules)
13. [Database Schema (Bảng cốt lõi)](#13-database-schema-bảng-cốt-lõi)
14. [Admin Configurability](#14-admin-configurability)
15. [Top Hard-coded Business Rules](#15-top-hard-coded-business-rules)
16. [Dependency / Coupling Map](#16-dependency--coupling-map)
17. [End-to-End Examples (3 Ca thực tế)](#17-end-to-end-examples-3-ca-thực-tế)
18. [Dynamic Readiness Assessment](#18-dynamic-readiness-assessment)
19. [Uncertain Areas (Điểm cần xác minh)](#19-uncertain-areas-điểm-cần-xác-minh)
20. [Important Code References (Mục 1-20)](#20-important-code-references-mục-1-20)

### PHẦN II: BẢO MẬT, VÒNG ĐỜI, TÍNH TOÀN VẸN & RỦI RO KỸ THUẬT (MỤC 21 – 42)
21. [Role / Permission / Authorization](#21-role--permission--authorization)
22. [Policy / Config Lifecycle](#22-policy--config-lifecycle)
23. [Default / Fallback Behavior](#23-default--fallback-behavior)
24. [Rule Priority / Conflict Resolution](#24-rule-priority--conflict-resolution)
25. [Service / Menu Versioning](#25-service--menu-versioning)
26. [Order / Service Status State Machine](#26-order--service-status-state-machine)
27. [Event / Trigger Architecture](#27-event--trigger-architecture)
28. [Idempotency / Double Calculation](#28-idempotency--double-calculation)
29. [Transaction / Atomicity](#29-transaction--atomicity)
30. [Audit Log / Change History](#30-audit-log--change-history)
31. [Manual Override](#31-manual-override)
32. [Historical Data Integrity](#32-historical-data-integrity)
33. [Frontend Config Coupling](#33-frontend-config-coupling)
34. [Duplicated Business Logic](#34-duplicated-business-logic)
35. [Database Constraints](#35-database-constraints)
36. [Supabase-Specific Implementation](#36-supabase-specific-implementation)
37. [Test Coverage](#37-test-coverage)
38. [Current Data Volume / Migration Impact](#38-current-data-volume--migration-impact)
39. [External Dependencies](#39-external-dependencies)
40. [Business Terminology Map](#40-business-terminology-map)
41. [Architecture Risks Before Dynamic Policy Refactor](#41-architecture-risks-before-dynamic-policy-refactor)
42. [Business Questions Requiring Owner Decision](#42-business-questions-requiring-owner-decision)

### PHẦN III: ĐẶC TẢ DỮ LIỆU CHO THIẾT KẾ HỆ THỐNG MỚI
* [DATA NEEDED FOR FUTURE DYNAMIC POLICY DESIGN](#data-needed-for-future-dynamic-policy-design)

---

# PHẦN I: CHẾ ĐỘ KTV, ĐIỀU PHỐI, CHẤM CÔNG & TIỀN TUA (MỤC 1 – 20)

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
- **File định nghĩa Type**: `lib/types/staff.types.ts` (Line 1: `export type WorkType = 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';`).
- **File nhãn hiển thị**: `lib/constants/staff.constants.ts` (Lines 6–11: `WORK_TYPE_LABELS = { TYPE_A: 'Cơ bản', TYPE_B: 'Hợp tác', TYPE_C: 'Nhập tay', TYPE_D: 'D' }`).
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

---

## 3. Staff / Work Modes

Bảng kiểm toán toàn diện 18 vị trí phân nhánh logic theo `work_type` trong codebase:

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

## 4. Attendance (Chấm công)

### 4.1. Trace toàn bộ luồng điểm danh
Điểm danh được thực hiện từ Client UI (`app/ktv/attendance/page.tsx` và `Attendance.logic.ts`) gửi request POST tới `app/api/ktv/attendance/route.ts`.
1. **Kiểm tra Wi-Fi IP**: So khớp 2 octet đầu client IP với `SystemConfigs.spa_wifi_ips` (ví dụ `14.191.x.x`). Nếu sai, từ chối HTTP 403, ghi nhận log `INVALID_WIFI_IP` vào `SecurityAuditLogs` và `SystemConfigs.spa_wifi_last_rejected_ip`.
2. **Kiểm tra việc chưa nghiệm thu**: Nếu là `CHECK_OUT`, kiểm tra `Tasks` có `inspection_status != 'PASSED'` (nếu có cờ `block_checkout_incomplete_tasks_${work_type}`).
3. **Upload ảnh**: Tải ảnh Base64 lên bucket `attendance` của Supabase Storage.
4. **Tự động duyệt**: Gán cứng `const isAutoApprove = true;` (L213), ghi bản ghi `KTVAttendance` với `status = 'CONFIRMED'`.
5. **Rẽ nhánh Chế độ**:
   - **Type B**: `CHECK_IN` gọi `KtvOnlineService.arriveAtVenue` (set `online_status = 'AT_VENUE'`, mở ca `VIP`). `CHECK_OUT` gọi `KtvOnlineService.goOffline` (set `online_status = 'OFFLINE'`, đóng ca).
   - **Type A / D**: `CHECK_IN` set `Users.isOnShift = true`, mở/cập nhật `KTVShifts`, đẩy vào `TurnQueue` (`status = 'waiting'`). `CHECK_OUT` set `isOnShift = false`, đóng `KTVShifts` (`status = 'COMPLETED'`), chuyển `TurnQueue.status = 'off'`.
6. **Khấu trừ tự động**:
   - Tiền giặt đồ: Trừ 20,000đ trong `WalletAdjustments` (1 lần/ngày).
   - Phạt nghỉ đột xuất: Type D trừ 10 giờ trong `KTVDPenaltyLedger`; Type khác trừ 500,000đ trong `WalletAdjustments`.

### 4.2. Trả lời 5 câu hỏi trọng tâm
1. **Điều kiện cho phép check-in:** Kết nối đúng IP Wi-Fi (2 octet đầu), có ảnh chụp khuôn mặt. Tọa độ GPS chỉ lưu log tạo link map, không chặn bán kính.
2. **Điều kiện bắt buộc check-in:** KTV cơ hữu (Type A/D) bắt buộc phải check-in để có mặt trong `TurnQueue`, nếu không Quầy không thể gán đơn.
3. **Loại không cần check-in:** Type C (nhập tay `EXT_`) được miễn kiểm tra điểm danh khi điều phối. Type B nhận đơn on-call từ xa cũng không cần điểm danh Wi-Fi.
4. **Mối quan hệ với các nghiệp vụ:** Check-in quyết định quyền được gán đơn qua `TurnQueue`, nhưng **tiền tua không phụ thuộc trực tiếp vào check-in** mà tính theo `BookingItems.segments`.
5. **Trường hợp check-out bị chặn:** Còn công việc trong ngày chưa được nghiệm thu (`Tasks.inspection_status != 'PASSED'`) hoặc chưa tới giờ kết thúc ca (trừ khi có bật `allow_early_checkout`).

---

## 5. Scheduling (Ca làm việc)

- **Bảng lưu trữ**: `public.KTVShifts` (Columns: `id, employeeId, shiftType, effectiveFrom, previousShift, reason, status, estimatedEndTime, actualEndTime`).
- **Các loại ca (Hard-coded trong `app/api/ktv/shift/route.ts`: L7-16)**:
  - `SHIFT_1` (09:00 - 17:00), `SHIFT_2` (11:00 - 19:00), `SHIFT_3` (17:00 - 00:00), `DEV_SHIFT` (09:00 - 21:00), `FREE`, `REQUEST`, `SUPPORT`, `VIP` (đều 00:00 - 23:59).
- **Có bắt buộc mọi KTV phải có ca không?**
  - **Không**. Hệ thống chủ động lọc bỏ KTV Type B khỏi danh sách quản lý ca (`app/api/ktv/shift/route.ts`: L108-110 & L147). Type C cũng hoàn toàn không có ca.
- **Đè ca ngày lễ (`holiday_shift2_dates`)**: Đọc mảng ngày từ `SystemConfigs.holiday_shift2_dates`. Nếu trùng ngày lễ, hệ thống đè toàn bộ ca của tất cả KTV thành `SHIFT_2`.
- **Tự động hoàn ca tạm**: Khi KTV chọn ca tạm lúc điểm danh, sang ngày mới hệ thống tự động hoàn về ca gốc và cập nhật trạng thái ca tạm thành `REPLACED`.

---

## 6. Availability (Bật/Tắt nhận đơn)

- **Luồng nhận đơn on-call (`KtvOnlineService.ts`)**:
  - Dành cho KTV Type B hoặc KTV có cờ `allow_on_call = true`.
  - KTV tại nhà bật "Bật nhận đơn" -> chọn thời gian di chuyển (5 - 60 phút) -> API ghi nhận `Staff.online_status = 'ONLINE'`, `travel_minutes = travelMinutes`.
  - Quầy điều phối thấy KTV online kèm ETA di chuyển -> gán đơn.
  - KTV tới spa bấm "Đã tới tiệm" -> `online_status = 'AT_VENUE'`, mở ca ảo `VIP` trong `KTVShifts`, nạp vào `TurnQueue`.
- **Điều kiện**: Không cần điểm danh Wi-Fi để bật online từ xa. Type A mặc định bị cấm bật online từ xa (`isAllowed = staff.work_type === 'TYPE_B' || staff.feature_flags?.allow_on_call`).

---

## 7. Service Assignment (Gán dịch vụ & Đổi thợ)

- **Order level vs Service level**:
  - Bảng `Bookings` lưu thông tin đơn cha (`technicianCode`).
  - Bảng `BookingItems` lưu từng dịch vụ (`technicianCodes: text[]`, `segments: jsonb`).
  - Một đơn có thể có nhiều dịch vụ, mỗi dịch vụ có KTV riêng hoặc nhiều KTV (làm 4 tay).
- **Nghiệp vụ đổi thợ giữa chừng (`BookingItemPauseService.ts`)**:
  - Tạm dừng dịch vụ (`pauseItem`), tiếp tục (`resumeItem`).
  - Đổi thợ (`swapKtvOnPausedItem`):
    - **KTV cũ**: Nếu `keepTurnForOldKtv === true` thì giữ tua và set `TurnLedger.is_punished = true`; nếu không thì xóa hẳn bản ghi khỏi `TurnLedger`. Chốt `endTime = pauseTime` trên segment cũ.
    - **KTV mới**: Nhận `customCommissionDuration = originalDuration + extraTimeMins` (hưởng full lương gốc + giờ bù), cấp lượt tua mới trong `TurnLedger`, thêm segment mới ghi chú `'Vào cứu bộ'`.
- **Hủy đơn (`cancelBooking` trong `app/reception/dispatch/actions.ts`: L1134)**:
  - Nếu hủy trước khi làm (`turn.status` là `assigned`, `ready`, `waiting`): Xóa bản ghi `TurnLedger` để hoàn lượt.
  - Nếu hủy khi đang làm (`working`): Giữ nguyên bản ghi `TurnLedger` để KTV vẫn nhận tua và tiền.

---

## 8. Tour Pay (Tiền tua & Hoa hồng)

> **KẾT QUẢ AUDIT: Hệ thống tính tiền theo số phút dịch vụ, CHƯA CÓ ma trận `SERVICE × KTV_MODE -> RATE`.**

### 8.1. Bảng mốc hoa hồng mặc định (`ktv_commission_milestones`)
`{"1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000}`.

### 8.2. Logic phân nhánh Type A vs Type B (Code thực tế)
- **Trong TypeScript (`lib/services/KtvCommissionService.ts`: L237–244)**:
  ```typescript
  if (workType === 'TYPE_B') {
      const sId = String(serviceId || '').toUpperCase();
      const isPremiumService = sId.startsWith('NHP') || sId.startsWith('NHT');
      if (!isPremiumService) {
          // Nếu không phải VIP (NHP/NHT), KTV Loại B bị rơi về bảng giá Loại A!
          activeConfig = commConfigs['TYPE_A'];
      }
  }
  ```
- **Trong SQL RPC (`migrations/20260801160000_fix_type_b_nhs_commission.sql`: L150–155)**:
  ```sql
  IF v_work_type = 'TYPE_B' THEN
      IF v_item.service_id LIKE 'NHP%' OR v_item.service_id LIKE 'NHT%' THEN
          v_active_milestones := v_milestones_type;
          v_active_rate := v_rate_60_type;
      END IF;
  END IF;
  ```

### 8.3. Tiền tua của KTV Loại D (`lib/services/KtvDLedgerEngine.ts`)
- Không dùng milestones. Tính theo phút thực tế chặn trần: `gross = paid_minutes * (rate / 60)`.
- Đơn giá: `configs.rateVIP` (150k/h) cho prefix `NHP, NHT, VIP`; `configs.ratePT` (100k/h) cho prefix khác.
- Khấu trừ sao đánh giá của khách (1★: -75%, 2★: -50%, 3★: -25%, 4★: không trừ).

---

## 9. Menu / Service Pricing & Tour Rate

- Bảng `Services` gồm: `id, code, nameVN, priceVND, priceUSD, duration, is_utility, category`.
- Không có cột `ktv_amount`, `commission_rate`, `tour_rate`.
- Cờ `is_utility = true` (phòng riêng, nước ngọt) được dùng để loại trừ dịch vụ không sinh tiền tua và không tính giờ.
- Không có cơ chế versioning cho bảng giá dịch vụ.

---

## 10. Wallet / Gross / Tax / Net

- Quản lý 2 ví: `TUA` (Ví Tua) và `BONUS` (Ví Bonus).
- **Thuế TNCN (PIT 10%)**:
  - Type A, B, C: Hoàn toàn không tính thuế. Gross = Net.
  - Type D: Tính thuế 10% trên `(commission_net + bonus_amount)` nếu ngày làm `>= configs.taxEffectiveFrom`. Giá trị thuế không làm tròn khi lưu sổ cái.
- **Tính bất biến (Immutability Risk)**: RPC `get_ktv_wallet_balance` tính lại số dư từ `2026-05-04` bằng cách nạp mốc giá hiện tại từ `SystemConfigs`. Đổi giá hôm nay sẽ làm thay đổi toàn bộ số dư quá khứ của KTV.

---

## 11. Accumulated Hours / Priority / Tua

Hệ thống phân định 5 khái niệm định lượng công việc:
1. **Service Time**: Phút làm thực tế trên từng segment (`workedMsOf(seg)`).
2. **Attendance Time**: Thời gian có mặt từ check-in đến check-out trong `KTVAttendance`.
3. **Shift Time**: Khung giờ ca quy định trong `KTVShifts` (ví dụ 09:00 - 17:00).
4. **Accumulated Hours**: Giờ tích lũy ròng trong tháng của Type D ($\Sigma \frac{\text{actual\_minutes}}{60} - \Sigma \text{hours\_penalty}$).
5. **Priority / Tour Points**: Vị trí xoay vòng trong `TurnQueue` hoặc số tua trong `TurnLedger`.
- **Chặn trần thời gian**: `actual_minutes` bị chặn trần `Math.min(thực_tế, gán)` để tránh gian lận do quên bấm kết thúc dịch vụ.

---

## 12. Penalties / Deductions / Rules

- **Nghỉ đột xuất (A/B)**: Trừ 500,000đ trong `WalletAdjustments`.
- **Vi phạm Type D (`KtvTypeDDisciplineService.ts`)**:
  - `ABSENT_NO_NOTICE`: Trừ 10 giờ tích lũy.
  - `ABSENT_EARLY_NOTICE`: Trừ 5 giờ tích lũy.
  - `LATE_NO_UPDATE`: Trừ 5 giờ tích lũy.
  - `ORDER_REJECT`: Trừ $3 \times$ thời lượng dịch vụ (ví dụ gói 60p trừ 3h).
- **Khách chấm dưới 4 sao (Type D)**: Trừ % tiền tua (1★: -75%, 2★: -50%, 3★: -25%).
- **Giặt ủi đồ**: Trừ 20,000đ/ngày vào `WalletAdjustments`.

---

## 13. Database Schema (Bảng cốt lõi)

- `Staff`: `id, work_type, feature_flags, online_status, travel_minutes, available_from, available_until`.
- `TurnLedger`: `id, date, booking_id, employee_id, is_punished, counted_at`. Ràng buộc `UNIQUE(date, booking_id, employee_id)`.
- `KTVDTurnLedger`: `staff_id, booking_item_id, assigned_minutes, actual_minutes, paid_minutes, gross_amount, net_amount, tax_amount, bonus_amount, rating_used, entry_status`. Ràng buộc `UNIQUE(staff_id, booking_item_id)`.
- `TurnQueue`: `id, employee_id, date, queue_position, status, current_order_id`.
- `KTVShifts`: `id, employeeId, shiftType, effectiveFrom, status`.
- `WalletAdjustments`: `id, staff_id, amount, type, wallet_type, reason, work_type_snapshot, created_by`.

---

## 14. Admin Configurability

- **Admin chỉnh được trên UI**: Bảng mốc hoa hồng phút, đơn giá 60p dự phòng, mức phạt nghỉ đột xuất, phí giặt đồ, công tắc bật/tắt ví, mức phạt vi phạm Type D, đổi loại KTV của nhân viên.
- **Không chỉnh được (Cần deploy code / chạy migration SQL)**: Thêm Work Type mới, đổi giờ bắt đầu/kết thúc các ca làm việc, đổi tiền tố phân loại dịch vụ VIP (NHP/NHT).

---

## 15. Top Hard-coded Business Rules

1. **Phân loại VIP theo tiền tố chuỗi ID**: `sId.startsWith('NHP') || sId.startsWith('NHT')` trong TS và SQL.
2. **Định nghĩa ca làm việc cố định trong mã nguồn**: `SHIFT_TYPES = { SHIFT_1: '09:00-17:00' ... }` tại `app/api/ktv/shift/route.ts:L8-15`.
3. **Tự động duyệt điểm danh**: `const isAutoApprove = true;` tại `app/api/ktv/attendance/route.ts:L213`.
4. **Lọc bỏ hoàn toàn KTV Loại B khỏi hệ thống ca**: `eq('work_type', 'TYPE_B')` tại `app/api/ktv/shift/route.ts:L108`.
5. **Tự động sinh mã KTV vãng lai `EXT_`**: `newId = 'EXT_' + ...` tại `app/reception/dispatch/actions.ts:L543`.
6. **Check constraint cứng trong DB**: `CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'))`.

---

## 16. Dependency / Coupling Map

```
Staff.work_type
 ├─ Attendance API ──► Type B: Bỏ qua TurnQueue, gọi OnlineService
 │                     Type A/D: Ép vào TurnQueue, trừ phí giặt đồ & phạt
 ├─ Shift API ───────► Type B: Bị lọc bỏ hoàn toàn, không hiển thị ca
 │                     Type A/D: Bắt buộc có ca, auto-revert ca tạm
 ├─ Dispatch Flow ───► Type C: Miễn kiểm tra điểm danh, auto-create EXT_
 │                     Type A/D: Bắt buộc active trong TurnQueue
 └─ Tour Pay & Wallet:
     ├─ Type A ──────► Tra SystemConfigs.ktv_commission_milestones (base 100k/h)
     ├─ Type B ──────► IF NHP/NHT -> Milestones VIP (180k/h) | ELSE -> Ép về Type A
     ├─ Type D ──────► Bỏ qua Milestones -> KtvDLedgerEngine (chặn trần, trừ sao, thuế 10%)
     └─ Type C ──────► Hưởng hoa hồng cơ bản theo Type A, không ví
```

---

## 17. End-to-End Examples (3 Ca thực tế)

- **Ca 1 (KTV Loại A - `NH016`)**: Điểm danh Wi-Fi -> Hệ thống duyệt tự động, kích hoạt Ca 1 (09:00 - 17:00), trừ 20k giặt đồ -> Phục vụ gói Body 60p (`NHS0100`) -> Hoàn thành nhận 100k vào Ví Tua, không trừ thuế -> Tan ca 17:00.
- **Ca 2 (KTV Loại B - `NH088`)**: 10:00 tại nhà bật nhận đơn (di chuyển 20p) -> Quầy gán đơn VIP Chăm sóc da 90p (`NHP0300`) -> Tới spa bấm "Đã tới tiệm", mở ca ảo VIP -> Nhận mức hoa hồng VIP 220k (thay vì 150k của Type A) nhờ tiền tố `NHP` -> Tắt app về nhà.
- **Ca 3 (KTV Loại D - `NH099`)**: Vắng mặt không báo -> Bị trừ 10 giờ tích lũy -> Làm dịch vụ Trị liệu 60p (`NHT0100`) thực tế 75p nhưng chỉ được tính 60p (chặn trần) -> Khách chấm 3 sao -> Bị trừ 25% tiền tua ($150k \to 112.5k$) -> Áp thuế TNCN 10% ($11.25k$) -> Thực nhận 101,250đ ghi vào `KTVDTurnLedger` -> Tăng 1.0 giờ vào `net_hours`.

---

## 18. Dynamic Readiness Assessment

- **Dynamic**: Bảng mốc hoa hồng phút, Bật/Tắt ví theo Feature Flags.
- **Partial**: Quy định điểm danh (IP cấu hình động nhưng auto-approve bị hard-code), Quy chế kỷ luật Type D (mức phạt động nhưng enum vi phạm bị hard-code).
- **Hard-coded**: Định nghĩa chế độ KTV (`WorkType`), Phân loại dịch vụ hưởng giá VIP qua tiền tố mã, Quản lý ca làm việc, Điều phối KTV vãng lai Type C.

---

## 19. Uncertain Areas (Điểm cần xác minh)

1. **Khả năng Lock Contention trong DB**: Mức độ lock bảng `TurnQueue` trong hàm RPC `dispatch_confirm_booking` khi đông khách cùng lúc.
2. **Dữ liệu rác Type C**: Kiểm tra số lượng bản ghi `EXT_xxxxx` mồ côi phát sinh do quầy gõ sai chính tả tên KTV.
3. **Trạng thái chạy của Worker `ktvd-recompute`**: Vercel Hobby plan chặn cron 5 phút (`*/5 * * * *`). Cần xác minh môi trường thực tế đang dùng gói Pro hay worker đang bị dừng.

---

## 20. Important Code References (Mục 1-20)

* **`lib/services/KtvCommissionService.ts`**: `getCommissionConfig()` nạp cấu hình mốc hoa hồng; `calcCommission()` quyết định tiền tua và ép giá Type B về Type A nếu sai prefix.
* **`lib/services/KtvDLedgerEngine.ts`**: `computeRows()` và `computeMinutes()` tính toán sổ cái Type D, chặn trần thời gian, trừ % theo sao và áp thuế 10%.
* **`lib/services/BookingItemPauseService.ts`**: `swapKtvOnPausedItem()` xử lý đổi KTV giữa chừng, phạt KTV cũ, thưởng trọn giờ cho KTV mới.
* **`app/reception/dispatch/actions.ts`**: `processDispatch()` tiếp nhận điều phối, tự tạo Type C, kiểm tra điểm danh KTV cơ hữu; `cancelBooking()` xử lý xóa hoặc giữ `TurnLedger`.
* **`app/api/ktv/attendance/route.ts`**: `POST()` xử lý điểm danh, kiểm tra IP Wi-Fi, tự động duyệt, rẽ nhánh luồng Type B và Type A, trừ phí giặt đồ và phạt nghỉ đột xuất.
* **`app/api/ktv/shift/route.ts`**: `GET()` quản lý ca làm, loại trừ Type B, đè ca ngày lễ, auto-revert ca tạm.
* **`lib/services/KtvOnlineService.ts`**: `goOnline()`, `arriveAtVenue()`, `goOffline()` quản lý trạng thái trực tuyến của KTV từ xa.
* **`lib/services/WalletAccessService.ts`**: Cổng kiểm soát truy cập ví 2 cấp ở server.
* **`lib/services/KtvTypeDDisciplineService.ts`**: Trừ giờ vi phạm vắng mặt, đi trễ, từ chối tua.

---
---

# PHẦN II: BẢO MẬT, VÒNG ĐỜI, TÍNH TOÀN VẸN & RỦI RO KỸ THUẬT (MỤC 21 – 42)

---

## 21. Role / Permission / Authorization

### 1. Phân cấp Role hiện có
Hệ thống tồn tại 3 định nghĩa Role không hoàn toàn đồng nhất:
- **Database ENUM (`Role`)**: `'ADMIN'`, `'MANAGER'`, `'RECEPTIONIST'`, `'TECHNICIAN'`, `'LEAD_RECEPTIONIST'`, `'DEV'`, `'SUPPORT'`.
- **Client Role Mapping** (`lib/auth-context.tsx:129-134`): `'admin'`, `'dev'`, `'branch_manager'`, `'reception'`, `'ktv'`, `'support'`.
- **Server Role Normalization** (`lib/auth-server.ts:16-26`): Map chuẩn hóa về chuỗi lowercase.

### 2. Frontend Check vs. Backend Validate vs. RLS
- **Frontend**: Ẩn/hiện button dựa trên `hasPermission(moduleId)` (`lib/auth-context.tsx:245`).
- **Backend API Routes**: **HẦU HẾT KHÔNG VALIDATE QUYỀN.**
  - `middleware.ts:67-72`: Đang đặt ở chế độ `Compatibility Phase` — nếu request không có token/JWT thì chỉ ghi `console.warn` rồi **CHO QUA LUÔN (ALLOW THROUGH)**.
  - `lib/auth-server.ts:170-178`: Hàm `requirePermission()` nếu không có session JWT cũng ghi log cảnh báo rồi **`return true` (cho phép bypass)**.
  - Hàm `requireRole()` được viết ra ở `lib/auth-server.ts:150` nhưng **không được gọi ở bất kỳ API route nào trong toàn bộ thư mục `app/api/`**.
- **Supabase RLS**: Hơn 60% bảng không bật RLS. Toàn bộ backend sử dụng `getSupabaseAdmin()` mang `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabaseAdmin.ts`), **bỏ qua 100% cơ chế RLS**.

### 3. Action Matrix & Rủi ro can thiệp tài chính

| Action | Frontend permission | Backend permission | RLS | Risk |
|---|---|---|---|---|
| Tạo/chỉnh/xóa Work Mode | `system_settings` | **KHÔNG** (`updateStaffMember` không check auth) | Bỏ qua qua service_role | **CRITICAL** |
| Chỉnh loại KTV (`work_type`) | `employee_management` | **KHÔNG** (Server Action gọi trực tiếp supabaseAdmin) | Bỏ qua qua service_role | **CRITICAL** |
| Chỉnh ca (`KTVShifts`) | `ktv_schedule` | **KHÔNG** (API `/api/ktv/shift` nhận body rồi update) | Policies có service_role full | **HIGH** |
| Chỉnh attendance | `ktv_attendance` / `reception` | **KHÔNG** (API confirm không verify role) | Bỏ qua qua service_role | **HIGH** |
| Chỉnh tiền tua / milestones | `system_settings` | **KHÔNG** (`/api/system/config` update trực tiếp SystemConfigs) | Bỏ qua qua service_role | **CRITICAL** |
| Chỉnh penalty / kỷ luật | `finance` / `settings` | **KHÔNG** (`/api/finance/adjustment` không check role/auth) | `WalletAdjustments` policy `USING(true)` | **CRITICAL** |
| Chỉnh ví (cộng/trừ tiền) | `finance` | **KHÔNG** (POST tự do, `created_by` gán cứng `'Admin'`) | Bỏ qua qua service_role | **CRITICAL** |
| Chỉnh tax / VAT | `system_settings` | **KHÔNG** (Ghi đè SystemConfigs không check quyền admin) | Không có RLS | **CRITICAL** |
| Override riêng cho KTV | `employee_management` | **KHÔNG** (`updateStaffMember` ghi đè `feature_flags`) | Bỏ qua qua service_role | **HIGH** |

> [!CAUTION]
> **Khả năng thay đổi dữ liệu tài chính lịch sử:** Bất kỳ ai có endpoint `/api/finance/adjustment` hoặc quyền truy cập giao diện Finance đều có thể chèn bút toán tiền/phạt với bất kỳ số tiền nào mà không cần xác thực JWT, không ghi nhận danh tính Admin thực tế (`created_by` luôn là chuỗi tĩnh `'Admin'`).

---

## 22. Policy / Config Lifecycle

1. **Khảo sát bảng `SystemConfigs`**: Schema chỉ gồm `id, key (UNIQUE), value (jsonb), description, created_at, updated_at`.
2. **Lifecycle States**: Hoàn toàn **KHÔNG CÓ** các trạng thái: `draft`, `active`, `inactive`, `archived`, `deleted`, `scheduled`, `effective_from`, `effective_to`.
3. **Đánh giá vòng đời**:
   - Config mới có hiệu lực ngay khi bấm Save (In-place Mutation).
   - Không có bước Publish, không có setup trước ngày áp dụng.
   - Không thể Rollback, không có Version History, không có Soft Delete. Mọi thay đổi đều ghi đè trực tiếp lên giá trị cũ.

---

## 23. Default / Fallback Behavior

| Điều kiện thiếu | Hành vi Fallback hiện tại | Đánh giá an toàn | Vị trí Code / SQL |
|---|---|---|---|
| KTV chưa được gán mode (`work_type` IS NULL) | Tự động coi là `'TYPE_A'`. Không báo lỗi. | ⚠️ Nguy hiểm (Tính nhầm lương/tua theo A) | `KtvCommissionService.ts:36`, SQL `get_ktv_wallet_balance:47` |
| Mode không có mức tua cho thời lượng (vd: 75p) | Lấy `duration / 60 * rate_per_60` (làm tròn nghìn). Nếu rate_per_60 null -> fallback về 100,000đ/h. | ⚠️ Nguy hiểm (Sai lệch so với cam kết) | `KtvCommissionService.ts:92`, SQL `get_ktv_wallet_balance:160` |
| Service mới chưa có commission | Tính theo thời lượng `Services.duration` quy đổi ra `ratePer60` (100k/h). Không chặn hoàn thành. | ⚠️ Thiếu kiểm soát | `get_ktv_wallet_balance:133-142` |
| Work Policy / Feature bị disable | Trả về `false` hoặc đóng quyền truy cập ví (403 `WALLET_DISABLED`). | ✅ An toàn | `lib/services/WalletAccessService.ts:71-80` |
| Staff override không tồn tại | Đọc cờ mặc định theo loại KTV (`DEFAULT_FEATURE_FLAGS_TYPE_A/B/D`). | ✅ Tương đối an toàn | `lib/constants/staff.constants.ts:13-34` |
| Config bị xóa khỏi `SystemConfigs` | TypeScript: Retry 3 lần rồi throw Error. SQL RPC: Im lặng fallback về mốc mặc định Loại A. | ⚠️ Lệch pha giữa TS và SQL RPC | `KtvCommissionService.ts:70` vs `20260801160000_...sql:36` |

---

## 24. Rule Priority / Conflict Resolution

1. **Thứ tự ưu tiên phân giải**:
   ```
   1. Staff Feature Flags (Cấu hình riêng: Staff.feature_flags)
      ↓
   2. Work Type Specific Config (SystemConfigs: *_TYPE_A, *_TYPE_B, *_TYPE_D)
      ↓
   3. Legacy Type Config (SystemConfigs: ktv_commission_milestones_type_b)
      ↓
   4. Global Common Config (SystemConfigs: ktv_commission_milestones)
      ↓
   5. Hard-coded Code Fallback (Hằng số tĩnh trong TypeScript và PL/pgSQL)
   ```
2. **Xung đột nguy hiểm**:
   - Lệch pha giữa TypeScript và Database SQL RPC: Sửa mốc giờ ở TS mà quên cập nhật RPC SQL sẽ khiến KTV nhìn số dư trên app một kiểu nhưng báo cáo chốt lương tháng hiển thị một kiểu khác.
   - Xung đột ghi đè ca ngày lễ: `holiday_shift2_dates` ép toàn bộ KTV sang `SHIFT_2`, ghi đè toàn bộ ca đăng ký thực tế.

---

## 25. Service / Menu Versioning

### Trace câu hỏi: "Body 90' hôm nay 150k, mai đổi 180k thì đơn cũ đọc 150k hay 180k?"
> **KẾT QUẢ TRACE: ĐƠN CŨ BỊ ĐỌC THÀNH 180,000đ (BỊ THAY ĐỔI LỊCH SỬ)!**

- **Bằng chứng**:
  1. Khi dịch vụ hoàn thành, `TurnLedger` chỉ lưu `date, booking_id, employee_id`. Hoàn toàn không lưu snapshot số tiền nhận được.
  2. Mỗi lần KTV mở ví, hàm RPC `get_ktv_wallet_balance` chạy lại toàn bộ từ `2026-05-04`, đọc `v_active_milestones` từ `SystemConfigs` tại thời điểm hiện tại.
  3. Khi Admin sửa mốc 90 phút thành 180,000đ trong Cài đặt, tất cả các đơn từ tháng 5/2026 đến nay đều tự động tính lại theo 180,000đ.
- Bảng `Services` cập nhật đè (`updateService`), không có bảng `ServiceVersions`. Đổi `duration` của dịch vụ có thể làm thay đổi số phút của các đơn cũ nếu segment fallback về dịch vụ gốc.

---

## 26. Order / Service Status State Machine

1. **Sơ đồ chuyển đổi**:
   `NEW` -> `PREPARING` -> `IN_PROGRESS` -> `CLEANING` / `FEEDBACK` -> `DONE` / `COMPLETED`. (Nhánh ngoại lệ: `CANCELLED`, `PAUSED`, `SPLIT`).
2. **Kích hoạt tài chính**:
   - `TurnLedger` ghi ngay khi xác nhận điều phối (`PREPARING`), nhưng tiền tua chỉ tính vào ví khi dịch vụ đạt `DONE`.
   - Giờ tích lũy Loại D kích hoạt khi `BookingItems.status = 'DONE'`.
   - Hủy đơn sau khi hoàn thành: `actions.ts:1360-1364` gọi lệnh xóa trực tiếp bản ghi khỏi `TurnLedger`, KTV bị mất tua ngay lập tức.
   - Cho phép Reopen: Code có đoạn xử lý khi lễ tân kéo nhầm đơn từ `COMPLETED`/`CLEANING` quay ngược lại `IN_PROGRESS`.

---

## 27. Event / Trigger Architecture

| Event | Nguồn phát sinh | Modules bị kích hoạt | Đánh giá rủi ro |
|---|---|---|---|
| **SERVICE_ASSIGNED** | RPC `dispatch_confirm_booking` | `TurnQueue` (assigned), `TurnLedger` (insert tua), Push notification | ⚠️ Ghi nhận tua trước khi KTV thực sự phục vụ |
| **SERVICE_STARTED** | Button / Realtime Broadcast `KTV_STARTED` | `BookingItems.status = 'IN_PROGRESS'`, `TurnQueue.status = 'working'` | ⚠️ Xử lý song song HTTP và Supabase Realtime channel |
| **SERVICE_COMPLETED** | Reception kéo thẻ / DB Rating Trigger | `BookingItems.status = 'DONE'`, giải phóng `TurnQueue`, worker `KTVDTurnLedger` | **HIGH**: Trigger DB tự hoàn thành khi có rating mà không qua RPC |
| **SERVICE_CANCELLED** | Button Huỷ đơn trên Điều phối | `Bookings` & `BookingItems` CANCELLED, **XÓA BẢN GHI** `TurnLedger` | **HIGH**: Xóa cứng thay vì soft-delete hoặc đảo bút toán |
| **STAFF_CHANGED** | `swapKtv` / `replaceTechnician` | Gỡ KTV cũ khỏi `TurnQueue`, xóa/giữ TurnLedger, thêm KTV mới | **CRITICAL**: Nguy cơ mất tiền KTV cũ nếu chưa chốt thời gian |
| **CHECK_IN / OUT** | API `/api/ktv/attendance` | Tạo `KTVAttendance`, cập nhật `TurnQueue`, phạt về sớm / vi phạm | ⚠️ Logic IP xử lý tại Next.js API |

---

## 28. Idempotency / Double Calculation

1. **Sổ tua (`TurnLedger`)**: Có Unique Constraint `UNIQUE ("date", "booking_id", "employee_id")` kèm `ON CONFLICT DO NOTHING`. Đảm bảo chống trùng tua khi double-click điều phối.
2. **Lỗ hổng tại `WalletAdjustments`**: Bảng điều chỉnh ví **hoàn toàn không có Idempotency Key, không có Unique Constraint**. Khi mạng lag hoặc double-click nút Thưởng/Phạt, hệ thống chèn 2 bản ghi riêng biệt, dẫn tới phạt đúp hoặc thưởng đúp cho nhân viên.

---

## 29. Transaction / Atomicity

1. **Luồng Hoàn tất đơn (`updateBookingStatus`)**: **KHÔNG NẰM TRONG TRANSACTION**. Chạy tuần tự qua các lệnh `await` rời rạc (`Bookings.update`, `BookingItems.update`, `TurnQueue.update`). Nếu đứt mạng giữa chừng, hệ thống rơi vào trạng thái rác (Partial Failure): Đơn cha `DONE` nhưng đơn con vẫn `IN_PROGRESS`, KTV bị treo ca.
2. **Luồng Xác nhận điều phối (`dispatch_confirm_booking`)**: **NẰM TRONG 1 DATABASE TRANSACTION**. Viết dưới dạng hàm PL/pgSQL RPC, tự động ROLLBACK toàn bộ nếu có lỗi.

---

## 30. Audit Log / Change History

| Thực thể | Có lưu Audit History? | Có giá trị Cũ/Mới? | Có Actor (Ai sửa)? | Có Timestamp? | Vị trí minh chứng |
|---|---|---|---|---|---|
| **Tour Pay (Mức tua)** | ❌ **KHÔNG** | ❌ Không | ❌ Không | ❌ Không | `SystemConfigs` ghi đè trực tiếp |
| **Tax / Thuế** | ❌ **KHÔNG** | ❌ Không | ❌ Không | ❌ Không | `SystemConfigs` ghi đè trực tiếp |
| **Wallet Adjustments** | ⚠️ Một phần | ❌ Không | ❌ Gán chuỗi `'Admin'` | ✅ Có | `WalletAdjustments` table |
| **Penalty / Kỷ luật** | ⚠️ Một phần (Type D) | ❌ Không lưu sửa rule | ✅ Type D lưu SecurityAuditLogs | ✅ Có | `SecurityAuditLogs` table |
| **Work Mode (Loại KTV)** | ❌ **KHÔNG** | ❌ Không | ❌ Không | ❌ Không | `Staff.work_type` ghi đè trực tiếp |
| **Schedule / Ca làm** | ⚠️ Lưu lịch sử thay thế | ❌ Không lưu admin ID | ❌ Không lưu admin | ✅ Có | `KTVShifts` (status `REPLACED`) |
| **Đổi KTV trên đơn** | ❌ **KHÔNG** | ❌ Không | ❌ Không | ❌ Không | Mất vết KTV cũ trên UI |

---

## 31. Manual Override

1. **Cộng / Trừ tiền ví (`/api/finance/adjustment`)**: Bắt buộc nhập lý do, nhưng không lưu danh tính Admin thực tế (`created_by: 'Admin'`), ghi nhận trực tiếp vào số dư ví.
2. **Sửa giờ làm thực tế (`TimeEditorModal.tsx`)**: Lễ tân mở modal sửa giờ chặng thời gian của KTV mà không cần nhập lý do, không có Audit Log, làm thay đổi trực tiếp tiền tua khi ví tính lại.
3. **Đổi trạng thái đơn hàng**: Kéo thả tự do trên Kanban, không cần lý do.
4. **Duyệt / Hủy chấm công**: Có lưu `approved_by` nhưng không bắt buộc lý do khi từ chối.

---

## 32. Historical Data Integrity

- **Mức tiền tua**: **LIVE REFERENCE** (đọc từ `SystemConfigs` qua RPC `get_ktv_wallet_balance`). Đổi mức tua hôm nay làm thay đổi toàn bộ thu nhập ví của KTV từ ngày 04/05/2026.
- **Loại KTV (`work_type`)**: **LIVE REFERENCE**. Đổi KTV từ B sang A sẽ làm các đơn quá khứ bị tính lại theo công thức Loại A.
- **Tên dịch vụ**: **LIVE REFERENCE** (`BookingItems` chỉ lưu `serviceId`, khi render `LEFT JOIN "Services"` lấy `nameVN`). Đổi tên dịch vụ làm toàn bộ hóa đơn quá khứ đổi tên theo.

---

## 33. Frontend Config Coupling

- `app/admin/settings/system/page.tsx:163`: Cố định 4 tabs: `['TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D']`.
- `app/admin/employees/actions.ts:16`: Hard-code filter `.neq('work_type', 'TYPE_C')`.
- `app/reception/dispatch/_components/DispatchStaffRow.tsx:83`: Badge giao diện gắn cứng theo tên loại KTV.
- `app/admin/service-menu/EditServiceDrawer.tsx`: Gắn cứng 5 ngôn ngữ (`vn, en, cn, jp, kr`) thay vì bảng ngôn ngữ động.

---

## 34. Duplicated Business Logic

1. **Công thức tính Tiền Tua (Commission Milestones)**: Nhân bản tại 4 nơi:
   - TypeScript: `lib/services/KtvCommissionService.ts:78-132`.
   - SQL RPC: `supabase/migrations/20260801160000_...sql` (`get_ktv_wallet_balance`).
   - SQL RPC: `supabase/migrations/20260505193000_...sql` (`get_ktv_wallet_timeline`).
   - Client TS: `app/ktv/dashboard/KTVDashboard.logic.ts:1937-1950`.
2. **Quy chế kỷ luật Loại D**: Viết lặp lại ở worker cron vắng mặt, service kỷ luật, và worker recompute.
3. **Kiểm tra trạng thái Online/Offline**: Viết lặp lại ở route handler, dispatch action và worker dọn dẹp.

---

## 35. Database Constraints

1. **`check_work_type` trên `Staff`**: `CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'))`. Chặn đứng việc thêm Work Mode mới từ giao diện.
2. **`KTVShifts_shiftType_check` trên `KTVShifts`**: `CHECK (shiftType IN ('SHIFT_1', 'SHIFT_2', 'DEV', 'VIP'))`. Gắn cứng 4 loại ca.
3. **`turnledger_date_booking_employee_key` trên `TurnLedger`**: `UNIQUE ("date", "booking_id", "employee_id")`. Ép 1 KTV chỉ nhận tối đa 1 tua trên 1 bill trong 1 ngày, không thể tính 2 tua cho combo dài.

---

## 36. Supabase-Specific Implementation

- Hơn 60% bảng không bật RLS. Toàn bộ backend sử dụng `service_role` key.
- Phụ thuộc vào các hàm PL/pgSQL RPC: `dispatch_confirm_booking`, `get_ktv_wallet_balance`, `get_ktv_wallet_timeline`, `split_booking_into_sub_bookings`.
- Triggers tự động: `tr_auto_complete_on_guest_rating` tự động hoàn thành đơn khi khách đánh giá sao.
- Realtime Subscriptions: `dispatch_board_realtime` và `web_booking_realtime` đồng bộ bảng điều phối.

---

## 37. Test Coverage

> [!IMPORTANT]
> **Hiện trạng: 0% Unit Test, 0% Integration Test, 0% E2E Test tự động trong CI/CD.**
> Toàn bộ các kịch bản rủi ro cao (double completion, đổi KTV giữa chừng, hủy đơn sau hoàn thành, đổi bảng giá ảnh hưởng đơn cũ) đều chưa có test tự động bảo vệ. Dự án chỉ có một vài file script chạy thử nghiệm thủ công (`scripts/simulate_*.ts`).

---

## 38. Current Data Volume / Migration Impact

- **`Bookings` & `BookingItems` (Rủi ro HIGH)**: Chứa toàn bộ doanh thu và lịch sử phục vụ, liên kết trực tiếp với WebBooking đang chạy thực tế.
- **`TurnLedger` (Rủi ro HIGH)**: Căn cứ duy nhất đếm số tua và tính tiền. Nếu đổi cấu trúc phải backfill snapshot tiền tua vào từng dòng.
- **`Staff` (Rủi ro HIGH)**: Bị tham chiếu bởi tất cả các module và dính CHECK constraint.
- **`WalletAdjustments` (Rủi ro MEDIUM)**: Cần giữ nguyên lịch sử giao dịch tiền.
- **`KTVDailyLedger` (Rủi ro LOW)**: Có thể generate lại toàn bộ từ Bookings.

---

## 39. External Dependencies

1. **WebBooking Website**: Dùng chung Supabase, ghi trực tiếp `Bookings` và `BookingItems` với `source = 'WEB_BOOKING'`.
2. **Nodemailer (SMTP)**: Gửi email xác nhận đặt chỗ cho khách (`lib/email.ts`).
3. **Web Push Notifications**: Gửi thông báo đơn mới tới trình duyệt điện thoại KTV qua Service Worker.
4. **JSPDF & Autotable**: Xuất hóa đơn và phiếu lương PDF.
5. **Google GenAI SDK**: `@google/genai` phân tích nhận xét khách hàng.

---

## 40. Business Terminology Map

| Khái niệm nghiệp vụ | Các từ ngữ dùng lẫn lộn trong Codebase | Nơi xuất hiện |
|---|---|---|
| **Tiền tua / Thù lao dịch vụ** | `tua`, `tour`, `commission`, `service earning`, `milestone_rate`, `rate_per_60` | `TurnLedger`, `KtvCommissionService.ts`, `SystemConfigs`, `get_ktv_wallet_balance` |
| **Chế độ làm việc / Phân loại KTV** | `work_type`, `staff_type`, `employment_type`, `work_mode`, `Loại A / B / C / D`, `Cơ bản / Hợp tác / Nhập tay / Khoán`, `Cố định / Tự do` | `Staff.work_type`, `staff.constants.ts`, `SystemSettingsPage` |
| **Huy hiệu dịch vụ** | `badge`, `comboTags`, `tags`, `isBestChoice`, `isBestSeller` | `Services` table, `SystemConfigs.menu_deep_body_config` |
| **Số giờ làm việc / tích lũy** | `actual_minutes`, `service_hours`, `accumulated_hours`, `kpi_hours`, `duration` | `KTVDTurnLedger`, `KtvAssignments`, `BookingItems.segments` |

---

## 41. Architecture Risks Before Dynamic Policy Refactor

### 🔴 CRITICAL (Nguy cấp)
1. **Lỗ hổng hồi tố số dư ví (Retroactive Balance Corruption)**: Tiền tua không được chốt snapshot vào giao dịch mà tính động theo bảng giá hiện tại. Sửa bảng giá = Sửa sạch lịch sử tiền của toàn bộ nhân viên từ trước đến nay.
2. **Toàn bộ API tài chính không có Backend Authorization**: `/api/finance/adjustment` và các Server Actions hoàn toàn không kiểm tra Role/Token của người gọi, tin tưởng tuyệt đối vào frontend.
3. **Không có Database Transaction ở luồng Điều phối**: Chuyển trạng thái đơn chạy bằng nhiều câu lệnh `await` rời rạc. Nếu đứt mạng giữa chừng, hệ thống rơi vào trạng thái dữ liệu rác (Inconsistent State).
4. **Trùng lặp công thức tính tiền giữa TypeScript và PL/pgSQL**: Hai hệ thống tính độc lập cho cùng một mục đích.

### 🟠 HIGH (Nghiêm trọng)
1. **CHECK constraint cứng trong Database**: `Staff.work_type` và `KTVShifts.shiftType` bị giới hạn cứng trong PostgreSQL, chặn đứng khả năng cấu hình động từ giao diện.
2. **Xóa cứng bản ghi TurnLedger khi hủy đơn**: Khiến kế toán mất dấu vết kiểm toán (Audit Trail) xem KTV đó đã từng làm hay chưa.
3. **Thiếu cơ sở kiểm toán Admin (Admin Attribution)**: Các hành động cộng/trừ tiền đều lưu người tạo là `'Admin'`, không biết chính xác tài khoản cá nhân nào thực hiện.
4. **Zero Automated Tests**: Không có bất kỳ test tự động nào bảo vệ các luồng tính tiền và điều phối.

### 🟡 MEDIUM (Cần lưu ý)
1. **Thuật ngữ không đồng nhất**: Cùng một loại KTV nhưng lúc gọi là "Cố định", lúc gọi là "Cơ bản", lúc gọi là "Loại A".
2. **Tải dữ liệu toàn bộ lịch sử**: Hàm `get_ktv_wallet_balance` mỗi lần chạy đều quét lại toàn bộ bookings từ tháng 05/2026. Càng nhiều đơn theo thời gian, hệ thống sẽ càng chậm.

---

## 42. Business Questions Requiring Owner Decision
*(Những câu hỏi kiến trúc code hiện tại KHÔNG THỂ tự trả lời, bắt buộc Chủ dự án phải ra quyết định nghiệp vụ)*

1. **Về tính chất Chốt giá (Price Snapshotting)**: Khi Ban Giám Đốc thay đổi bảng giá tiền tua (ví dụ tăng từ 100k lên 120k/giờ), mức giá mới này chỉ áp dụng cho các đơn **từ thời điểm bấm Lưu trở về sau**, hay có áp dụng hồi tố cho các đơn đã làm trong tháng chưa chốt lương?
2. **Về thời điểm Chốt tiền tua khi đổi KTV giữa chừng**: Nếu KTV A làm được 40 phút thì khách yêu cầu đổi KTV B làm tiếp 20 phút còn lại: Tiền tua được chia theo tỷ lệ phút thực tế (40/60 và 20/60) hay KTV A bị hủy hoàn toàn tiền tua và KTV B nhận trọn?
3. **Về việc Sửa dữ liệu điểm danh / ca làm trong quá khứ**: Nếu Quản lý sửa lại giờ check-in của một KTV vào tuần trước (từ Đi trễ thành Đúng giờ), hệ thống có được phép tự động chạy lại toàn bộ tiền phạt và tính lại lương của tuần trước hay giữ nguyên bảng lương đã xuất?
4. **Về Service không khai báo mức thù lao**: Khi tạo một Dịch vụ mới trong Menu mà Quản lý quên chưa thiết lập mức tiền tua, khi KTV hoàn thành dịch vụ này hệ thống nên **chặn không cho hoàn thành và báo lỗi**, hay **cho phép hoàn thành với mức 0 đồng**, hay **tự động tính theo công thức giờ mặc định**?
5. **Về phân quyền thực tế tại Chi nhánh**: Lễ tân có được phép tự ý cộng/trừ tiền ví và hủy phạt của KTV hay tính năng này bắt buộc phải qua tài khoản Quản lý chi nhánh / Chủ cơ sở duyệt?

---
---

# DATA NEEDED FOR FUTURE DYNAMIC POLICY DESIGN

Để một AI hoặc Kiến trúc sư Hệ thống (System Architect) có thể thiết kế lại toàn bộ phân hệ KTV theo hướng **Dynamic / Data-Driven / Policy-Based**, dưới đây là bản đặc tả các cấu trúc dữ liệu bắt buộc phải được mô hình hóa:

### 1. Work Policy Model (Mô hình Định danh Chế độ)
Thay vì hard-code `TYPE_A, TYPE_B, TYPE_C, TYPE_D`, cần một bảng `WorkPolicies`:
- `id`: string (slug, ví dụ: `'fulltime_core'`, `'partner_oncall'`, `'freelance'`, `'autonomous'`).
- `name`: string (nhãn hiển thị Tiếng Việt).
- `attendance_required`: boolean (có bắt buộc điểm danh Wi-Fi hay không).
- `scheduling_mode`: enum (`FIXED_SHIFT`, `FLEXIBLE`, `NONE`).
- `dispatch_queue_type`: enum (`PHYSICAL_FIFO`, `RANKING_PRIORITY`, `MANUAL_ONLY`).
- `compensation_scheme_id`: FK tới chính sách tính lương/tua.
- `tax_scheme_id`: FK tới chính sách thuế.

### 2. Service × Pay Mode Matrix (Ma trận Tiền tua theo Dịch vụ)
Chấm dứt hoàn toàn việc kiểm tra tiền tố mã chuỗi `NHP/NHT`. Cần bảng ma trận:
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
*Báo cáo được tổng hợp và kiểm toán tự động từ mã nguồn dự án `Quan_Tri_Va_KTV`.*
