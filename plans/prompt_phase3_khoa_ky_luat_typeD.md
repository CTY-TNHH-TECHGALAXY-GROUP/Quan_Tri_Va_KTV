# Prompt Phase 3 — Khóa kỷ luật TYPE_D (Task 11, 12, 14)

> Copy toàn bộ phần dưới gửi cho anti.
> Bối cảnh: tiếp nối `plans/plan_ra_soat_dangky_typeD_va_baokhach.md` (mục A8, B7).
> Phase 2 (Task 5/6/7/10/13) đã xong, KHÔNG đụng lại.

---

Làm Task 11, 12, 14. Đọc hết trước khi code — có một quyết định kiến trúc ở §1 ảnh hưởng toàn bộ phần còn lại.

## 1. QUYẾT ĐỊNH GỐC: tách "khóa kỷ luật" khỏi "vô hiệu hóa tài khoản"

Hiện tại `app/api/cron/daily-absence-check/route.ts:60-67` set **cả hai** cờ khi phạt:

```ts
await supabase.from('Staff').update({ status: 'KHÓA_TÀI_KHOẢN' }).eq('id', staff.id);
// ...
await supabase.from('Users').update({ is_active: false }).eq('id', userRecord.id);
```

Đây là gốc của vấn đề: KTV bị khóa lúc 23:59 thì sáng hôm sau **không đăng nhập nổi**, không thấy lý do,
không biết liên hệ ai — và nếu cron khóa oan thì họ không có đường khiếu nại. Tách thành 2 khái niệm:

| Cờ | Ý nghĩa | Hành vi mong muốn |
|---|---|---|
| `Staff.status = 'KHÓA_TÀI_KHOẢN'` | Khóa **kỷ luật** | **VẪN đăng nhập được** → vào app thấy màn khóa có lý do |
| `Users.is_active = false` | Nghỉ việc / khóa **bảo mật** | Chặn login (giữ nguyên `app/login/actions.ts:70`) |

**⇒ Việc đầu tiên: xóa đoạn update `Users.is_active = false` trong cron.** Chỉ set `Staff.status`.
Đừng đụng vào `app/login/actions.ts:70` — logic chặn `is_active === false` ở đó vẫn đúng cho ca nghỉ việc.

---

## 2. TASK 11 — Cron `daily-absence-check`

File: `app/api/cron/daily-absence-check/route.ts`

### 2.1 Bỏ vô hiệu hóa `Users`
Xóa khối lấy `userRecord` + update `is_active: false` (dòng ~63-67). Chỉ giữ update `Staff.status`.

### 2.2 Loại trừ nhân sự mới
Query `Staff` ở dòng ~29 đang lấy: `work_type = 'TYPE_D'` và `status != 'KHÓA_TÀI_KHOẢN'`.
Bổ sung: **bỏ qua staff có `createdAt` trong ngày chạy cron** — họ chưa kịp đăng ký, khóa là oan.
Nhớ select thêm cột `createdAt` (hiện chỉ select `id, status, work_type`).

### 2.3 Ghi audit TRƯỚC khi khóa
Bảng có sẵn: **`SecurityAuditLogs`** (`supabase/migrations/20260613000000_create_security_audit_logs.sql`).
Xem cách `app/login/actions.ts:55-62` insert để dùng đúng schema. Ghi:
`action = 'AUTO_LOCK_ABSENCE'`, staff id, ngày vi phạm (`todayStr`), lý do, `details: { source: 'CRON' }`.

### 2.4 Notification cho CẢ HAI phía
Dùng `createNotification` từ `lib/notification-helper.ts` (signature: `{ type, message, employeeId?, bookingId? }`).
- Cho KTV bị khóa: `employeeId = staff.id`, message nêu rõ ngày vi phạm + lý do.
- Cho admin: một notification riêng, `employeeId` để null (broadcast), liệt kê ai bị khóa hôm nay.

⚠️ Cron đang chạy `for` tuần tự với nhiều query lồng nhau. Nếu số TYPE_D lớn thì gom notification admin
thành **một** bản ghi tổng hợp cuối vòng lặp, đừng bắn từng cái.

### 2.5 Endpoint mở khóa
Tạo `app/api/admin/staff/unlock/route.ts` — `POST { staffId, reason }`:
- Bảo vệ bằng `requirePermission('dashboard')` từ `lib/auth-server.ts` (đã có sẵn, dòng 167).
- Set `Staff.status` về giá trị bình thường (kiểm tra giá trị chuẩn đang dùng trong repo, đừng đoán).
- Ghi `SecurityAuditLogs` với `action = 'MANUAL_UNLOCK'` + ai mở (`requireBusinessUser()`).
- Notification cho KTV: đã được mở khóa.

---

## 3. TASK 12 — UI màn khóa

### 3.1 CHẶN Ở SERVER TRƯỚC — đây là phần bắt buộc, không được bỏ

Nếu chỉ làm overlay ở UI thì người bị khóa vẫn gọi API trực tiếp được. Thêm vào `lib/auth-server.ts`:

