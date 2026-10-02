# Plan — Cron dọn ảnh: chấm công 30 ngày, bàn giao + selfie 3 ngày

> Mức 2 (xoá dữ liệu). Ngày 2026-10-03 · Nhánh `feat/bit-lo-hong-phase1` (đang là Production từ 03/10).
> User chốt 03/10: ảnh chấm công giữ **30 ngày**; ảnh bàn giao + ảnh bắt đầu dịch vụ (selfie) giữ **3 ngày**,
> chỉ xoá khi đơn đã chốt; bằng chứng kỷ luật **không xoá**.

## 1. Hiện trạng

- 2 job pg_cron `auto_delete_old_attendance_photos` (30 ngày, từ 04/04) và `delete-old-attendance-photos`
  (7 ngày, từ 25/04) **lỗi mỗi ngày**: Supabase cấm `DELETE FROM storage.objects` ("Use the Storage API").
  Chưa xoá được file nào.
- `lib/services/StorageCleanupService.ts` có sẵn nhưng **không ai gọi**, và không dùng được: mặc định giữ 3 ngày,
  chỉ liệt kê thư mục gốc, tối đa 1000 file, không phân loại ảnh.

## 2. ⚠️ Bucket `attendance` chứa 4 loại ảnh, không chỉ ảnh chấm công

| Loại | Nơi ghi | Số file | Dung lượng | Cũ hơn 30 ngày |
|---|---|---|---|---|
| **Ảnh chấm công** `MAKTV_<ms>_<n>.<ext>` ở gốc | `app/api/ktv/attendance/route.ts:480` | 2.208 | 290 MB | **1.741 file / 232 MB** |
| Ảnh bàn giao `handover-photos/…`, `handover_…` | `handleReleaseKTV.ts:44`, `handleFinishService.ts:90` | 4.923 | 233 MB | 2.838 / 134 MB |
| Ảnh bắt đầu dịch vụ `selfie_…` | `handleStartTimer.ts:193` | 1.213 | 51 MB | 964 / 40 MB |
| Bằng chứng kỷ luật `office-evidence/…` | `app/api/admin/ktv-office/deduct/route.ts:66` | 8 | 1 MB | 0 |
| Khác (`reject_…` quầy từ chối bàn giao…) | `app/api/reception/handover/review/route.ts:57` | 240 | 24 MB | 67 / 12 MB |

Hai job cũ nếu chạy được sẽ xoá **cả bằng chứng bàn giao và kỷ luật** — tức xoá chứng cứ tranh chấp tiền tua.

**Phạm vi:** loại 1 (chấm công, 30 ngày) + loại 2, 3 và `slipper_`/`start_`/`reject_` trong "Khác" (ảnh của đơn, 3 ngày).
`office-evidence/` **không bao giờ xoá**.

## 3. Thay đổi

1. **Route mới** `app/api/cron/cleanup-photos/route.ts` (GET, `requireCronAuth`), `?dry=1` chỉ đếm + 20 tên mẫu.
   Hằng số đầu file: `ATTENDANCE_RETENTION_DAYS = 30`, `BOOKING_PHOTO_RETENTION_DAYS = 3`, `MAX_DELETE_PER_RUN = 1000`.
   Không đọc `storage_cleanup_days` (config cũ, tránh hiểu lầm hai nơi giữ một con số).

   **A. Ảnh chấm công — theo tên file + tuổi**
   - `list('')` phân trang hết thư mục gốc bucket `attendance`.
   - Chỉ chọn tên khớp **đúng** `^[A-Z]+[0-9]+_[0-9]{13}(_[0-9]+)?\.(jpe?g|png|webp)$` và `created_at` < now − 30 ngày.

   **B. Ảnh của đơn (bàn giao, selfie, dép khách, từ chối) — theo TRẠNG THÁI ĐƠN, không theo tên file**
   - Lấy `BookingItems` (qua `Bookings.timeStart` < now − 3 ngày, cửa sổ 365 ngày) thoả: `status = 'DONE'`,
     `handover_status` ≠ `REJECTED`, `commission_locked` ≠ true. (Chốt 03/10: thực tế 97% đơn DONE vẫn `PENDING`
     vì quầy không bấm duyệt → không đòi `APPROVED`. `BookingItems` không có `updated_at`.)
   - Gom link từ: `handover_images`, `handover_reject_images`, và trong `segments[]`: `handoverPhotoUrl`,
     `handoverPhotoUrls[]`, `startPhotoUrl`, `guestSlipperPhotoUrl` (+ tên cũ `selfie…` nếu có).
   - Chỉ nhận link thuộc bucket `attendance` / `handover-images` (tách path từ public URL); path bắt đầu `office-evidence/` → bỏ qua.
   - **Không bao giờ đụng** item `REJECTED`, `commission_locked`, hoặc item chưa `DONE`.
   - Xoá file xong **giữ nguyên link trong DB** (giữ vết "đã chụp"); UI hiện "Ảnh đã hết hạn lưu" khi ảnh lỗi (mục 4).
   - File mồ côi (không còn đơn nào trỏ tới) **không xoá** ở bản này — an toàn trước, dọn sau nếu cần.

   Xoá bằng `storage.from(bucket).remove(batch)` lô 100. Ghi 1 dòng log tổng kết (số file, MB theo loại).
