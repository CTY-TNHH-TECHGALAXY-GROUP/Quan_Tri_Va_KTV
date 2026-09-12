# 📋 Kế hoạch: Nâng cấp UI/UX Giao Việc (Accordion & Sort)

Nhằm đáp ứng yêu cầu của bạn về việc tối ưu hóa danh sách công việc (giảm bớt sự quá tải khi hiển thị danh sách dài) và cho phép tùy chỉnh thứ tự ưu tiên, tôi xin đề xuất kế hoạch triển khai chi tiết sau:

## 1. Mục tiêu (Goals)
- **App Nhân Viên (KTV)**: Danh sách công việc sẽ không còn là một danh sách phẳng dài ngoằn. Thay vào đó, công việc sẽ được **gom nhóm theo Cấp Khu Vực / Nhóm Việc** (Dropdown/Accordion). Nhân viên có thể bấm Thu Gọn / Mở Rộng từng nhóm.
- **App Quản Trị (Admin)**: Trong màn hình "Kho Công Việc", bổ sung tính năng **Kéo - Thả (hoặc nút Lên/Xuống)** để bạn có thể sắp xếp thứ tự các công việc con bên trong một Nhóm Việc.
- **Database**: Bổ sung cơ chế lưu trữ thứ tự (`sort_order`) để việc sắp xếp được lưu lại vĩnh viễn và hiển thị đúng thứ tự đó trên màn hình của Nhân viên.

> [!NOTE]
> Việc nhóm theo "Khu vực" (như bạn đề cập) sẽ sử dụng trực tiếp các "Nhóm Việc / Tiêu đề lớn" mà bạn đã tạo (VD: Vệ sinh chung, Sân Ngoài, Phòng VIP...).

---

## 2. Kế hoạch Triển Khai Chi Tiết (Implementation)

### Bước 1: Cập nhật Database (Supabase)
- **[MIGRATION]**: Tạo file SQL Migration mới để thêm cột `sort_order (integer, default 0)` vào bảng `TaskTemplates`.
- Cập nhật định nghĩa schema để code có thể lưu và đọc cột này.

### Bước 2: Nâng cấp Màn Hình Quản Trị (Admin Kho Công Việc)
- **[MODIFY]** `app/admin/support/templates/page.tsx`
- Bổ sung nút **Lên (↑)** và **Xuống (↓)** bên cạnh mỗi dòng công việc nhỏ khi bạn "Sửa Tiêu Đề".
- Cập nhật logic để khi bạn bấm Lưu Lại, hệ thống sẽ tự động gán `sort_order` dựa trên vị trí hiển thị (0, 1, 2...) và lưu xuống DB.

### Bước 3: Nâng cấp API & Service
- **[MODIFY]** `lib/services/employeeTasks.service.ts`
- Cập nhật câu lệnh lấy danh sách công việc (fetchTasks) để lấy kèm `sort_order` và sắp xếp ưu tiên theo: `Category` -> `sort_order` -> `Tên công việc`.

### Bước 4: Nâng cấp Màn Hình App Nhân Viên (KTV)
- **[MODIFY]** `app/support/tasks/page.tsx`
- Thay vì map một danh sách dài `logic.fixedTasks.map(...)`, tôi sẽ gộp các task này lại theo `task.categoryName`.
- Xây dựng component **Accordion (Dropdown Mở/Thu)** cho từng nhóm:
  - Hiển thị tiêu đề nhóm: VD: "Vệ sinh sân ngoài (3/5 việc)".
  - Có icon mũi tên (Chevron) để mở/đóng.
  - Bên trong là danh sách công việc đã được sắp xếp đúng thứ tự bạn đã cài đặt.

---

## 3. Câu Hỏi Xác Nhận (Open Questions)

> [!IMPORTANT]
> 1. **Về việc sắp xếp (Sort):** Để tiết kiệm thời gian tải thư viện Kéo-Thả (Drag & Drop) và tránh lỗi trên điện thoại, tôi sẽ thiết kế **Nút Bấm Lên / Xuống (↑ / ↓)** ở từng dòng công việc khi bạn tạo/sửa Tiêu đề. Cách này vẫn đáp ứng nhu cầu sắp xếp rất tốt. Bạn đồng ý chứ?
> 2. **Về Công Việc Đột Xuất (Ad-hoc tasks):** Công việc đột xuất thường không thuộc khu vực nào cố định. Tôi sẽ gộp chúng vào một Accordion riêng tên là **"VIỆC ĐỘT XUẤT"** nằm ở vị trí trên cùng. Bạn thấy hợp lý không?

Nếu bạn ĐỒNG Ý với kế hoạch này, hãy **bấm Proceed (Tiến hành)** hoặc phản hồi lại cho tôi nhé!
