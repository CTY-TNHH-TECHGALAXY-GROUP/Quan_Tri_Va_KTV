# Plan — Bàn giao phòng thất bại vì phân công cũ còn ACTIVE (ca T027, 04/10/2026 13:57)

> Mức 2: chạm RPC dispatch (`promote_next_assignment`, `dispatch_confirm_booking`) + handler `handleReleaseKTV`.
> Quy tắc mục 9 CLAUDE.md: mỗi lần 1 handler; test 4 ca bắt buộc.

## 1. Hiện tượng

App KTV, màn Bàn giao phòng, đủ 2/2 ảnh, bấm gửi → đỏ:
*"Không lưu được bàn giao: Chưa xác nhận được bàn giao. Tải lại trước khi thử lại…"*.
Ảnh đã upload lên Storage thành công; lỗi nằm ở RPC `ktv_release_work_atomic`.

## 2. Diễn biến thật (giờ VN, từ DB)

| Giờ | Sự kiện |
|---|---|
| 12:15 | Quầy điều phối đơn 002 → **tách** thành 002-A (T027: item1 + item2) và 002-B. Tạo 2 dòng `KtvAssignments` ACTIVE cho T027 (item1, item2) dưới booking **002-A**. |
| 12:21 | Quầy **chuyển item1 sang 002-B** cho KTV ngoài `EXT_34KCJ3`. `dispatch_confirm_booking` chạy cho booking **002-B** → chỉ dọn assignment có `booking_id = 002-B` → dòng T027/item1 (booking 002-A) **không được dọn, vẫn ACTIVE**. |
| 13:49 | T027 kết thúc item2 (đúng). |
| **13:57** | T027 gửi bàn giao 002-A. `ktv_release_work_atomic_base` chốt item2 → gọi `promote_next_assignment` → bước kiểm tra *"KTV already has an ACTIVE assignment"* thấy dòng T027/item1 còn ACTIVE (dù item1 đã là của KTV khác) → trả `success:false` → `RAISE EXCEPTION 'Promotion failed after release'` → **bàn giao thất bại**. |
| 14:00:41 | T027 tải lại app, mở đơn tiếp theo 003 → `handleGetBooking` đóng mọi assignment ACTIVE cũ (gồm dòng kẹt) và kích hoạt 003. |
| 14:03 | Gửi lại bàn giao → turn đã ở 003 nên bỏ qua bước promotion → **thành công**, `handover_status = PENDING`, 2 ảnh. |

Kết luận: không phải lỗi ảnh, không phải lỗi quyền. Là **dữ liệu kẹt**: assignment cũ của KTV trên item đã đổi sang booking khác / KTV khác không được đóng, và bước promotion coi nó là "đang bận".

## 3. Sửa

### 3.1 Tự chữa khi promotion (bịt ngay, bao cả dữ liệu cũ) — migration mới
`promote_next_assignment` bước 0 (self-healing) thêm: đóng (`COMPLETED`) mọi assignment ACTIVE/QUEUED/READY của KTV này mà
**item không còn ghi KTV đó** trong `BookingItems.technicianCodes` (so sánh không phân biệt hoa thường).
Đây là dòng "mồ côi" theo định nghĩa — đóng nó không ảnh hưởng ai (KTV khác đang làm item đó có dòng riêng).

### 3.2 Sửa gốc ở dispatch — cùng migration
`dispatch_confirm_booking` mục 0.5 "Clean up assignments for KTVs no longer in staff list": bỏ điều kiện `booking_id = p_booking_id`,
dọn theo **`booking_item_id = ANY(v_updated_item_ids)`** bất kể item đó trước đây thuộc booking (cha / đơn con) nào.
Giữ nguyên phần còn lại (TurnQueue về waiting nếu không còn gì, `v_was_working`).

### 3.3 Thông báo lỗi rõ hơn — `handleReleaseKTV.ts`
Khi RPC lỗi, nối thêm lý do kỹ thuật rút gọn (`error.message` / `data.error`) vào thông báo, VD:
*"Chưa xác nhận được bàn giao (hệ thống: Promotion failed…). Thử lại hoặc Bỏ qua để ghi nợ."* — để lần sau quầy/IT đọc là biết ngay.

Không đổi: luật ảnh, hạn mức bỏ qua, nợ phòng, tiền tua, giờ.

## 4. Bảng hệ quả (CLAUDE.md §13) — sự kiện "đóng assignment mồ côi"

| Khía cạnh | Kết quả |
|---|---|
| Tiền tua / giờ / lượt tua / thưởng | **Không đổi** — assignment không phải nguồn tính tiền (sổ cái đọc `segments`) |
| Hàng đợi TurnQueue | Chỉ đổi theo luồng promotion sẵn có; dòng mồ côi đóng → KTV được xếp đơn kế tiếp đúng |
| Màn app KTV | Bàn giao thành công ở lần bấm đầu; "Nhận đơn tiếp theo" hiện đúng |
| Thẻ Kanban / quầy | Không đổi |
| Lịch sử / nhật ký | `updated_at` của dòng mồ côi; không ghi log mới |

## 5. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Luồng | Bàn giao, nhận đơn tiếp | Điều phối lại / tách đơn / đổi KTV | RPC `promote_next_assignment`, `dispatch_confirm_booking`, bảng `KtvAssignments` | Sửa RPC, 2 phía tự hưởng |
| Số liệu tiền/giờ | Không | Không | — | Không đụng |
| Realtime | Không đổi kênh | Không đổi | — | — |

## 6. Kiểm thử (bắt buộc §9.8) — chạy trong transaction `BEGIN … ROLLBACK` trên DB thật, không để lại vết
1. **1KTV-1DV**: điều phối → kết thúc → bàn giao → promotion OK.
2. **1KTV-2DV gộp**: 2 item cùng KTV → bàn giao 1 lần.
3. **2KTV-1DV** (4 tay): mỗi KTV bàn giao riêng, không đóng nhầm dòng của người kia.
4. **Ca đêm** qua 00:00: `business_date` đúng, promotion đúng ngày.
5. **Tái hiện ca T027**: tách đơn → chuyển item sang đơn con khác / KTV khác → KTV cũ bàn giao → phải thành công; dòng mồ côi `COMPLETED`.
6. Dữ liệu hiện tại: đếm assignment ACTIVE/QUEUED mà KTV không còn trong `technicianCodes` (read-only) → báo số trước khi deploy.

## 7. Deploy
- Migration SQL áp lên Supabase (Mức 2, xin lệnh riêng) — có hiệu lực ngay cho cả production và preview vì dùng chung DB.
- Code `handleReleaseKTV.ts`: commit phase1 → cherry-pick `main`.
