# Kế Hoạch Triển Khai: Bàn Giao Hình Ảnh & Đánh Giá Nội Bộ (V5 — Bản Chốt Cuối Cùng)

---

## 1. LUỒNG BÀN GIAO HÌNH ẢNH (KTV APP)

**A. Giao diện Chụp Ảnh Bàn Giao (Theo Từng Mục):**
- Checklist hiển thị dạng **danh sách từng mục** (VD: "Máy lạnh", "Bồn gội đầu").
- Mỗi mục có **slot ảnh riêng**, KTV bấm vào để chụp/chọn **nhiều ảnh**.
- Badge số ảnh đã chụp (`📸 2 ảnh`). Mục chưa có ảnh → cảnh báo đỏ.
- **Lưu trữ ảnh:** Upload lên **Supabase Storage** bucket `handover-images`, lưu URL vào `handover_images` (JSONB) của `BookingItems`:
```json
{
  "Máy lạnh": ["url1.jpg", "url2.jpg"],
  "Bồn gội đầu": ["url3.jpg"]
}
```
- **🛡️ Upload an toàn:** Nút "Gửi Bàn giao" chỉ bật khi **100% ảnh đã upload thành công**. Mất mạng giữa chừng → hiện lỗi đỏ để KTV thử lại.

**B. Tính năng Nút "BỎ QUA":**
- API `/api/ktv/handover/check-next` kiểm tra KTV có đơn tiếp theo không.
- **CÓ đơn tiếp theo:** Nút "Bỏ qua" hiện lên.
- **KHÔNG CÓ đơn tiếp theo:** Nút ẩn → bắt buộc bàn giao.
- **🛡️ Giới hạn nợ tối đa 2 đơn:** Nợ quá 2 đơn → ẩn nút "Bỏ qua" luôn dù có đơn mới. Config: `max_handover_skip = 2`.

**C. Module "Nhắc Nhở Nợ Bàn Giao" (Dashboard):**
- KTV bỏ qua → Dashboard hiện chấm than đỏ: `[!] Bạn có 1 đơn chưa bàn giao (Phòng VIP 1)`.
- Bấm vào → mở lại popup Bàn giao đơn cũ.
- **Tan Ca mà còn nợ:** Tiền tua đơn đó bị **PENDING vĩnh viễn** cho đến khi nộp ảnh và được duyệt.
- **🛡️ Chặn Tan Ca nếu nợ nghiêm trọng:** Khi KTV bấm nút Tan Ca, nếu còn nợ bàn giao → popup cảnh báo: *"Bạn còn X đơn chưa bàn giao. Tiền tua các đơn này sẽ bị giam. Bạn có chắc muốn tan ca?"*. KTV phải xác nhận mới được tan ca (tránh "quên" thật sự).

---

## 2. CHECKLIST BÀN GIAO ĐỘNG (MAP CỨNG THEO MÃ DỊCH VỤ & CATEGORY)

Map cứng bằng **Mã Dịch Vụ (code)** và **Category** — không dùng Regex.

**Cấu hình (SystemConfigs, key: `handover_service_mapping`):**

```json
{
   "GOI_DAU": {
       "items": ["Máy nước nóng", "Bồn gội đầu"],
       "apply_categories": ["Hair Wash"],
       "apply_services": ["NHS0607", "NHS0705", "NHS0706"]
   },
   "FACIAL": {
       "items": ["Ống hút mụn", "Máy Facial", "Khăn lau mặt"],
       "apply_categories": ["Facial"],
       "apply_services": ["NHS0607"]
   },
   "BAO_GOT": {
       "items": ["Đồ nghề chà gót", "Chà gót chân"],
       "apply_categories": ["Heel Skin Shave"],
       "apply_services": ["NHS0706"]
   }
}
```

**Logic (Tính riêng cho từng KTV theo Dịch Vụ họ làm):**
1. KTV chỉ bàn giao cho **chính Dịch vụ** và **Phòng** mà họ phụ trách.
2. Lấy checklist Phòng + soi Mã dịch vụ / Category vào cấu hình → cộng gộp, xóa trùng.
3. VD: KTV A làm Bào Gót ở phòng T → `[Ghế làm, Lavabo]` + `[Đồ nghề chà gót, Chà gót chân]`.

**🛡️ 2 KTV cùng 1 phòng:**
- **Đồ nghề dịch vụ:** Mỗi KTV tự bàn giao đồ của mình.
- **Checklist phòng:** Chỉ hiện cho **KTV cuối cùng** hoàn thành trong phòng đó. Logic: check `BookingItems` xem còn KTV nào chưa xong trong phòng đó không.

---

