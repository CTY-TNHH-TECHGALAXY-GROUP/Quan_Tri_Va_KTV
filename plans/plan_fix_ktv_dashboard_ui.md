# Phân Tích Nguyên Nhân Gốc (Root Causes)

1.  **Lỗi So Sánh Hoa - Thường (Case-Sensitivity) làm rỗng dữ liệu:**
    - Ở màn hình `ScreenDashboard` (đang hiển thị Checklist) và `ScreenTimer`, code đang lọc lấy chặng làm việc bằng câu lệnh: `s.ktvId === logic.ktvId`.
    - Việc này bắt buộc mã KTV phải trùng khớp 100% cả viết hoa lẫn viết thường (VD: `NH016` khác `nh016`). Nếu DB lưu chữ thường nhưng đăng nhập chữ hoa, mảng `ktvSegments` sẽ rỗng -> Dẫn đến Component `WorkingTimeline` bị ẩn hoàn toàn.
2.  **Chưa sử dụng "Giờ Đã Tịnh Tiến" (Shifted Time) từ API:**
    - Kể cả khi hiển thị được `WorkingTimeline`, code hiện tại đang truyền `actualStartTime = booking?.timeStart`.
    - Vấn đề là `timeStart` là giờ bắt đầu của **toàn bộ booking** (tức là giờ của người KTV 1). Nó bỏ qua cái `dispatchStartTime` (giờ đã được nối tiếp/tịnh tiến) do backend trả về. 

# Kế Hoạch Triển Khai (Implementation Plan)

**1. Đồng bộ cơ chế lọc Segments (Tại 2 màn hình Dashboard & Timer):**
- Đổi logic lọc từ tuyệt đối sang tương đối:
  ```typescript
  // Cũ
  segs.filter((s: any) => s.ktvId === logic.ktvId)
  // Mới
  segs.filter((s: any) => s.ktvId?.toLowerCase() === logic.ktvId?.toLowerCase())
  ```

**2. Cập nhật "Source of Truth" cho Timeline (Tại màn hình Dashboard):**
- Đổi cách truyền giờ dự kiến vào `WorkingTimeline`:
  ```typescript
  // Cũ
  actualStartTime={ktvSegments[0]?.actualStartTime || booking?.timeStart || null}
  // Mới (Ưu tiên dispatchStartTime từ API vừa nâng cấp)
  actualStartTime={ktvSegments[0]?.actualStartTime || booking?.dispatchStartTime || booking?.timeStart || null}
  ```
