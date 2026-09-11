# Plan: Thời lượng dịch vụ dùng khi đổi KTV — một nguồn cho modal và máy chủ

**Mức:** 2 — chạm `lib/services/BookingItemPauseService.ts` (quyết định số phút người vào thay được trả).
**Lập:** 2026-09-11 · **Trạng thái:** CHỜ DUYỆT — cần chốt câu hỏi ở mục 1.
**Bảng tra:** `plans/nghiep_vu_tam_dung_doi_huy.md`, cột **VT** dòng 1–2.

---

## 1. Câu hỏi phải chốt

**Dịch vụ lưu thời lượng 0 (cắt tóc, cạo/tỉa râu, gói cắt tóc 1–3, phòng riêng) bị đổi KTV thì tính thời lượng bao nhiêu?**

Hiện máy chủ dùng `Services.duration || 60` → coi là **60 phút**: người vào thay một ca cắt tóc được trả `60 − phút người cũ đã làm`. Có thể không đúng thực tế của dịch vụ cắt tóc.

- (A) Giữ 60 như hiện tại.
- (B) Dùng số khác cho nhóm này (VD thời lượng thực tế của gói).
- (C) Bắt quầy **gán tay** khi đổi KTV ở dịch vụ thời lượng 0 — không cho "Làm phần còn lại".

## 2. Lỗi kỹ thuật — nên sửa dù chọn gì ở mục 1

Hai nơi đọc thời lượng dịch vụ từ hai nguồn khác nhau:

| Nơi | Đọc | Kết quả |
|---|---|---|
| Bảng điều phối + modal đổi KTV | `options.vipDuration` → `options.duration` → `Services.duration` (`app/reception/dispatch/actions.ts:428`) | số quầy nhìn thấy |
| `swapKtvOnPausedItem` (máy chủ) | chỉ `Services.duration || 60` (`BookingItemPauseService.ts:323`) | số thực trả |

Đo 11/09: 122 dịch vụ có thời lượng riêng trong `options`, **2 lệch** (`11NDK-009-02062026-vip1`: quầy thấy 70p, máy chủ tính 120p; `11NDK-005-07062026-item1`: 90p vs 120p).

**Sửa:** gom thành một hàm dùng chung `serviceDurationOf(item, serviceDuration)` trong `lib/services/*` (`CLAUDE.md` 4.2), thứ tự `options.vipDuration` → `options.duration` → `Services.duration` → mặc định theo mục 1. Bảng điều phối và `swapKtvOnPausedItem` cùng gọi.

## 3. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | đồng hồ người vào thay (đọc `seg.duration`) | modal đổi KTV, thẻ Kanban | `swapKtvOnPausedItem`, `getDispatchData` | Sửa |
| Số liệu | tiền/giờ người vào thay = `customCommissionDuration` do số này quyết | modal hiện "KTV mới nhận X phút" | hàm mới | Hiện lệch 2/122 → sau sửa khớp |
| Realtime | không đổi | không đổi | `BookingItems` | Không ảnh hưởng |
| Quyền xem | không đổi | không đổi | | Không ảnh hưởng |

## 4. Kiểm

Mở rộng `scripts/qa/qa_swap_ktv_e2e.ts`: dịch vụ thường, dịch vụ VIP có `vipDuration`, dịch vụ thời lượng 0. Mỗi ca in: số modal hiện · số máy chủ ghi vào `customCommissionDuration` — phải bằng nhau.