## 3. LUỒNG XỬ LÝ 3 OPTION TỪ CHỐI CỦA QUẦY (LỄ TÂN)

Áp dụng cho **cả 3 loại KTV (A, B, C)**.

### Option 1: Bắt dọn lại (Cảnh cáo)
- Đơn bị đẩy ngược trạng thái CLEANING.
- KTV nhận Push: *"Hình ảnh bàn giao không đạt. Vui lòng dọn lại. (Lưu ý: Nếu lặp lại sẽ có biện pháp phạt tiền)"*.
- Tiền tua tạm PENDING, cộng lại khi hình được duyệt.
- **🛡️ Chống lạm dụng:** Tối đa **2 lần** dọn lại / 1 đơn. Vượt quá → chỉ còn Option 2 hoặc 3. Ghi log `handover_reject_count` để Admin kiểm toán. Config: `max_handover_reject = 2`.

### Option 2: Trừ tiền tua thẳng (DEDUCT)
- Phạt tiền, không bắt dọn lại.
- Số tiền phạt đọc từ SystemConfigs `handover_deduction_amount` (mặc định 50,000đ). Có thể cấu hình theo `TYPE_A/B/C`.
- KTV vẫn nhận tiền tua nhưng hệ thống sinh lệnh Trừ (WalletAdjustment -50k).
- **🛡️ Xác nhận 2 bước:** Popup: *"Xác nhận TRỪ 50,000đ tiền tua của KTV [Tên]?"* + bắt nhập lý do.

### Option 3: Giam/Tước tiền tua (CONFISCATE)
- Lỗi nghiêm trọng hoặc trốn bàn giao.
- `commission_locked = true` trên `BookingItems`.
- Tiền tua = `0đ` trong Lịch sử. Số phút **KHÔNG cộng KPI 80 tiếng** (KTV B).
- **🛡️ Xác nhận 2 bước:** Popup cảnh báo đỏ + bắt nhập lý do. Admin có thể **mở khóa** từ trang quản trị nếu bấm nhầm (audit trail).

---

## 4. CƠ CHẾ TỰ ĐỘNG DUYỆT (AUTO-APPROVE)

- Sau **15 phút** kể từ khi KTV nộp ảnh mà Quầy không phản hồi → hệ thống **tự động DUYỆT** (`handover_status = 'APPROVED'`).
- Triển khai: pg_cron hoặc Edge Function chạy mỗi 5 phút quét đơn PENDING quá hạn.
- Config: `reception_auto_approve_minutes = 15`.

---

## 5. TỰ ĐỘNG XÓA ẢNH CŨ (DỌN DẸP STORAGE)

Ảnh bàn giao và ảnh check-in (selfie) chiếm dung lượng storage rất nhanh. Hệ thống sẽ tự động xóa ảnh cũ sau một khoảng thời gian cấu hình được.

**A. Các bucket cần dọn:**

| Bucket | Nội dung | Hiện đang lưu |
|--------|----------|---------------|
| `handover-images` | Ảnh bàn giao phòng/đồ nghề | **Mới tạo** |
| `attendance` | Ảnh selfie check-in KTV + ảnh bắt đầu dịch vụ | Đang hoạt động |

**B. Cơ chế Tự động Xóa:**
- **Cron Job** (pg_cron hoặc Edge Function) chạy **mỗi ngày 1 lần** vào lúc 3:00 AM (giờ vắng khách).
- Quét tất cả file trong 2 bucket trên có `created_at` > X ngày → **xóa file khỏi Storage**.
- Đồng thời clear URL trong Database:
  - `BookingItems.handover_images` → set về `'{}'::jsonb`
  - `BookingItems.segments[].startPhotoUrl` → set về `null`
- **Config:** SystemConfigs key `storage_cleanup_days = 3` (mặc định 3 ngày, Quản lý có thể chỉnh lên 7, 14 ngày tùy nhu cầu kiểm toán).

**C. Logic An toàn:**
- **KHÔNG xóa** ảnh của các đơn có `handover_status = 'PENDING'` hoặc `'REJECTED'` (đang chờ duyệt / đang tranh chấp).
- **KHÔNG xóa** ảnh của các đơn có `commission_locked = true` (đang bị giam tiền, cần giữ làm bằng chứng).
- Chỉ xóa ảnh của đơn đã `APPROVED` hoặc `DONE` quá X ngày.

---

## 6. TÍNH NĂNG: ĐÁNH GIÁ NỘI BỘ (QUẦY ⇄ KTV)

