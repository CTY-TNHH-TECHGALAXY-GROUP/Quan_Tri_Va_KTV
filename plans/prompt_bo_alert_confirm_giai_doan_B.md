# Prompt — Giai đoạn B: quét nốt `alert` / `window.confirm` trong app KTV

> Copy toàn bộ phần dưới gửi cho anti.
> Tiếp nối `plans/prompt_bo_alert_confirm_native.md` §3. **Giai đoạn A đã duyệt xong.**

---

## 0. Giai đoạn A đã đạt — xác nhận lại để không làm lại

Đã kiểm chứng:
- `grep -rn "window.confirm\|alert(" app/ktv/schedule` → **0 kết quả**.
- `ToastProvider` đã mount đúng trong `app/layout.tsx:48`.
- `editingReg.step: 'EDIT' | 'CONFIRM_CANCEL'` chạy đúng kiểu **chuyển bước trong cùng một popup**,
  nút [Quay lại] có `setOffError(null)` — đúng yêu cầu.
- Cảnh báo "đã có N người nghỉ" đã dời vào modal (`page.tsx:407`), không còn hỏi lắt nhắt lúc click lịch.

**Không đụng lại `app/ktv/schedule/`.**

⚠️ Một điểm cần biết: `components/ui/ConfirmDialog.tsx` **hiện chưa được import ở đâu cả** (dead code) —
màn Lịch tự dựng bước trong modal riêng, và như vậy là đúng. Giai đoạn B chính là chỗ `ConfirmDialog`
được dùng thật. Nếu thấy nó không hợp với ca dùng nào bên dưới thì **sửa lại component đó**, đừng
copy-paste modal mới ở từng chỗ.

## 1. Phạm vi thật — 51 chỗ, không phải ~30

`grep -rn "window.confirm\|alert(" app/ktv` cho ra **51** kết quả:

| File | Số chỗ |
|---|---|
| `app/ktv/dashboard/KTVDashboard.logic.ts` | 15 |
| `app/ktv/dashboard/page.tsx` | 12 |
| `app/ktv/attendance/page.tsx` | 7 |
| `app/ktv/wallet/KTVWallet.logic.ts` | 6 |
| `app/ktv/attendance/_components/AttendanceTypeB.tsx` | 4 |
| `app/ktv/wallet/page.tsx` | 3 |
| `app/ktv/attendance/_components/OnCallWidget.tsx` | 2 |
| `app/ktv/attendance/Attendance.logic.ts` | 2 |

Làm **theo từng file, mỗi file một lượt**, báo xong từng file. Đừng gom 51 chỗ vào một lần sửa.
Thứ tự đề nghị: `attendance/` trước (rủi ro nghiệp vụ cao nhất) → `wallet/` → `dashboard/`.

## 2. Phân loại — quy tắc quyết định

### 2.1 `alert('Lỗi ...')` → toast đỏ
Đa số là báo lỗi sau khi gọi API. Dùng `useToast()`. **Không** dựng modal cho lỗi.

### 2.2 `alert('Thành công ...')` → toast xanh
Ví dụ `KTVDashboard.logic.ts:1580` ('Đã gửi báo cáo sự cố về Lễ tân!').

### 2.3 `alert(...)` là **điều kiện chặn** → lỗi inline tại chỗ, KHÔNG toast
Khi thông báo giải thích *vì sao không bấm được*, phải hiện ngay cạnh nút/ô nhập, vì toast biến mất
sau vài giây rồi người dùng vẫn không hiểu. Các ca thuộc nhóm này:
- `AttendanceTypeB.tsx:170` và `:200` — "Bạn còn N công việc chưa hoàn thành..."
- `attendance/page.tsx:419` và `:724` — "Vui lòng chọn thời gian dự kiến..."

### 2.4 `window.confirm` → `ConfirmDialog` **đàng hoàng**, không hạ cấp thành toast
Đúng **4 chỗ**, đều là xác nhận nghiệp vụ có hậu quả tiền bạc/kỷ luật:

| Vị trí | Nội dung | Lưu ý |
|---|---|---|
| `attendance/page.tsx:410` | Xin nghỉ đột xuất | `variant="danger"` — có phạt tiền |
| `attendance/page.tsx:629` | Tan ca sớm hơn giờ dự kiến | Giữ nguyên câu nhắc báo lễ tân |
| `dashboard/page.tsx:1636` | Chưa chụp đủ ảnh bàn giao, bỏ qua sẽ bị phạt | `variant="danger"` |
| `wallet/KTVWallet.logic.ts:115` | Xác nhận giao dịch ví | `variant="danger"` — đụng tiền |

Bốn chỗ này **tuyệt đối không** được đổi thành toast hay tự động bỏ qua. Nếu chỗ nào đang nằm trong
một modal đang mở thì áp quy tắc cũ: **chuyển bước bên trong modal đó**, không chồng popup.

### 2.5 Sửa luôn chuỗi hỏng encoding
`app/ktv/attendance/Attendance.logic.ts:355` và `:359` đang là `"C?p nh?t th�nh c�ng!"`,
`"C� l?i x?y ra"`. Viết lại tiếng Việt cho đúng khi thay.

## 3. KHÔNG làm

- Không cài thư viện mới.
- Không đổi logic nghiệp vụ, không đổi payload API. Thuần giao diện.
- Không đụng `app/ktv/schedule/` (đã xong).
- Không đụng `app/reception/dispatch/page.tsx` (luồng Báo Khách đang sửa song song).
- Không nhét thông báo UI vào `NotificationProvider` — đó là kênh notification realtime từ server.

## 4. Bắt buộc trước khi báo xong

1. **Chạy `npm run build` (hoặc `next build`) và dán kết quả.**
   Bài học đợt trước: `Toast.tsx` thiếu `'use client'` làm vỡ build mà vẫn được báo là xong.
   **Mọi component mới trong `components/` có hook hoặc event handler phải mở đầu bằng `'use client'`.**
2. **Mở thật từng màn đã sửa** (`/ktv/attendance`, `/ktv/wallet`, `/ktv/dashboard`), xem Console
   có lỗi đỏ không. Build pass **không** đồng nghĩa màn hình chạy được —
   đợt trước `lib/api-endpoints.ts` bị mất `${employeeId}` khỏi URL, TypeScript không bắt được,
   build vẫn xanh, nhưng màn điểm danh chết sạch.
3. `grep -rn "window.confirm\|alert(" app/ktv` → **0 kết quả**.
4. Với 4 ca ở §2.4: bấm nút → hiện `ConfirmDialog`; bấm [Hủy] → **không** có gì xảy ra
   (không gọi API, không đổi trạng thái); bấm [Xác nhận] → chạy đúng như trước.
5. Ngắt mạng rồi thao tác → lỗi hiện ra được, màn hình không treo, modal không tự đóng mất dữ liệu.
6. Khung mobile ~390px: modal và toast không tràn, không che nút.

Báo lại theo **từng file**: đã sửa bao nhiêu chỗ, chỗ nào xếp vào nhóm nào (2.1–2.4),
và kết quả 6 mục trên. Mục nào chưa test được thì nói rõ là chưa test.
