# TỪ ĐIỂN CÁC SỰ KIỆN TƯƠNG TÁC (KTV INTERACTION EVENTS)

Tài liệu này ghi chú lại các Event Type (mã sự kiện) chuẩn xác được phép gửi từ KTV Dashboard lên server để tránh lỗi `400 Bad Request` ("Lỗi gửi yêu cầu").

## 1. Bảng Event Type cho KTV Interaction (`/api/ktv/interaction`)

Áp dụng cho API `POST /api/ktv/interaction`. Các type này đã được định nghĩa cứng trong `KtvInteractionSchema` (`lib/schemas/ktv.schema.ts`).

| Nút bấm trên UI | Mã gửi lên Server (Type) | Ý nghĩa / Tin nhắn đổ về Lễ tân |
| --- | --- | --- |
| **KHÁCH VỀ SỚM** | `EARLY_EXIT` | KH đang xuống, chuẩn bị đón khách nhé quầy |
| **GỌI NƯỚC** | `WATER` | Yêu cầu mang nước/trà lên Phòng X |
| **MUA THÊM DV** | `BUY_MORE` | Khách muốn làm thêm, cần lễ tân tư vấn ở Phòng X |
| **HỖ TRỢ** | `SUPPORT` | Báo các vấn đề kỹ thuật hoặc thiếu đồ dùng ở Phòng X |
| **BÁO ĐỘNG KHẨN CẤP** | `EMERGENCY` | 🚨 KHẨN CẤP: Sự cố lớn tại Phòng X! |

> ⚠️ **Lưu ý Quan Trọng**: Tuyệt đối không dùng các mã tự chế như `ORDER_DRINK` hay `ASK_SUPPORT` vì sẽ bị Zod Schema chặn lại gây lỗi.

## 2. Các Action khác cho KTV Booking (`/api/ktv/booking`)

Áp dụng khi dùng `PATCH /api/ktv/booking` để cập nhật trạng thái đơn hàng.

- `START_TIMER`: KTV bắt đầu bấm giờ (bắt đầu chặng 1).
- `NEXT_SEGMENT`: KTV hoàn thành chặng hiện tại và chuyển sang chặng tiếp theo (dành cho đơn Gộp dịch vụ).
- `RELEASE_KTV`: Trả KTV về trạng thái rảnh rỗi (sau khi hoàn thành dọn dẹp và bàn giao).
- Trạng thái truyền theo (`status`): `IN_PROGRESS`, `CLEANING`, `FEEDBACK`.

## 3. Broadcast Realtime Events (Supabase Channels)

- `KTV_STARTED`: Khi KTV bấm nút Bắt Đầu. Báo hiệu cho Quầy Lễ Tân đổi màu trạng thái thành ĐANG LÀM.
- `KTV_FINISHED`: Khi KTV đã làm xong dịch vụ cuối cùng và chuyển sang dọn dẹp.
- `CUSTOMER_REQUEST_SERVICE`: Khách hàng bấm gọi mua thêm từ màn hình của khách (Giao diện `wrb-noi-bo-dev`).

---
*(Tài liệu này được tạo ra để các agent AI và Developer cùng đồng bộ trong quá trình nâng cấp, bảo trì codebase sau này).*
