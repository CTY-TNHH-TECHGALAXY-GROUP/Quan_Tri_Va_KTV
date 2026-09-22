# BÁO CÁO HOÀN TẤT FINAL GALLERY NHP/NHT: SỬA BLOCKERS, TEST VÀ CHUẨN BỊ DEPLOY

---

## 1. TỔNG QUAN KẾT QUẢ THỰC HIỆN

Nhiệm vụ xử lý toàn bộ các blocker P1 và hoàn thiện tính năng Gallery Nhân viên trên 2 repository:
- **Admin Repo:** `/Users/charlotte/Desktop/NGÂN HÀ/CTY TechGalaxy Group/Quan_Tri_Va_KTV` (branch: `feat/bit-lo-hong-phase1`)
- **WRB Repo:** `/Users/charlotte/Desktop/NGÂN HÀ/CTY TechGalaxy Group/web_noi_bo/wrb-noi-bo-dev` (branch: `feat/deep-body-treatment`)

Tất cả các blocker kỹ thuật đã được khắc phục triệt để bằng code thực tế, bảo đảm **Zero-Regression**, **Zero-Write** vào DB/Storage dùng chung, và vượt qua **76/76 test cases** tự động với **Exit Code 0** trên toàn bộ các công cụ kiểm tra (TypeScript compiler, ESLint, Next.js Production Build).

---

## 2. CHI TIẾT CÁC LỖI ĐÃ SỬA VÀ DIFF THỰC TẾ

### 2.1. P1 — Bảo Vệ API Upload Gallery (`app/api/admin/employees/upload-gallery/route.ts`)
- **Nguyên nhân gốc rễ trước sửa:** Route gọi `getSupabaseAdmin()` và upload lên Storage mà không kiểm tra xác thực hoặc phân quyền người gọi; chấp nhận `staffId='temp'` và `groupId='general'`; lấy đuôi file từ tên do client gửi (`file.name.split('.').pop()`).
- **Giải pháp triệt để:**
  1. Tích hợp cơ chế xác thực thật của Admin (`requireApiUser` & `requireBusinessUser` từ `@/lib/auth-server`) ngay ở đầu hàm `POST`, trước khi xử lý `request.formData()` và trước `getSupabaseAdmin()`.
  2. Phân quyền chặt chẽ:
     - Chưa đăng nhập $\rightarrow$ **HTTP 401** (`Bạn cần đăng nhập.`).
     - Đã đăng nhập nhưng không có quyền quản lý nhân viên (không có quyền `employee_management` hoặc không thuộc role `ADMIN`/`DEV`/`BRANCH_MANAGER`) $\rightarrow$ **HTTP 403** (`Bạn không có quyền chỉnh sửa nhân viên.`).
     - Tài khoản bị khóa kỷ luật/hệ thống $\rightarrow$ **HTTP 403** (`Tài khoản của bạn đã bị khóa.`).
  3. Kiểm tra tính hợp lệ của tham số:
     - Bắt buộc `staffId` tồn tại trong bảng `Staff` ở cơ sở dữ liệu; nếu không tìm thấy $\rightarrow$ **HTTP 404** (`Nhân viên không tồn tại trong hệ thống.`).
     - Bắt buộc `groupId` thuộc danh mục 6 nhóm hợp lệ (`GALLERY_GROUPS`).
     - Từ chối file rỗng (`file.size === 0`) hoặc vượt quá 5MB $\rightarrow$ **HTTP 400**.
     - Kiểm tra MIME type trong danh sách cho phép (`image/jpeg`, `image/png`, `image/webp`).
     - **Magic Bytes Validation:** Kiểm tra trực tiếp binary header của buffer (`FF D8 FF` cho JPEG, `89 50 4E 47` cho PNG, `RIFF...WEBP` cho WebP) để loại trừ file giả mạo extension.
     - Lấy file extension chuẩn hóa từ MIME map (`EXTENSIONS[file.type]`), không tin cậy filename từ client.
     - Thiết lập cấu hình Storage upload: `upsert: false` (tránh ghi đè file hiện có).
     - Không để lộ thông tin nhạy cảm, cookies, auth token hay raw `error.message` nội bộ ra response client.