```ts
export async function requireActiveStaff() { /* 403 ACCOUNT_LOCKED nếu Staff.status = 'KHÓA_TÀI_KHOẢN' */ }
```

Gọi nó trong **mọi** API nghiệp vụ KTV, tối thiểu:
- `app/api/ktv/attendance/route.ts`
- `app/api/ktv/daily-registration/route.ts`
- `app/api/ktv/attendance-adjustment/route.ts`
- các route turn queue / nhận đơn (tự grep `app/api/ktv/` để liệt kê đủ)

Trả về `{ error: 'ACCOUNT_LOCKED', ... }` status **403** để client phân biệt được với lỗi khác.

### 3.2 Đổi hành vi realtime listener

File: `lib/auth-context.tsx:68`. Hiện đang gộp 2 trạng thái vào cùng một nhánh đá về login:

```ts
if ((payload.new.status === 'ĐÃ NGHỈ' || payload.new.status === 'KHÓA_TÀI_KHOẢN') && !isLoggedOut) {
```

Tách:
- `'ĐÃ NGHỈ'` → **giữ nguyên** hành vi cũ (dọn storage + `window.location.href = '/login?error=account_locked'`).
- `'KHÓA_TÀI_KHOẢN'` → **KHÔNG** redirect nữa. Set state `lockedInfo` trong context và expose ra ngoài.
  Không xóa session, không signOut.

### 3.3 Màn khóa

Tạo `components/shared/AccountLockedScreen.tsx`, render full-screen trong `components/layout/AppLayout.tsx`
khi `lockedInfo` có giá trị (chặn trước khi render children — **không dùng blur/overlay có thể tab qua**).

Hiển thị: lý do khóa, ngày vi phạm, số giờ bị trừ, tên + hotline admin để liên hệ.
**Không** có nút tự mở khóa. Có nút "Đăng xuất".

Nguồn dữ liệu: thêm vào `app/api/ktv/attendance/status/route.ts` (KTV đã gọi sẵn route này) một field
`lockInfo` khi `Staff.status = 'KHÓA_TÀI_KHOẢN'`, hoặc tạo route riêng — tùy bạn, miễn không thêm
một vòng fetch nữa lúc khởi động app.

### 3.4 Loại KTV bị khóa khỏi luồng chia đơn

**Đừng quên bước này.** Nếu bỏ qua, người bị khóa vẫn được gán đơn mà không vào app nhận được → đơn treo.
Grep các nơi build danh sách KTV khả dụng (turn queue, dropdown gán KTV ở `app/reception/dispatch/`)
và loại `Staff.status = 'KHÓA_TÀI_KHOẢN'` ra.

---

## 4. TASK 14 — Audit nút Báo Khách (độc lập, làm cuối)

File: `app/api/reception/guest-arrival/route.ts`

- Dòng ~47: `createdByName = bUser.techCode;` — comment ngay đó tự thừa nhận là fallback.
  Lấy tên thật từ `Users.fullName` / `Staff` thay vì mã KTV.
- `DELETE`: hiện `releasedBy` mặc định `'SYSTEM'` cho mọi trường hợp. Phân biệt:
  - auto-release (do hết đơn chờ) → `'AUTO'`
  - người bấm tắt → id người bấm

---

## 5. RÀNG BUỘC CHUNG

- **Không** sửa lại Task 5/6/7/10/13 của Phase 2.
- **Không** đụng `app/login/actions.ts:70`.
- `lib/vn-time.ts` đã có `vnNow/vnToday/vnHour/canEditRegistration` — dùng lại, đừng viết hàm giờ mới.
- Mọi so sánh ngày/giờ nghiệp vụ phải qua `lib/vn-time.ts`, không dùng `new Date()` trần.

## 6. TỰ KIỂM TRƯỚC KHI BÁO XONG

1. Cron khóa 1 KTV → KTV đó **vẫn đăng nhập được**, vào app thấy màn khóa, không thấy dashboard.
2. Đang mở app sẵn mà bị cron khóa → màn khóa hiện ra **tại chỗ**, không bị đá về `/login`.
3. Gọi thẳng `POST /api/ktv/attendance` bằng tài khoản đang bị khóa → **403 `ACCOUNT_LOCKED`**
   (đây là bài test quan trọng nhất — nếu vẫn 200 thì §3.1 chưa làm đúng).
4. KTV `status = 'ĐÃ NGHỈ'` → vẫn bị đá về `/login` như cũ (không được đổi hành vi này).
5. Staff mới tạo trong ngày, chưa đăng ký → cron chạy → **không** bị khóa.
6. Admin gọi unlock → KTV vào lại app bình thường, `SecurityAuditLogs` có đủ 2 dòng (lock + unlock).
7. KTV bị khóa **không** còn xuất hiện trong danh sách gán KTV ở Dispatch.

Báo lại: file nào đã sửa, và kết quả 7 mục trên — mục nào chưa test được thì nói rõ chưa test,
đừng báo xong chung chung.
