# Plan: Loại D — không đăng ký lịch thì KHOÁ THẲNG + nhắc đăng ký lúc 21:00

> **Mức 2** (kỷ luật, khoá tài khoản). Chờ duyệt trước khi sửa code.
> Quyết định của Chủ Dự Án ngày 14/09/2026, thay cho quyết định 12/09 (commit `076980b5`):
> 1. Không đăng ký gì (đi làm hoặc OFF) → **khoá thẳng**. **Không miễn** kể cả đang trong ca — đăng ký trước là nghĩa vụ, quên là khoá.
> 2. Quầy mở khoá giữa ngày mà KTV vẫn không đăng ký → **khoá tiếp**, lại phải liên hệ quầy.
> 3. Nhắc đăng ký lúc 21:00, **có công tắc bật/tắt ở `admin/settings/features`**.

## 1. Hiện trạng

| Bản | Luật "chưa đăng ký ngày mới → khoá" | Luật "hết ngày không đăng ký + không đến" |
|---|---|---|
| `origin/main` (production) | Có, key `UNREGISTERED_NEXT_DAY`, **mặc định NONE** (bỏ qua) | `DEDUCT_OR_LOCK` −10h, có đến làm thì bỏ qua |
| Nhánh `feat/bit-lo-hong-phase1` | **Đã xoá** (`076980b5`) | như trên |

- Cron `/api/cron/daily-absence-check` chạy `0 17 * * *` UTC = **00:00 VN**. Không đổi giờ.
- Khoá = `Staff.status = 'KHÓA_TÀI_KHOẢN'` → màn khoá toàn cục (poll `session-check`), mọi API KTV bị chặn trong ≤ 20 giây (`lib/auth-server.ts` `assertNotLocked`), KTV biến khỏi ô chọn điều phối (`app/reception/dispatch/actions.ts:116`).
- Mở khoá: `POST /api/admin/staff/unlock`, quyền `dashboard` — **quầy có quyền này**. Có phí kích hoạt lại nếu bật. Nút mở ở `admin/ktv-office` và `admin/settings/system`.
- **Chỗ vướng:** KTV chỉ tự đăng ký ngày D được đến **06:59 ngày D** (`canEditRegistration`, dùng ở cả API lẫn màn `app/ktv/schedule`). Quầy mở khoá lúc 10:00 thì KTV **không còn cách nào đăng ký hôm nay** → đêm đó chắc chắn bị khoá lại dù có ngoan. Không có màn nào để quầy đăng ký hộ.
- Công tắc có tên khớp `(enable|enabled|disabled)` + `type_d` → lưu xong **đăng xuất toàn bộ KTV Loại D** (`SessionEpochService.scopeForConfigKey`). Công tắc nhắc lịch phải tránh tên này.

## 2. Luật mới

### 2.1. Lượt 00:00 (cron chốt sổ) — từng KTV Loại D đang hoạt động

Xét theo thứ tự, **khoá ở bước nào thì dừng** (mỗi người tối đa 1 lần khoá/đêm):

| Bước | Điều kiện | Xử lý |
|---|---|---|
| 1 | **Ngày vừa qua (D-1) không có dòng đăng ký nào** | **Khoá** — bỏ luật "có đến làm thì bỏ qua". Đây chính là trường hợp quầy mở khoá giữa ngày mà KTV không đăng ký |
| 2 | **Ngày mới (D) chưa có dòng đăng ký nào** | **Khoá** — không miễn người đang trong ca |
| 3 | D-1 đăng ký làm mà không đến / báo trễ không đến / báo vắng | Giữ nguyên luật hiện có |

Bỏ qua như cũ: KTV mới tạo hôm qua/hôm nay; KTV đang bị khoá sẵn.

### 2.2. Cho KTV vừa được mở khoá tự đăng ký hôm nay

Luật mới cho sửa lịch:

