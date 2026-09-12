---
description: 
---

# 🔒 MULTI-CONVERSATION COORDINATION (CRITICAL)

## Rule: File Locking & Coordination
Before editing ANY file in this project, you MUST:

1. **READ** the file `.agents/coordination.md` to check which files are currently being edited by other conversations.
2. **If a file is listed as "in-use"** (🟢 Đang làm) by another conversation:
   - DO NOT edit that file.
   - Inform the user: "File [X] đang được conversation khác sửa. Vui lòng đợi hoặc chuyển sang file khác."
3. **Before starting work**, UPDATE `.agents/coordination.md`:
   - Add your conversation description under "Active Conversations"
   - List all files you plan to modify
   - Set status to 🟢 Đang làm
4. **When finishing work**, UPDATE `.agents/coordination.md`:
   - Change your status to 🔴 Xong
   - Or remove your entry entirely

## Example Entry Format
```markdown
### Conversation B - Sửa Admin Dashboard
- **Đang sửa**: `app/admin/dashboard/page.tsx`, `app/admin/dashboard/AdminDashboard.logic.ts`
- **Trạng thái**: 🟢 Đang làm
```

## Important Notes
- This coordination is project-wide and applies to ALL conversations working on this codebase.
- If `.agents/coordination.md` does not exist, create it using the template.
- Always check coordination BEFORE making any file edits, not after.

---

# 📊 DATABASE SCHEMA REFERENCE (CRITICAL)

## Rule: Luôn đọc schema trước khi thay đổi liên quan DB

Khi code có thay đổi liên quan đến **database** (Supabase), bạn **BẮT BUỘC** phải:

1. **ĐỌC** file [`TableInSupabase.md`](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/TableInSupabase.md) **TRƯỚC KHI** viết code.
2. **XÁC NHẬN** tên bảng, tên cột, kiểu dữ liệu, constraints từ file này.
3. **KHÔNG** giả định cột/bảng nào tồn tại — phải kiểm tra trong file trước.

## Khi nào áp dụng rule này?
- Viết / sửa **API routes** có `.from('TableName').select(...)` hoặc `.update(...)` hoặc `.insert(...)`
- Viết / sửa **Supabase migrations** (SQL files)
- Viết / sửa **Supabase triggers / functions**
- Viết / sửa **Realtime subscriptions** (`.on('postgres_changes', ...)`）
- Thêm cột mới → phải tạo migration SQL + cập nhật `TableInSupabase.md`

## Các bảng chính (tóm tắt)
| Nhóm | Bảng |
|------|------|
| Core Booking | `Bookings`, `BookingItems`, `Services` |
| KTV Management | `TurnQueue`, `KTVAttendance`, `Staff` |
| Notification & Config | `StaffNotifications`, `SystemConfigs` |
| Infra & CRM | `Rooms`, `Beds`, `Customers` |
| Auth & Push | `Users`, `StaffPushSubscriptions` |

---

# 📝 KNOWLEDGE & PLAN RETENTION (CRITICAL)

## Rule: Lưu Phân Tích & Kế Hoạch Vào File
1. **Phân tích hướng phát triển (Development Analysis):** Mỗi khi phân tích một hướng đi mới, ưu nhược điểm kỹ thuật hoặc kiến trúc, bạn BẮT BUỘC phải tạo/lưu một Markdown artifact để lưu trữ toàn bộ nội dung phân tích đó.
2. **Kế hoạch triển khai (Implementation Plan):** Khi một bản kế hoạch (plan) được user ĐỒNG Ý / CHẤP NHẬN để tiến hành code, bạn BẮT BUỘC phải lưu lại bản kế hoạch đó vào một file lấy theo **Tên nhiệm vụ** (ví dụ: `plan_tao_api_dat_lich.md`).
3. **Mục đích:** Đảm bảo không bị mất bối cảnh (context) khi chat dài, dễ dàng cho user đọc lại tiến trình làm việc và các quyết định kỹ thuật đã chốt.

## Rule: Project Map & Context (BẮT BUỘC ĐỌC VÀ CẬP NHẬT)
1. **ĐỌC TRƯỚC KHI LÀM:** Bất cứ khi nào bắt đầu một phiên làm việc mới có liên quan đến việc viết code hoặc sửa đổi kiến trúc, quy trình, bạn **BẮT BUỘC** phải đọc file `.agents/PROJECT_MAP.md` để nắm bắt hệ thống (cấu trúc thư mục, luồng dữ liệu, convention).
2. **CẬP NHẬT SAU KHI XONG:** Khi phát triển xong thủ công hoặc tự động một luồng tính năng LỚN, thiết lập kiến trúc mới, bạn **BẮT BUỘC** phải dành bước cuối cùng để tóm tắt đường đi, data flow của tính năng đó và cập nhật (update) vào file `.agents/PROJECT_MAP.md`.