- **Bảng `InternalReviews`:** Lưu đánh giá nội bộ (booking_id, reviewer, target, rating 1-5, comment).
- **Lễ Tân (Kanban):** Nút "Đánh giá KTV" cho từng nhân sự trong đơn.
- **KTV Dashboard:** Nút "Đánh giá Lễ Tân" ở phần lịch sử.
- Tách biệt hoàn toàn khỏi đánh giá Khách hàng.
- **🛡️ Chỉ đánh giá 1 lần / đơn:** Constraint `UNIQUE(booking_id, reviewer_id, target_id)` ngăn chặn đánh giá trùng. Nếu bấm lại → hiện kết quả cũ (read-only).

---

## 7. THAY ĐỔI KIẾN TRÚC & MIGRATION

### A. Migration SQL (`20260727_handover_v5.sql`):
- Tạo bảng `InternalReviews`.
- Cập nhật bảng `BookingItems`:
  - `handover_skipped BOOLEAN DEFAULT false`
  - `handover_reject_action TEXT`
  - `handover_reject_count INTEGER DEFAULT 0`
  - `commission_locked BOOLEAN DEFAULT false`
- Tạo Supabase Storage bucket `handover-images`.
- Thêm SystemConfigs keys:

| Key | Mặc định | Mô tả |
|-----|----------|-------|
| `handover_service_mapping` | JSON | Map cứng checklist theo mã DV & Category |
| `handover_deduction_amount` | `50000` | Số tiền phạt Option 2 |
| `max_handover_skip` | `2` | Số đơn nợ bàn giao tối đa |
| `max_handover_reject` | `2` | Số lần dọn lại tối đa / đơn |
| `storage_cleanup_days` | `3` | Số ngày giữ ảnh trước khi xóa |

### B. Tạo `HandoverService.ts` (S.O.L.I.D):
- `generateDynamicChecklist(roomId, serviceCode, category, bookingId)` — Map cứng + KTV cuối bàn giao phòng.
- `submitHandover(itemId, images)` — Nộp ảnh.
- `skipHandover(itemId, ktvCode)` — Nợ ảnh + kiểm tra giới hạn.
- `rejectHandover(itemId, optionType, reason)` — 3 option + giới hạn reject.
- `getPendingHandovers(ktvCode)` — Danh sách đơn nợ.
- `autoApproveExpired()` — Cron duyệt đơn quá 15 phút.

### C. Tạo `StorageCleanupService.ts` (S.O.L.I.D):
- `cleanupExpiredImages()` — Cron xóa ảnh quá hạn (gọi mỗi ngày 3AM).
- Quét 2 bucket: `handover-images` và `attendance`.
- Bỏ qua đơn PENDING/REJECTED/commission_locked.
- Clear URL trong DB tương ứng.

### D. Cập nhật `KtvCommissionService.ts` & `KtvWalletService.ts`:
- Lọc bỏ `BookingItems` có `commission_locked = true` khỏi tính tiền tua, tiền tip, KPI 80 tiếng.

---

## 8. TỔNG KẾT CÁC CƠ CHẾ BẢO VỆ (9/9)

| # | Lỗ hổng | Giải pháp | Config |
|---|---------|-----------|--------|
| 1 | KTV nợ chồng nợ | Tối đa 2 đơn nợ, vượt → ẩn nút Bỏ qua | `max_handover_skip = 2` |
| 2 | Quầy quên duyệt | Auto-approve sau 15 phút | `reception_auto_approve_minutes = 15` |
| 3 | Quầy reject lạm dụng | Tối đa 2 lần dọn lại, sau đó chỉ Option 2/3 | `max_handover_reject = 2` |
| 4 | 2 KTV cùng phòng | Chỉ KTV cuối mới bàn giao phòng | Logic `generateDynamicChecklist` |
| 5 | Bấm nhầm Option 2/3 | Popup xác nhận 2 bước + nhập lý do + Admin mở khóa | UI + `commission_locked` |
| 6 | Upload ảnh dở dang | Nút Gửi chỉ bật khi 100% upload xong | Frontend validation |
| 7 | Storage phình to | Cron xóa ảnh quá 3 ngày (bỏ qua đơn tranh chấp) | `storage_cleanup_days = 3` |
| 8 | KTV tan ca quên nợ | Popup cảnh báo khi bấm Tan Ca nếu còn nợ | UI chặn + xác nhận |
| 9 | Đánh giá nội bộ trùng | UNIQUE constraint trong DB | Migration SQL |

> [!IMPORTANT]
> Đây là bản V5 đã vá tổng cộng 9 lỗ hổng. Tất cả config đều có thể chỉnh sửa từ trang Cài Đặt mà không cần đổi code. Nếu bạn duyệt, vui lòng báo `Tiến hành / Proceed`!
