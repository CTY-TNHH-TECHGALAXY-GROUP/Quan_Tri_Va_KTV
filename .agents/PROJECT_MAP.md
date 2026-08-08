# 🗺️ PROJECT MAP - QUẢN TRỊ VÀ KTV (Spa Management System)

> **MỤC ĐÍCH:** Bản đồ này giúp AI và Developer nắm bắt tổng quan kiến trúc hệ thống, các module chính và tiến độ mà không cần tốn token (quét lại thư mục nhiều lần). **Quy tắc: Luôn đọc file này khi bắt đầu module mới và cập nhật file này sau khi hoàn thành tính năng lớn.**

## 1. Kiến Trúc Tổng Quan (Architecture Overview)
- **Framework:** Next.js (App Router)
- **Ngôn ngữ:** TypeScript
- **Database/Backend:** Supabase (PostgreSQL, Realtime, Storage)
- **Styling:** Tailwind CSS, tuân thủ UI/UX: Spa & Beauty (Clean, Calming, Mobile-first).
- **Core Pattern:** Tách biệt giao diện (`.tsx`), logic (`.logic.ts`), ngôn ngữ (`.i18n.ts`).

## 2. Cấu Trúc Tổng Thể (Directory Structure)
- `app/admin/`: Dashboard quản trị hệ thống (Quản lý User, Thông báo, Doanh thu).
- `app/ktv/`: Giao diện dành riêng cho Kỹ thuật viên (Lịch làm việc, xin nghỉ, chấm công hình ảnh).
- `app/reception/`: Màn hình bộ phận Lễ tân (Điều phối, DispatchSegment, Booking trực tiếp).
- `app/api/`: Các API Routes backend (Tương tác với Supabase).
- `supabase/migrations/`: Chứa các file schema SQL.

## 3. Trạng Thái Các Module Đang Phát Triển (Active Modules)
*(Cập nhật liên tục để biết các phần mềm đang nằm ở tiến độ nào)*

| Phân hệ (Module) | Tính năng (Feature) | Trạng thái | Ghi chú / File |
|------------------|---------------------|------------|----------------|
| **KTV App** | Hệ thống xin nghỉ, Đổi ca, Check-in bằng hình ảnh | 🟡 Đang phát triển | `create_shift_system.sql` |
| **Admin** | Lịch sử thông báo (Notification History) | 🟡 Đang phát triển | `Admin/notifications` |
| **Reception**| Dashboard Vận Hành (Điều Phối + Giám Sát Đơn) | 🟢 Đã hoàn thành | `app/reception/dispatch` |

## 4. Roadmap / Checklist Chung
- [ ] Chốt toàn bộ luồng Booking VIP cho khách.
- [ ] Hoàn thiện 100% tính năng phân ca, xin nghỉ của KTV.
- [ ] Deploy và test hệ thống Realtime của Lễ tân.

---
*Lưu ý: Bất cứ khi nào bắt đầu một phiên làm việc mới liên quan viết code/sửa kiến trúc, BẮT BUỘC ĐỌC file này. CẬP NHẬT SAU KHI XONG luồng tính năng LỚN.*