| Ngày | Đã có dòng đăng ký | Chưa có dòng |
|---|---|---|
| Tương lai | Sửa thoải mái (như cũ) | Tạo thoải mái (như cũ) |
| **Hôm nay** | Sửa đến 06:59, phạt 5h khi chuyển OFF sau 00:00 (như cũ) | **Tạo được mọi lúc trong ngày** (mới) |
| Đã qua | Khoá | Khoá |

- Ai là người "hôm nay chưa có dòng"? Chỉ người bị khoá lúc 00:00 rồi được mở, hoặc KTV mới. Người khác không lợi dụng được.
- Tạo mới "đi làm" cho hôm nay: **giờ đến phải sau giờ hiện tại**. Không thì vừa đăng ký xong điểm danh là dính −5h đi trễ.
- Tạo mới "OFF" cho hôm nay: không phạt giờ (đã bị khoá và nộp phí kích hoạt rồi).

### 2.3. Nhắc đăng ký lúc 21:00

- Cron mới `GET /api/cron/type-d-registration-reminder`, lịch `0 14 * * *` UTC = **21:00 VN**, có `?dry=1`, cùng kiểu bảo vệ `CRON_SECRET`.
- **Chỉ gửi khi cả 2 công tắc bật**: công tắc nhắc lịch **và** kỷ luật Loại D. Kỷ luật tắt thì không ai bị khoá, tin "sẽ bị khoá" là nói sai.
- Gửi tin cá nhân cho từng KTV Loại D đang hoạt động còn thiếu đăng ký **ngày mai**, hoặc **hôm nay** (người vừa được mở khoá):
  > "Bạn chưa đăng ký lịch (đi làm hoặc OFF) cho ngày dd/MM. Đăng ký trước 00:00, nếu không tài khoản sẽ bị khoá."
- Thêm loại tin `REGISTRATION_REMINDER` vào `lib/notification-kind.ts` (nhóm `penalty`/cảnh báo). Push đi qua webhook `StaffNotifications` như mọi tin khác.

**Công tắc** ở `admin/settings/features` → khối "Tính năng hệ thống":
- Key **`ktv_type_d_registration_reminder`** (giá trị `true`/`false`). **Cố ý không có chữ `enabled`** để bật/tắt không đăng xuất cả nhóm Loại D.
- Thiếu key = TẮT. Admin phải bật lần đầu.

## 3. Việc cần làm

| # | File | Thay đổi |
|---|---|---|
| 1 | `lib/constants/staff.constants.ts` | Thêm lại `UNREGISTERED_NEXT_DAY` (`LOCK`); `NO_REGISTRATION` → `LOCK`, sửa `label`/`moTa` (bỏ ý "có đến làm thì bỏ qua"); sửa comment "đã bỏ 12/09" |
| 2 | `app/api/cron/daily-absence-check/route.ts` | Thêm truy vấn đăng ký ngày D; bước 1 bỏ nhánh `coDiLam`; bước 2 như bảng 2.1; `xuLy` trả cờ đã khoá để dừng; response thêm `newDate` |
| 3 | `app/admin/settings/system/KtvTypeDSettingsBlock.tsx` | Thêm `UNREGISTERED_NEXT_DAY` vào `THU_TU_CASE` |
| 4 | `lib/vn-time.ts` | Thêm `canCreateRegistration(workDate)` theo bảng 2.2; `canEditRegistration` giữ nguyên cho dòng đã có |
| 5 | `app/api/ktv/daily-registration/route.ts` | Lấy dòng có sẵn **trước** khi kiểm quyền; dòng mới dùng `canCreateRegistration`; chặn giờ đến ≤ giờ hiện tại cho hôm nay |
| 6 | `app/ktv/schedule/page.tsx` | Ô ngày hôm nay chưa có dòng → cho chọn (dùng `canCreateRegistration`) |
| 7 | `app/ktv/attendance/page.tsx:891-895` | Đổi câu "Bạn chưa đăng ký lịch hôm nay — Hãy tiếp tục điểm danh" thành nhắc phải đăng ký, không là 00:00 bị khoá |
| 8 | `app/api/cron/type-d-registration-reminder/route.ts` | **Mới** — mục 2.3 |
| 9 | `vercel.json` | Thêm lịch nhắc `0 14 * * *` |
| 10 | `lib/notification-kind.ts` | Thêm `REGISTRATION_REMINDER` |
| 11 | `app/admin/settings/features/page.tsx` | Thêm công tắc vào `SYSTEM_TOGGLES` |
| 12 | `scripts/simulate_type_d_discipline_cases.ts` | Thêm kịch bản mục 6 |
| 13 | `plans/plan_type_d_bao_vang_bao_tre.md` mục 13, cuối `plans/plan_cai_dat_ky_luat_loai_d.md` | Ghi quyết định 14/09 |

