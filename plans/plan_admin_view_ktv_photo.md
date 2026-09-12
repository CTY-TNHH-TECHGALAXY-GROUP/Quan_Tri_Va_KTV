# Kế hoạch triển khai: Thêm nút xem ảnh check-in của KTV trên Giao diện Điều phối Admin

## 📌 Mục tiêu
Hiện tại hệ thống đã lưu ảnh check-in khách hàng của KTV lên server và hiển thị zoom ở chế độ Kanban Board (giám sát đơn). Tuy nhiên, trên giao diện Điều phối chi tiết chính (`DISPATCH` mode) tại Bảng điều phối trung tâm của Lễ tân, admin/lễ tân vẫn chưa có cách nào để xem ảnh KTV đã chụp.
Kế hoạch này sẽ bổ sung các nút hiển thị thumbnail ảnh check-in tại giao diện Điều phối chính để Lễ tân kiểm tra nhanh chóng mà không cần chuyển tab:
1. **Tại Panel Tóm tắt dịch vụ (Quick View của DispatchServiceBlock)**: Hiển thị thumbnail tròn nhỏ kế bên mã KTV. Click vào sẽ hiển thị Modal phóng to ảnh check-in.
2. **Tại Dòng phân công chi tiết (DispatchStaffRow)**: Thêm một nút hiển thị ảnh chụp preview của KTV đó kế bên nút In phiếu, click vào sẽ mở Modal phóng to.
3. **Tại Trang chính (DispatchBoard page)**: Khai báo state `selectedPhoto` chung và render Modal phóng to ảnh check-in (sử dụng hiệu ứng Glassmorphism và Framer Motion thống nhất với Kanban Board).

---

## 🛠️ Chi tiết các thay đổi đề xuất

### 1. Trang chính: [page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/page.tsx)
- Khai báo state `selectedPhoto`:
  `const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; ktvId: string; time: string | null } | null>(null);`
- Truyền callback `onViewPhoto={setSelectedPhoto}` vào component `<DispatchServiceBlock ... />`.
- Render Modal zoom ảnh ở cuối trang `page.tsx` (sử dụng `<AnimatePresence>` của Framer Motion và cấu trúc HTML/CSS tương thích cao giống bên KanbanBoard).

### 2. Component Block Dịch vụ: [DispatchServiceBlock.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/_components/DispatchServiceBlock.tsx)
- Tiếp nhận prop `onViewPhoto` từ component cha.
- Tại phần hiển thị tóm tắt KTV (Quick View, dòng 69-84):
  - Tìm kiếm `startPhotoUrl` từ segments của KTV đó.
  - Nếu có, hiển thị thêm một thumbnail ảnh tròn nhỏ ngay bên phải mã KTV trong tag. Click vào thumbnail sẽ gọi `onViewPhoto`.
- Truyền prop `onViewPhoto` tiếp xuống component con `<DispatchStaffRow ... />`.

### 3. Component Dòng Phân công: [DispatchStaffRow.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/_components/DispatchStaffRow.tsx)
- Tiếp nhận prop `onViewPhoto` từ component cha.
- Tìm kiếm `startPhotoUrl` từ `row.segments`.
- Nếu tồn tại `startPhotoUrl`, hiển thị một nút thumbnail ảnh check-in tròn có bo góc (`w-10 h-10 rounded-xl overflow-hidden`) kế bên nút In phiếu. Click vào nút này sẽ kích hoạt gọi `onViewPhoto` để phóng to ảnh.

---

## 🧪 Kế hoạch kiểm thử (Verification Plan)

1. **Kiểm tra biên dịch**:
   - Chạy lệnh `npx tsc --noEmit` để đảm bảo code sạch, không phát sinh bất kỳ lỗi kiểu/compile TypeScript nào.
2. **Kiểm thử thủ công**:
   - Sử dụng một tài khoản KTV thực hiện check-in chụp ảnh khách và kích hoạt dịch vụ thành công.
   - Truy cập trang Điều phối trung tâm của Lễ tân, chọn Tab **"Đang làm"** và click chọn đơn hàng vừa kích hoạt.
   - Xác nhận:
     - Tại thanh tiêu đề tóm tắt dịch vụ (Quick View), có ảnh tròn nhỏ bên cạnh mã KTV. Click vào ảnh hiển thị Modal zoom chuẩn.
     - Khi mở rộng chi tiết dịch vụ, kế bên mã KTV và nút in phiếu, có một nút ảnh check-in preview. Click vào xem được ảnh phóng to kèm thời gian thực tế KTV check-in.