### 2.2. P1 — Chống Gắn Nhầm Hồ Sơ / Phiên Edit (`components/EmployeeDetailModal.tsx`)
- **Nguyên nhân gốc rễ trước sửa:** `handleFileUpload` xử lý bất đồng bộ nhiều file, sau đó append vào `editedEmployee` chỉ kiểm tra `current != null`. Khi quản lý đang upload ảnh cho Nhân viên A mà đổi sang xem Nhân viên B hoặc đóng modal rồi mở lại Nhân viên C, callback upload cũ của A sẽ bị gắn nhầm vào B hoặc C.
- **Giải pháp triệt để:**
  1. Sử dụng cơ chế Session Token Invalidation thông qua `gallerySessionRef = useRef(0)` (không dùng thư viện ngoài).
  2. Bất kỳ khi nào mở modal, đóng modal, hoặc đổi đối tượng nhân viên (`[employee, isOpen]` thay đổi), `gallerySessionRef.current += 1` đồng thời cleanup effect cũng tăng token.
  3. Sự kiện đóng modal (`Dialog.Root onOpenChange` và nút đóng `X`) đều kích hoạt tăng session token ngay trước khi gọi `onClose()`.
  4. Trong `handleFileUpload`:
     - Khóa cứng `employeeIdAtStart = editedEmployee.id` và `sessionAtStart = gallerySessionRef.current`.
     - Kiểm tra `isCurrentSession()` trước mỗi lượt gửi request, sau khi nhận response, bên trong `setEditedEmployee`, và khi cập nhật `setUploadErrors`.
     - Bên trong callback `setEditedEmployee`, kiểm tra điều kiện kép: `isCurrentSession() && current && current.id === employeeIdAtStart`. Nếu phiên hoặc nhân viên đã thay đổi, bỏ qua toàn bộ kết quả cũ.
     - Bọc toàn bộ trong `try/finally`: khối `finally` chỉ reset `uploadingGroups[groupId] = false` nếu `isCurrentSession() === true`, tránh việc upload cũ reset trạng thái loading của phiên mới.
     - Nút "Lưu" tiếp tục bị vô hiệu hóa khi có bất kỳ upload nào đang diễn ra: `disabled={isSaving || Object.values(uploadingGroups).some(Boolean)}`.

### 2.3. Hoàn Thiện Luồng Dán URL & Server Action Validation (`app/admin/employees/actions.ts` & `lib/galleryHelper.ts`)
- `isGalleryImageUrl(value)` được chuẩn hóa:
  - Chấp nhận các URL `http://`, `https://` (giữ nguyên toàn bộ query parameters của CDN).
  - Chấp nhận đường dẫn nội bộ hệ thống dạng relative path `/avatars/...`.
  - Từ chối dứt khoát các giao thức nguy hiểm: `javascript:`, `data:`, `blob:`, `ftp:`.
- Server Action `normalizeStaffGallery` trong `app/admin/employees/actions.ts`:
  - Thực thi kiểm tra URL thông qua `isGalleryImageUrl` cho cả dạng string (legacy) lẫn dạng object metadata `{url, kind, therapyId}` trước khi ghi vào Database.
  - Ngăn chặn hoàn toàn việc chèn script XSS hoặc base64 data URL vào database thông qua Server Action.

---

## 3. BẢNG TỔNG HỢP KIỂM TRA TOÀN DIỆN (76/76 PASS)