`KtvTypeDDisciplineService.ts` **không đổi** — `applyCasePenalty` đã xử `LOCK`. Không có migration; `TableInSupabase.md` giữ nguyên.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Bị khoá lúc 00:00 (kể cả đang làm). `ktv/schedule` cho tạo đăng ký hôm nay khi chưa có dòng. `ktv/attendance` đổi câu nhắc. Nhận tin 21:00 | `settings/features` thêm công tắc; `settings/system` Loại D thêm 1 dòng; quầy mở khoá ở `ktv-office` như cũ; KTV bị khoá biến khỏi điều phối | `daily-absence-check`, cron nhắc mới, `vn-time`, `staff.constants`, `SystemConfigs` | Sửa cả 2 phía |
| Số liệu (giờ, tiền) | Khoá thẳng không trừ giờ | Office thấy dòng `ACCOUNT_LOCK` (0 giờ); phí kích hoạt ghi `REACTIVATION_FEE` như cũ | `KTVDPenaltyLedger` | Khớp — không đổi công thức |
| Realtime / refresh | Màn khoá qua poll `session-check`; tin nhắc qua `StaffNotifications` | Tin EMERGENCY tổng hợp người bị khoá | `Staff.status`, `StaffNotifications` | Đồng bộ |
| Quyền xem | KTV chỉ nhận tin của mình | Công tắc cần quyền `system_settings`; mở khoá cần `dashboard` | | Không lộ dữ liệu |

## 5. Hệ quả nghiệp vụ (mục 13 CLAUDE.md) — sự kiện "khoá vì không đăng ký lịch"

| Khía cạnh | Kết quả |
|---|---|
| Tiền tua · ví | Không trừ. Mở khoá thu phí kích hoạt nếu bật. **Đơn đang làm dở lúc 00:00: tiền tua tính khi đơn hoàn tất như bình thường, nhưng KTV không tự bấm được** |
| Giờ tích luỹ | Giữ nguyên |
| Lượt tua · TurnQueue · KtvAssignments | Không đụng dữ liệu. Người bị khoá không hiện trong ô chọn điều phối |
| Thưởng · đánh giá khách | Không đổi; khách vẫn đánh giá được đơn dở |
| Dọn phòng · bàn giao · nợ phòng | ⚠️ **Rủi ro đã chấp nhận (quyết định 1):** KTV đang làm qua 00:00 bị đá khỏi app → không tự bàn giao. Quầy phải xử lý đơn thay. Theo ghi chú cron, spa đóng cửa trước nửa đêm nên hiếm xảy ra |
| Hạn mức từ chối tua | Không áp dụng |
| Màn app KTV | Màn khoá, liên hệ quầy |
| Đồng hồ · tự chốt · Kanban · "cùng làm với" | Đồng hồ và tự chốt chạy phía server, không phụ thuộc KTV đang đăng nhập; Kanban quầy vẫn thấy đơn |
| Lịch sử KTV | Dòng `ACCOUNT_LOCK` theo ngày, còn vết sau khi mở khoá |
| Nhật ký quầy | `SecurityAuditLogs` `AUTO_LOCK_ABSENCE` + tin EMERGENCY tổng hợp |
| Lý do | Bước 1: "Không đăng ký lịch ngày dd/MM" · Bước 2: "Chưa đăng ký lịch (đi làm hoặc OFF) cho ngày dd/MM" |

## 6. Kiểm tra

