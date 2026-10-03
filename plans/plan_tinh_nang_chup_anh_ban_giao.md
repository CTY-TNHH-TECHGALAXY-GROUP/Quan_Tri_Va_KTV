# Kế Hoạch Chuẩn Hóa Chụp Ảnh Bàn Giao (Handover Checklist)

Hệ thống hiện tại đã có giao diện hỗ trợ chụp ảnh theo từng mục (Checklist), tuy nhiên vì trong Database các phòng (Rooms) chưa được cấu hình dữ liệu cho cột `handover_checklist`, nên hệ thống đang tự động rơi vào **Chế độ chụp tự do** (cho phép up ảnh lung tung, không định danh được ảnh nào là của khu vực nào).

Để giải quyết triệt để vấn đề "dư thì không dư mà sót thì hay bị sót" như bạn miêu tả, mình đề xuất kế hoạch xử lý sau:

## User Review Required
> [!IMPORTANT]
> **Danh sách các mục cần chụp ảnh mặc định:**
> Dưới đây là danh sách các mục (Checklist) mặc định mình dự kiến sẽ áp dụng cho mọi phòng nếu phòng đó chưa được cài đặt cấu hình riêng. Bạn xem các mục này đã phù hợp với quy chuẩn cơ sở chưa nhé:
> 1. Tổng quan phòng
> 2. Giường & Khăn setup
> 3. Bồn rửa & Dụng cụ
> 4. Máy lạnh & Tinh dầu
> 5. Sàn nhà & Thùng rác
> *(Nếu bạn muốn đổi tên hoặc thêm/bớt mục nào thì cứ nhắn lại cho mình nhé).*

## Proposed Changes

### Thay đổi Logic Frontend
Sẽ áp dụng một danh sách `DEFAULT_HANDOVER_CHECKLIST` để chặn hoàn toàn việc chụp ảnh tự do nếu phòng không có cấu hình.

#### [MODIFY] `app/ktv/dashboard/KTVDashboard.logic.ts`
- Thêm biến hằng số `DEFAULT_HANDOVER_CHECKLIST` chứa các mục cơ bản.
- Cập nhật chỗ lấy checklist từ `booking` để sử dụng mảng mặc định nếu Database trả về mảng rỗng.

#### [MODIFY] `app/ktv/dashboard/page.tsx`
- Sửa lại dòng: `const checklist: string[] = booking?.handoverChecklist || [];`
  Thành: `const checklist: string[] = (booking?.handoverChecklist?.length > 0) ? booking.handoverChecklist : DEFAULT_HANDOVER_CHECKLIST;`

### Quản lý của Lễ Tân (Review Handover)
Hiện tại, khi Lễ tân duyệt ảnh bàn giao (`ReviewHandoverModal.tsx`), hệ thống đã hiển thị tên của các bức ảnh tương ứng với tên mục (VD: "Tổng quan phòng", "Giường & Khăn setup", v.v.). Việc áp dụng checklist mặc định này sẽ lập tức giúp Lễ tân nhìn rõ bức ảnh đó KTV đang chụp cho khu vực nào.

## Verification Plan
### Manual Verification
1. Sau khi cập nhật, truy cập vào màn hình App KTV (Dashboard).
2. Chạy xong 1 tua dịch vụ và đi tới bước **Dọn dẹp phòng (Handover)**.
3. KTV sẽ thấy rõ 5 mục cần chụp (Tổng quan phòng, Giường & Khăn, ...).
4. Phải chụp hoặc tải ảnh lên cho đủ 5 ô này thì mới bấm được nút "Xong & Sẵn sàng đón khách".
5. Qua màn hình Lễ tân (Dispatch) -> Bấm Duyệt bàn giao -> Kiểm tra xem các ảnh hiển thị lên đã có gắn tên tương ứng của khu vực chưa.