| STT | Môi trường / Repository | Lệnh kiểm tra | Số lượng Test Cases / Routes | Kết quả | Exit Code |
|:---:|:---|:---|:---:|:---:|:---:|
| 1 | **Admin** (`Quan_Tri_Va_KTV`) | `npm run test:employee-actions` | **33 / 33 test cases** | **PASS** | `0` |
| 2 | **Admin** (`Quan_Tri_Va_KTV`) | `npx tsc --noEmit --incremental false` | Toàn bộ dự án Admin | **PASS (0 errors)** | `0` |
| 3 | **Admin** (`Quan_Tri_Va_KTV`) | Targeted ESLint trên các file sửa | 4 files cốt lõi | **PASS (0 errors)** | `0` |
| 4 | **Admin** (`Quan_Tri_Va_KTV`) | `git diff --check` | Toàn bộ working tree | **PASS (Clean)** | `0` |
| 5 | **Admin** (`Quan_Tri_Va_KTV`) | `npm run build` | **116 routes App Router** | **PASS (Compiled)** | `0` |
| 6 | **WRB** (`wrb-noi-bo-dev`) | `npm run test:menu-photos` | **19 / 19 test cases** | **PASS** | `0` |
| 7 | **WRB** (`wrb-noi-bo-dev`) | `npm run test:carousel` | **18 / 18 test cases** | **PASS** | `0` |
| 8 | **WRB** (`wrb-noi-bo-dev`) | `npm run test:api-fallback` | **6 / 6 test cases** | **PASS** | `0` |
| 9 | **WRB** (`wrb-noi-bo-dev`) | `npx tsc --noEmit --incremental false` | Toàn bộ dự án WRB | **PASS (0 errors)** | `0` |
| **TỔNG CỘNG** | **Cả 2 dự án** | **Full Verification Suite** | **76 / 76 test cases** | **HOÀN TOÀN ĐẠT** | **`0`** |

---

## 4. XÁC MINH TRẠNG THÁI SCHEMA DATABASE MỤC TIÊU

### 4.1. Kết quả kiểm tra chỉ đọc (Read-only Schema Check)
- **Database URL xác minh:** `https://adzfohfdindovfcpaizb.supabase.co` (được dùng chung bởi cả Admin và WRB trong file `.env.local`).
- **Thực thi truy vấn:**
  ```javascript
  supabase.from('Staff').select('id, gallery_urls').limit(1);
  ```
- **Kết quả trả về từ database:**
  ```
  QUERY_RESULT: ERROR column Staff.gallery_urls does not exist (PostgreSQL code: 42703)
  ```
- **Kết luận hiện trạng:**
  - Cột `Staff.gallery_urls` **chưa tồn tại** trên cơ sở dữ liệu Supabase mục tiêu.
  - Migration chưa từng được áp dụng trên database production/preview này.
  - Phù hợp hoàn toàn với cơ chế an toàn: Client/WRB API Fallback hiện tại đã có logic bắt lỗi 42703 và tự động fallback về `gallery_urls: []` mà không làm sập ứng dụng.

### 4.2. File Migration SQL Chuẩn Bị Sẵn Cho Quản Trị Viên
File migration mới đã được tạo tại:
`supabase/migrations/20260920000000_harden_staff_gallery_urls.sql`

```sql
-- Migration: Ensure Staff.gallery_urls is jsonb with empty array default and reload PostgREST schema cache
DO $$
BEGIN
  -- 1. Nếu cột đã tồn tại dạng ARRAY (text[]), DROP DEFAULT trước rồi chuyển sang jsonb bảo toàn dữ liệu
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Staff'
      AND column_name = 'gallery_urls'
      AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE public."Staff"
      ALTER COLUMN gallery_urls DROP DEFAULT;

    ALTER TABLE public."Staff"
      ALTER COLUMN gallery_urls TYPE jsonb
      USING to_jsonb(gallery_urls);
  -- 2. Nếu cột chưa từng tồn tại, thêm cột mới kiểu jsonb
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Staff'
      AND column_name = 'gallery_urls'
  ) THEN
    ALTER TABLE public."Staff"
      ADD COLUMN gallery_urls jsonb;
  END IF;
END $$;

-- 3. Đặt giá trị mặc định là '[]'::jsonb
ALTER TABLE public."Staff"
  ALTER COLUMN gallery_urls SET DEFAULT '[]'::jsonb;

-- 4. Cập nhật các dòng đang có giá trị NULL thành []
UPDATE public."Staff"
SET gallery_urls = '[]'::jsonb
WHERE gallery_urls IS NULL;

-- 5. Báo PostgREST tải lại schema cache ngay lập tức
NOTIFY pgrst, 'reload schema';
```