1. `tsc --noEmit`.
2. Mô phỏng mock data, chạy thêm dưới `TZ=UTC`:
   - A. Chưa đăng ký D → **khoá** lúc 00:00 D, kể cả đang có đơn dở.
   - B. Đã đăng ký OFF cho D → không khoá.
   - C. Khoá 00:00 D → quầy mở 10:00 → KTV tạo đăng ký D (sau 07:00) và D+1 → 00:00 D+1 **không khoá**.
   - D. Khoá 00:00 D → mở 10:00 → không đăng ký D, **có đi làm** → 00:00 D+1 **khoá lại**.
   - E. Mở 10:00, đăng ký D, không đăng ký D+1 → khoá.
   - F. Không đăng ký D-1 lẫn D → khoá **1 lần**.
   - G. Tạo đăng ký hôm nay: đã có dòng sau 07:00 → vẫn chặn sửa; chưa có dòng → cho tạo; giờ đến đã qua → chặn; tạo OFF → không phạt.
   - H. Nhắc 21:00: công tắc tắt → không gửi; kỷ luật tắt → không gửi; cả hai bật → gửi đúng người thiếu ngày mai / hôm nay; `?dry=1` chỉ liệt kê.
   - I. Kỷ luật tắt / `?dry=1` ở cron khoá → chỉ liệt kê.
   - J. KTV mới tạo; KTV đang khoá → bỏ qua.
   - K. Cấu hình production còn `UNREGISTERED_NEXT_DAY: NONE` → không khoá (xác nhận bẫy mục 7).
3. Bật/tắt công tắc nhắc → **không** bump session epoch Loại D.
4. Production: `?dry=1` cả 2 cron trước đêm đầu tiên.

## 7. Deploy

- **Bẫy cấu hình:** trang Cài đặt lưu nguyên khối `CASES`. Nếu production đã lưu `UNREGISTERED_NEXT_DAY: NONE` hoặc `NO_REGISTRATION: DEDUCT_OR_LOCK`, cấu hình thắng code. Trước deploy chạy script **chỉ đọc** xem đang lưu gì; sau deploy admin chọn **"Khoá tài khoản"** cho 2 dòng ở Cài đặt → Loại D.
- **Thứ tự bật:** (1) báo KTV luật mới; (2) bật công tắc nhắc 21:00; (3) `?dry=1` cron khoá xem danh sách; (4) mới đổi 2 dòng sang "Khoá".
- Nhánh này chưa lên `main`; cần merge cùng các thay đổi kỷ luật 12/09 đang nằm trên nhánh.

## ✅ Đã làm 14/09/2026

- Làm đủ 13 mục ở §3. Khác plan một chỗ: thứ tự xét tách thành hàm thuần
  `KtvTypeDDisciplineService.xetChotSoDem` (plan ghi service "không đổi") để mô phỏng chạy đúng
  thứ cron chạy — route Next.js không export được hàm phụ.
- `tsc --noEmit` sạch. `scripts/simulate_type_d_discipline_cases.ts` đạt hết, chạy cả giờ máy và
  `TZ=UTC` (mục 5: kịch bản A–J; mục 6: tạo/sửa đăng ký).
- **Cấu hình đang lưu trên DB (đọc lúc 19:xx 14/09):** kỷ luật **BẬT**; `CASES` **không có**
  `UNREGISTERED_NEXT_DAY` → deploy xong là **khoá thẳng ngay đêm đó** theo mặc định code;
  `NO_REGISTRATION` còn lưu `DEDUCT_OR_LOCK` → admin phải đổi sang "Khoá tài khoản".
  Công tắc nhắc 21:00 chưa có khoá → đang TẮT.
- **Dry-run trên dữ liệu thật** (dev server local, `?dry=1`, không ghi):
  - Chốt sổ: 2 KTV sẽ bị khoá — T007 (đăng ký 13/09 không đến, quỹ 6,3h < 10h), T016 (Test D, chưa đăng ký 14/09).
  - Nhắc 21:00: T007 thiếu 15/09; T016 thiếu 14/09 và 15/09.
