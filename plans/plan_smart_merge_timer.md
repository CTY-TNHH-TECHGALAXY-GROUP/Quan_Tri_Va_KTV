# 🚀 Kế Hoạch Triển Khai: Smart Merge (Cộng Dồn Thông Minh) cho KTV Timer

## 1. Phân Tích Vấn Đề (Vấn đề "Nuốt Giờ" khi gộp dịch vụ)
Khi áp dụng gộp 2 dịch vụ (VD: DV1 60 phút, DV2 55 phút), thuật toán cũ sẽ lấy **Thời điểm bắt đầu của DV1** làm gốc, và đếm ngược tổng 115 phút.

**Vấn đề:** 
Nếu Lễ tân gắn thêm DV2 vào lúc DV1 đã kết thúc (hoặc đang làm lố giờ), ví dụ: lúc đã trôi qua 106 phút. 
- Hệ thống sẽ lấy: `115 phút (tổng) - 106 phút (đã trôi qua) = 9 phút còn lại`.
- Hậu quả: DV2 (55 phút) vừa được thêm vào nhưng KTV chỉ còn vỏn vẹn 9 phút để thực hiện. Thời gian hiển thị sẽ là `08:05` như trong ảnh bạn gặp phải! Thời gian lố của DV1 đã "nuốt chửng" thời lượng của DV2.

## 2. Giải Pháp: Smart Merge (Sequential Time Allocation)
Dựa trên quyết định của bạn là chấp nhận nhược điểm về hoa hồng/audit để đổi lấy **sự tinh gọn của UI**, mình sẽ thiết kế lại công thức đếm ngược ngầm bên dưới mà **vẫn giữ nguyên giao diện 1 khối Gộp 115 phút**.

**Công thức Smart Merge:**
Thay vì dùng 1 mốc thời gian bắt đầu duy nhất, hệ thống sẽ mô phỏng lại dòng thời gian của các dịch vụ nối tiếp nhau, tính đến cả các khoảng "Gap" (thời gian chết giữa 2 dịch vụ nếu Lễ tân thêm vào muộn).

- **Chặng 1 (DV1):** Bắt đầu lúc `10:27` -> Dự kiến kết thúc `11:27`.
- **Chặng 2 (DV2):** Thời điểm bắt đầu của DV2 sẽ tự động được điều chỉnh là mốc **LỚN NHẤT** giữa *(Giờ kết thúc DV1)* và *(Giờ Lễ tân gắn DV2)*.
  - Nếu Lễ tân gắn DV2 lúc `10:50` (sớm): DV2 sẽ bắt đầu tính từ `11:27`.
  - Nếu Lễ tân gắn DV2 lúc `12:00` (muộn): DV2 sẽ bắt đầu tính từ `12:00`.
- **Tổng Thời Gian Còn Lại = Giờ kết thúc DV cuối cùng - Giờ hiện tại.**

Với công thức này, DV2 sẽ **luôn luôn** được cấp đủ 100% thời lượng (55 phút), không bao giờ bị DV1 "nuốt" mất thời gian nữa. Giao diện vẫn hiển thị đếm ngược tổng cho KTV rất gọn gàng.

## 3. Các Thay Đổi Cụ Thể (Proposed Changes)

### [MODIFY] `app/ktv/dashboard/KTVDashboard.logic.ts`
- Cập nhật hàm `recalcTimerFromServer`.
- Khi `isMergeSync === true`, thêm logic tính toán `currentVirtualEndMs` để tìm ra thời điểm kết thúc thực tế của chuỗi dịch vụ được gộp.
- Tự động điều chỉnh biến `activeSegStartTime` ảo sao cho phương trình `(Now - Start) / 1000` khớp chính xác với `Tổng thời gian - Thời gian còn lại Smart Merge`.
- Viết thêm hàm helper `parseTime` nội bộ để xử lý linh hoạt thời gian dispatch từ Lễ tân (`HH:mm`) hoặc ISO String.

## 4. User Review Required
> [!IMPORTANT]
> - Phương án này giữ nguyên UI hiện tại (hiển thị gộp 1 khối thời gian lớn), KTV không cần bấm chuyển chặng.
> - Bằng cách này, nếu KTV làm lố giờ DV1, họ phải chịu trách nhiệm (thời gian lố không được bù), NHƯNG nếu có khoảng nghỉ (Gap) giữa 2 dịch vụ do khách mua thêm muộn, KTV sẽ không bị trừ lẹm vào thời lượng của dịch vụ mới mua.
> - Vui lòng ĐỒNG Ý / DUYỆT để mình tiến hành viết code nhé!
