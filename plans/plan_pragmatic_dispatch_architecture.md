# Kế Hoạch Tối Ưu Kiến Trúc (Pragmatic Dispatch Architecture)

Bản kế hoạch ban đầu (Đại phẫu áp dụng CQRS và Service Layer) đã chính thức bị **AI Phản Biện bác bỏ** vì chứa đựng quá nhiều rủi ro về Race Condition, phá vỡ Next.js Context và vi phạm quy tắc "Lazy Dev & YAGNI" của dự án. 

Dưới đây là phương án **Tiểu phẫu Thực dụng** thay thế, an toàn và sát với thực tế dự án Supabase hơn, đã được User phê duyệt để làm cẩm nang hướng dẫn cho các đợt bảo trì sau này.

## 🚨 Phản Biện & Lý do Bác bỏ Phương án cũ

1. **CQRS & Service Layer là Overkill:** Với Supabase, việc bọc các truy vấn `.select()` qua một lớp trung gian chỉ tạo ra lượng lớn boilerplate code vô giá trị.
2. **God Class mới:** Tạo `DispatchCommandService` chỉ là đổi tên một "Cục code to" (God Function) thành một "Class to", hoàn toàn không giải quyết triệt để nguyên lý SRP.
3. **Mất Next.js Context:** Di dời ồ ạt dễ làm gãy các hàm `revalidatePath`, `cookies()` nội tại của Server Action.
4. **Hiểm họa Race Condition:** KTV Dashboard có độ nhạy cảm cao về Real-time. Cắt dán logic tùy tiện sẽ làm sụp đổ hệ thống Commission Flow và Merge Segments.

## 🏗 Đề xuất Kiến trúc mới (Orchestrator & Pure Logic)

Thay vì tạo hàng loạt Service Class, đối với các file cồng kềnh như `actions.ts`, dự án sẽ áp dụng **Orchestrator Pattern** kết hợp **Pure Functions**:

### 1. `actions.ts` trở thành Orchestrator (Nhạc trưởng)
Giữ nguyên file `actions.ts`, nhưng định hướng nó sẽ chỉ làm nhiệm vụ điều phối luồng:
- Nhận Request từ UI.
- Truy vấn Data từ Database (Supabase).
- ➡️ Truyền Data vào các **Pure Functions** để tính toán.
- ⬅️ Nhận lại kết quả tính toán và Lưu xuống Database.

### 2. Tách Pure Logic (Logic thuần) ra khỏi Side-effects
Tạo thư mục `lib/logic/` để chứa các hàm chỉ thuần túy nhận Input và trả ra Output, KHÔNG kết nối Database. Lúc này code có thể test dễ dàng.
- Ví dụ: `dispatch-assignment.logic.ts` chuyên tính toán xem KTV nào rảnh, phân bổ thế nào.
- Lợi ích: Tách biệt hoàn toàn phần tính toán phức tạp khỏi phần Đọc/Ghi dữ liệu.

### 3. Tách theo Domain Modules
Thay vì gom vào một Service khổng lồ, nếu bắt buộc phải tách, chúng ta sẽ tách theo nhóm cụ thể:
- `booking-status.manager.ts` (Máy trạng thái)
- `ktv-freelance.creator.ts` (Riêng biệt cho logic KTV Ngoại viện)

## ⚠️ Nguyên tắc Thực thi: Strangler Fig & YAGNI (Lazy Dev)

> [!CAUTION]
> **KHÔNG ĐẬP ĐI XÂY LẠI TỪ ĐẦU (No Big Bang Rewrite)**
> Theo đúng bộ Rules của dự án, chúng ta sẽ tuân thủ chặt chẽ tư duy **Lazy Senior Dev**.

Chúng ta sẽ **KHÔNG mở chiến dịch dọn rác 2100 dòng code** ngay bây giờ.
- Các luồng cũ (như `processDispatch`, `getDispatchData`) hiện **đang chạy ổn định**, chúng ta sẽ **ĐỂ YÊN**.
- Chỉ tiến hành refactor theo mô hình Pure Functions đối với **tính năng nào cần bảo trì, sửa lỗi hoặc làm mới**. (Sửa đến đâu gọn đến đó).

---
**Status:** Approved by User.
**Action:** Archived as Architectural Guideline & Tech Debt.