- Chưa kiểm giao diện đã đăng nhập (trang admin/KTV cần mật khẩu).

## 9. Bổ sung 14/09 (tối) — HOÃN KHOÁ khi KTV đang có đơn · chờ duyệt

> Mức 2 (khoá tài khoản + migration). Chủ Dự Án hỏi: KTV đang trong đơn thì đợi xong đơn, bàn giao,
> dọn phòng, quầy duyệt phòng rồi mới văng ra.

### 9.1. Hiện trạng

- **Đính chính:** cơ chế "đổi cấu hình → đăng xuất" (`SessionEpochService`) hiện **không** đợi xong
  đơn — đá ra trong ≤ 1 phút, trang cài đặt chỉ ghi "đừng bật giữa ca".
- Chỗ **đã biết đợi xong đơn**: nút tắt "Hoạt động" (`app/api/admin/staff/lock/route.ts:79`) gọi
  `findUnfinishedWorkToday` (`lib/unfinished-work.ts`) — còn đơn thì từ chối khoá.
- `findUnfinishedWorkToday` chỉ đếm item `PREPARING/WAITING/READY/NEW/IN_PROGRESS/PAUSED/CLEANING`.
  **Không đếm** `FEEDBACK`/`COMPLETED` — tức lúc KTV đã nộp ảnh bàn giao và **đang chờ quầy duyệt**
  (`handover_status = PENDING`; item chỉ lên `DONE` sau khi duyệt — `cron/ktv-auto-approve`).
  Khoá ở khúc này thì quầy trả lại ảnh là KTV không dọn lại được.
- Lọc theo **ngày làm việc** (cutoff 06:00): 06:00 sáng là đơn đêm qua tự rơi khỏi danh sách.

### 9.2. Luật

| Lúc | Xử lý |
|---|---|
| Cron 00:00 quyết **KHOÁ** một KTV | KTV còn đơn chưa xong (định nghĩa 9.3) → **chưa khoá**, ghi "chờ khoá" + gửi tin: *"Tài khoản sẽ bị khoá ngay khi bạn xong đơn đang làm. Lý do: …"* |
| | Không có đơn → khoá ngay như hiện tại |
| Mỗi 5 phút | KTV đang "chờ khoá" hết đơn → **khoá** (đủ vết như khoá thường) và xoá "chờ khoá" |
| Muộn nhất 06:00 | Qua ngày làm việc, đơn đêm qua không còn tính → khoá. Không cần luật hạn chót riêng |
| Kỷ luật bị TẮT trong lúc chờ | Không khoá, xoá "chờ khoá" |
| Trong lúc chờ, KTV đăng ký bù | **Vẫn khoá** — theo quyết định 1 (quên là khoá cho nhớ) |

Áp cho **mọi lượt khoá của cron 00:00** (cả luật đăng ký lẫn "không đủ giờ thì khoá"). Không đổi
luồng khoá khi từ chối tua và nút tắt "Hoạt động".

### 9.3. "Còn đơn chưa xong" cho việc hoãn khoá

Đơn của **ngày làm việc hiện tại**, KTV còn trên item và không bị đổi ra, item **chưa `DONE` /
`CANCELLED`** — tức thêm `FEEDBACK` và `COMPLETED` so với nút tắt "Hoạt động". Làm bằng tham số mới
`findUnfinishedWorkToday(supabase, staffId, { tinhCaChoDuyet: true })`, **mặc định giữ nguyên** nên
nút tắt "Hoạt động" không đổi hành vi.

### 9.4. Lưu "chờ khoá" ở đâu — khuyến nghị: cột mới trên `Staff`

Migration thêm `Staff.pending_lock jsonb NULL` = `{ caseKey, workDate, reason, decidedAt }`.
- Truy vấn mỗi 5 phút chỉ là `pending_lock IS NOT NULL` — rẻ, không quét sổ.
- Không đẻ loại dòng lạ vào `KTVDPenaltyLedger` (màn Office giờ đang hiện mọi dòng 0 giờ thành mốc).
- Sau này quầy muốn thấy nhãn "Sắp khoá" thì đọc thẳng cột này.
- Cập nhật `TableInSupabase.md`. **Phải áp migration trước khi deploy code.**