2. `vercel.json`: thêm `{ "path": "/api/cron/cleanup-photos", "schedule": "0 20 * * *" }` (03:00 VN).
3. **Migration** `supabase/migrations/<ts>_unschedule_broken_photo_jobs.sql`: `cron.unschedule` 2 job lỗi +
   `DROP FUNCTION IF EXISTS delete_old_attendance_photos()`. Cập nhật `TableInSupabase.md`.
4. **Xoá** `lib/services/StorageCleanupService.ts` + route `app/api/cron/cleanup-storage` (không có lịch, không ai gọi;
   nếu bị gọi sẽ xoá mọi ảnh gốc > 3 ngày, kể cả ảnh chấm công). Cột `commission_locked` có thật (default false) —
   đã ghi bổ sung vào `TableInSupabase.md`.

## 4. Link ảnh trong DB sau khi xoá

`KTVAttendance.photoUrl` vẫn trỏ tới file đã xoá → ảnh vỡ. **Không** xoá/sửa cột này (giữ vết "có chụp ảnh").
Màn nào hiện ảnh chấm công cũ (admin/employees, ktv-hub) cần `onError` → hiện "Ảnh đã hết hạn lưu (30 ngày)".
Kiểm tra lúc làm: grep `photoUrl` ở `app/admin`, `app/reception`, `app/ktv/attendance`.

## 5. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình | `app/ktv/attendance`, lịch sử đơn KTV (ảnh bàn giao) | `app/admin/employees`, `app/reception/ktv-hub`, `app/reception/handover` | bucket `attendance`, `KTVAttendance.photoUrl`, `BookingItems.segments/handover_images` | Ảnh hết hạn hiện thông báo; màn duyệt bàn giao chỉ có đơn PENDING nên không ảnh hưởng |
| Số liệu | Không ảnh hưởng — vì chỉ xoá file, không đụng giờ/tiền/chấm công | Không ảnh hưởng | — | Khớp |
| Realtime | Không ảnh hưởng | Không ảnh hưởng | — | — |
| Quyền | Route cron chỉ chạy với `CRON_SECRET` | | | Không lộ dữ liệu |

## 6. Kiểm thử

1. Chạy `?dry=1` trên production → đối chiếu với SQL: A ≈ 1.741 file; B chỉ gồm item DONE + APPROVED > 3 ngày.
2. Danh sách mẫu: A không có `handover`/`selfie_`/`reject_`; B không có `office-evidence/`, không có item PENDING/REJECTED.
3. Unit test: hàm lọc tên A (10 tên thật mỗi loại) và hàm gom link B (fixture segments thật, có `handoverPhotoUrls[]`).
4. Chạy thật 1 lượt → đếm lại bằng SQL; mở 1 màn admin có ảnh cũ để xem thông báo hết hạn.

## 7. Đã chốt (03/10)

- Chấm công 30 ngày · ảnh đơn 3 ngày khi item DONE, trừ REJECTED / commission_locked · `office-evidence` không xoá.
- Dry-run 03/10: chấm công 1.751 file / 240 MB · ảnh đơn 5.803 file / 269 MB → tối đa 1.000 file/đêm, dọn xong ~8 đêm.
- Lưu ý vận hành: sau 3 ngày, đơn đã duyệt **không còn ảnh** để đối chứng nếu KTV khiếu nại tiền tua muộn.
