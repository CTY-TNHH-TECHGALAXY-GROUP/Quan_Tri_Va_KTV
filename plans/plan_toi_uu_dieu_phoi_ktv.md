# Kế hoạch tối ưu hóa Điều phối và Luồng công việc KTV

## 1. Tối ưu hóa Phiếu In Nhanh (Quick Print)
- **Mục tiêu**: Đảm bảo phiếu in cho KTV có đầy đủ thông tin để phục vụ khách tốt nhất.
- **Thay đổi**:
    - Thêm **Mã đơn hàng** (Bill Code) vào tiêu đề phiếu.
    - Hiển thị **Yêu cầu giới tính** (Gender Request) của khách hàng.
    - Đảm bảo **Mô tả dịch vụ** (Service Description) và **Ghi chú Admin** được hiển thị rõ ràng.
- **File ảnh hưởng**: 
    - `app/reception/dispatch/_components/QuickDispatchTable.tsx`
    - `app/reception/dispatch/_components/DispatchStaffRow.tsx`

## 2. Hoàn thiện nút "Nhận đơn tiếp theo" (Fast Track)
- **Mục tiêu**: Cho phép KTV bỏ qua bước dọn phòng (nếu có đồng nghiệp hỗ trợ) để nhận ngay khách mới đang chờ.
- **Giải pháp**:
    - Sử dụng `CustomEvent` để truyền `nextBookingId` khi KTV bấm nút "Nhận đơn & Chuyển ngay".
    - Cập nhật logic `handleFastTrack` trong `KTVDashboard.logic.ts` để gán `targetBookingId` và kích hoạt fetch đơn mới ngay lập tức (không chờ polling 5s).
- **File ảnh hưởng**:
    - `app/ktv/dashboard/page.tsx`
    - `app/ktv/dashboard/KTVDashboard.logic.ts`

## 3. Logic Giải phóng phòng (Room Release)
- **Mục tiêu**: Phòng chỉ được coi là "Trống" khi đã dọn dẹp xong hoặc KTV đã hoàn tất bàn giao.
- **Thay đổi**:
    - Điều chỉnh hàm `recomputeBookingStatus` trong `lib/dispatch-status.ts`.
    - Booking Status sẽ giữ ở `CLEANING` nếu có bất kỳ item nào đang dọn dẹp.
    - Chỉ chuyển sang `DONE` (giải phóng giường) khi tất cả items đã `FEEDBACK` hoặc `DONE`.
- **File ảnh hưởng**:
    - `lib/dispatch-status.ts`

## 4. Kiểm tra lỗi Auto-complete
- **Mục tiêu**: Ngăn chặn đơn hàng tự nhảy sang trạng thái hoàn tất mà không qua các bước kiểm soát của KTV.
- **Giải pháp**: 
    - Đảm bảo `handleFinishTimer` trong `KTVDashboard.logic.ts` luôn chuyển hướng KTV về màn hình `REVIEW` (Đánh giá).
    - Kiểm tra logic API `PATCH /api/ktv/booking` để không tự động set status `DONE` nếu chưa đủ điều kiện.

## 5. Các bước thực hiện
1. Cập nhật giao diện phiếu in nhanh trong `QuickDispatchTable` và `DispatchStaffRow`.
2. Sửa logic Event `KTV_FAST_TRACK` để truyền ID đơn tiếp theo.
3. Cập nhật `recomputeBookingStatus` để quản lý trạng thái phòng chính xác hơn.
4. Kiểm tra thực tế luồng chạy của KTV khi hết giờ.

---
**AI Sparring Partner Note**: Việc giải phóng phòng ngay khi KTV bấm "Đã dọn" (FEEDBACK) là hợp lý vì lúc đó phòng đã sẵn sàng (đã dọn xong). Tuy nhiên, nếu khách chưa thanh toán thì quầy vẫn cần treo đơn. Tôi đã thiết kế trạng thái `DONE` chỉ được kích hoạt khi quầy xác nhận hoặc khách đã đánh giá xong (rating exists).