### 9.5. Việc cần làm

| # | File | Thay đổi |
|---|---|---|
| 1 | `supabase/migrations/2026091420xxxx_add_staff_pending_lock.sql` + `TableInSupabase.md` | Cột `pending_lock` |
| 2 | `lib/unfinished-work.ts` | Tham số `tinhCaChoDuyet` (mặc định `false`) |
| 3 | `lib/services/KtvTypeDDisciplineService.ts` | `applyCasePenalty`: nhánh LOCK hỏi đơn → ghi `pending_lock` + tin nhắn, trả `ketQua: 'LOCK', hoan: true`. Thêm `apDungKhoaCho(staffId)` dùng lại `khoaTaiKhoan` |
| 4 | `app/api/cron/daily-absence-check/route.ts` | Kết quả tách "khoá ngay" / "chờ khoá"; tin EMERGENCY liệt kê cả hai |
| 5 | `app/api/cron/type-d-pending-lock/route.ts` (**mới**) + `vercel.json` `*/5 * * * *` | Áp khoá cho người đã xong đơn; `?dry=1` |
| 6 | `app/api/admin/staff/unlock/route.ts` | Mở khoá thì xoá luôn `pending_lock` còn sót |
| 7 | `scripts/simulate_type_d_discipline_cases.ts` | Kịch bản 9.6 |

Không đụng `KTVDashboard.logic.ts`, handler dispatch, `app/reception/dispatch/*`.

### 9.6. Kiểm tra

- 00:00 KTV đang `IN_PROGRESS` → chờ khoá; 00:40 item `CLEANING` → vẫn chờ; nộp ảnh (`FEEDBACK`,
  handover `PENDING`) → vẫn chờ; quầy duyệt → `DONE` → lượt 5 phút kế tiếp khoá.
- Quầy trả lại ảnh (`CLEANING`) → vẫn chờ, KTV dọn lại được.
- KTV bị đổi ra khỏi đơn → không tính là còn đơn → khoá.
- Đơn kẹt `FEEDBACK` qua 06:00 → khoá.
- Kỷ luật tắt lúc chờ → không khoá, xoá chờ. Quầy mở khoá → xoá chờ.
- 2 KTV cùng 1 đơn: chỉ người bị xử chờ, người kia không ảnh hưởng.
- Nút tắt "Hoạt động" vẫn từ chối/cho phép như cũ (tham số mặc định).

### 9.7. Rủi ro

- Trong lúc "chờ khoá", quầy **vẫn giao được đơn mới** cho KTV đó (ô chọn điều phối chỉ ẩn người đã
  khoá). Không sửa dispatch; chặn trần bằng mốc 06:00. Sau 00:00 hiếm có đơn mới.
- Cron 5 phút → KTV xong đơn có thể còn dùng app thêm tối đa ~5 phút.

### 9.8. ✅ Đã làm 14/09/2026

- Đủ 7 mục §9.5. Migration `20260914200000_add_staff_pending_lock.sql` — **chưa áp lên DB**.
- Không ghi được `pending_lock` (chưa áp migration) thì khoá ngay như cũ, không bỏ qua hình phạt.
- `tsc` sạch. Mô phỏng mục 7 (giờ máy + `TZ=UTC`): 9 trạng thái đơn (gồm bị đổi ra, làm song song),
  nút tắt "Hoạt động" giữ hành vi cũ, `applyCasePenalty` chỉ hỏi đơn khi quyết khoá. Chạy bằng
  `npx ts-node -r tsconfig-paths/register ...`.

## 8. Commit gợi ý

`feat(ky-luat): loai D khong dang ky lich la khoa thang, nhac dang ky luc 21h`

```
Van hanh: KTV loai D phai dang ky di lam hoac OFF truoc 00:00, khong dang ky la khoa,
mo khoa roi van khong dang ky thi dem do khoa lai. Nhac luc 21:00 bat o Quan ly tinh nang.
```