*(Lưu ý: Theo đúng nguyên tắc an toàn, lệnh migration này **chưa chạy** trên shared/production database trong phiên làm việc này).*

---

## 5. DANH SÁCH FILE THUỘC TÍNH NĂNG ĐƯỢC ĐỀ XUẤT COMMIT

Để chuẩn bị commit gọn gàng, tách biệt hoàn toàn khỏi các file nháp/ngoài phạm vi trong repo:

### Repository Admin (`Quan_Tri_Va_KTV`):
1. `app/admin/employees/actions.ts` — Thêm validator URL vào `normalizeStaffGallery`.
2. `components/EmployeeDetailModal.tsx` — UI upload riêng từng nhóm phương pháp và cơ chế Session Token Invalidation.
3. `lib/galleryHelper.ts` — 6 nhóm Gallery, mapper, deduplicator và validator URL an toàn.
4. `app/api/admin/employees/upload-gallery/route.ts` — Endpoint upload an toàn (Auth, Magic bytes, Upsert: false, 5MB).
5. `supabase/migrations/20260920000000_harden_staff_gallery_urls.sql` — File migration chuẩn hóa cột `Staff.gallery_urls`.
6. `scripts/test-employee-actions.ts` — Suite 33 regression tests bao phủ URL, session, auth và payload mapping.

### Repository WRB (`wrb-noi-bo-dev`):
1. `src/components/Menu/DeepBody/StaffSelector/index.tsx` — Giữ thứ tự chọn KTV theo `selectedIds`.
2. `src/components/Menu/DeepBody/StaffSelector/staffSelector.logic.ts` — Helper xử lý thứ tự chọn KTV.
3. `src/lib/menuPhotos.helper.ts` — Xử lý ảnh đại diện NHP và NHT theo phương pháp trị liệu.
4. `src/lib/staffQueryHelper.ts` — Helper fallback truy vấn khi thiếu cột `gallery_urls`.
5. `src/app/api/staff/therapy-available/route.ts` — Endpoint NHT với cơ chế fallback 42703.
6. `src/app/api/staff/vip-available/route.ts` — Endpoint NHP với cơ chế fallback 42703.
7. `scripts/test-menu-photos.ts`, `scripts/test-carousel-logic.ts`, `scripts/test-api-fallback-logic.ts` — 43 automated tests.

---

## 6. CÁC BƯỚC CẦN THỰC HIỆN KHI DEPLOY

1. **Bước 1 (Database Migration):** Chạy nội dung file `supabase/migrations/20260920000000_harden_staff_gallery_urls.sql` trong SQL Editor của Supabase project `adzfohfdindovfcpaizb` để khởi tạo cột `gallery_urls` và nạp schema cache.
2. **Bước 2 (Commit & Push):** Stage các file được liệt kê ở mục 5 và thực hiện commit/push lên git.
3. **Bước 3 (Vercel Deployment):** Deploy bản build mới nhất của Admin và WRB lên Vercel.
4. **Bước 4 (Smoke Test Production):**
   - Đăng nhập quyền Admin $\rightarrow$ Vào mục Nhân viên $\rightarrow$ Mở một nhân viên $\rightarrow$ Tải ảnh lên nhóm Tinh dầu dừa và dán link vào nhóm Đá nóng $\rightarrow$ Bấm Lưu.
   - Mở màn hình Khách đặt (WRB) $\rightarrow$ Kiểm tra ảnh hiển thị tương ứng trên Menu Điều Trị (NHT) và VIP Menu (NHP).
