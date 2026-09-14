# Sửa lỗi không cho phép điều chỉnh thời gian và lỗi gộp đơn sai khi thêm dịch vụ

## 1. Lỗi không cho phép điều chỉnh thời gian (Dispatch Board)

### Nguyên nhân
Khi admin thêm dịch vụ mới cho KTV trong 1 đơn và chọn KTV, hệ thống sẽ tự động tính toán thời gian nối tiếp một cách chính xác. Tuy nhiên, khi admin cố gắng sửa thủ công thời gian này, hệ thống lại lập tức khôi phục (revert) về thời gian nối tiếp. 

Lỗi nằm ở hàm `handleChange` trong component `DispatchStaffRow.tsx`:
Thay vì chỉ gửi lên những thay đổi (patch), hàm này gửi **toàn bộ dữ liệu của KTV** lên hàm `updateStaffRow` ở `page.tsx`. Vì trong dữ liệu gửi lên luôn có trường `ktvId`, hàm `updateStaffRow` luôn lầm tưởng rằng "KTV vừa được đổi", dẫn đến việc gọi lại hàm `recalculateAllTimes` (tự động nối giờ) ở mọi thao tác sửa đổi, đè bẹp những thay đổi thời gian thủ công của người dùng.

### Giải pháp
- Đã sửa `DispatchStaffRow.tsx` để hàm `handleChange` chỉ truyền lên đúng đối tượng `patch` (những gì thực sự thay đổi) thay vì `{ ...row, ...patch }`. Component cha đã tự động merge dữ liệu nên việc này vừa sạch code vừa khắc phục được lỗi.

---

## 2. Lỗi gộp đơn (Merge) sai khi KTV đã làm xong dịch vụ trước đó

### Nguyên nhân
Tại App KTV, logic gộp chặng (`shouldMerge`) đang quét tất cả các dịch vụ được gán cho KTV trong 1 đơn hàng. Nếu có > 1 dịch vụ, hệ thống luôn gộp chúng thành 1 chặng liên tục (1 timer đếm ngược tổng).
Tuy nhiên, hệ thống lại thiếu 2 điều kiện quan trọng để quyết định việc gộp:
1. **Kiểm tra cùng phòng**: Nếu KTV làm 2 dịch vụ ở 2 phòng khác nhau, không được gộp.
2. **Kiểm tra trạng thái hoàn thành**: Nếu dịch vụ số 1 đã **Hoàn thành** (KTV bấm kết thúc), thì khi Lễ tân thêm dịch vụ số 2 vào, hệ thống KHÔNG được gộp chúng với nhau. Vì lúc này dịch vụ 1 đã đóng, nếu gộp lại timer sẽ lấy tổng thời gian trừ đi và chạy lại từ đầu, gây loạn hệ thống.

### Giải pháp
- Đã sửa file `KTVDashboard.logic.ts` tại 4 vị trí tính toán biến `shouldMerge`.
- Bổ sung thêm điều kiện bắt buộc:
  - `uniqueRoomIds.size === 1`: Các chặng phải diễn ra trong cùng 1 phòng.
  - `!hasFinishedSegment`: Không có bất kỳ chặng nào trong nhóm đã bị kết thúc (`actualEndTime`).
- Với cách xử lý này, khi bạn thêm 1 dịch vụ mới sau khi KTV A đã làm xong dịch vụ trước đó, hệ thống sẽ tách riêng dịch vụ mới thành "Chặng 2" độc lập và KTV sẽ thấy nút "Bắt đầu" để bấm làm dịch vụ mới bình thường.
