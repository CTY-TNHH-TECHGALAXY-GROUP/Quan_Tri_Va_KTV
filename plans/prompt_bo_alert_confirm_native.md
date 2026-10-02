# Prompt — Bỏ `window.confirm` / `alert` của trình duyệt, thay bằng popup trong app

> Copy toàn bộ phần dưới gửi cho anti.
> Ưu tiên: làm **Giai đoạn A** (màn Lịch KTV) trước, xong báo lại rồi mới sang Giai đoạn B.

---

## 0. Vấn đề

Màn "Sửa lịch ngày ..." đã là popup đẹp của app, nhưng bấm **"Hủy đăng ký này"** thì bật lên
hộp thoại đen xấu của trình duyệt (`localhost:3000 says — Bạn có chắc muốn HỦY lịch đi làm ngày 2026-09-09?`)
đè lên trên. Trải nghiệm gãy: hai phong cách giao diện chồng nhau, và trên mobile/PWA hộp thoại này
hiển thị càng tệ, có trường hợp bị trình duyệt chặn luôn.

**Yêu cầu:** bỏ toàn bộ `window.confirm` / `alert` của trình duyệt, thay bằng popup của app.
**Khi cần xác nhận thì ĐỔI NỘI DUNG NGAY TRONG POPUP ĐANG MỞ (chuyển bước), KHÔNG mở popup thứ hai đè lên.**

## 1. Dựng 2 component dùng chung

Thư mục `components/ui/` (đã có `DropdownMenu.tsx`, theo đúng convention đó).

### 1.1 `components/ui/ConfirmDialog.tsx`
Props tối thiểu: `open`, `title`, `message`, `confirmText`, `cancelText`, `variant` (`'danger' | 'warning' | 'normal'`),
`onConfirm`, `onCancel`, `isLoading`.
- Dùng đúng thư viện animation + icon repo đang dùng (`lucide-react`, và thư viện motion đang dùng trong
  `components/NotificationProvider.tsx`). Đừng cài thêm package mới.
- Style bám theo modal "Sửa lịch ngày ..." hiện có trong `app/ktv/schedule/page.tsx` (bo góc lớn, nút bo tròn,
  màu đỏ cho hành động hủy) để đồng bộ, đừng tự chế phong cách mới.
- Nút xác nhận có trạng thái loading, chặn double-click.

### 1.2 `components/ui/Toast.tsx` (báo thành công / lỗi)
⚠️ **Đã có sẵn một hệ toast trong `components/NotificationProvider.tsx`** nhưng nó phục vụ
**notification realtime từ server** (`StaffNotifications`, có `isRead`, có âm thanh) — `addToast` **không**
được expose ra context (xem dòng ~538). **Đừng** nhét thông báo UI cục bộ vào luồng đó, sẽ lẫn với
thông báo nghiệp vụ và kêu chuông sai. Làm một toast nhẹ riêng cho phản hồi thao tác.

## 2. GIAI ĐOẠN A — màn Lịch KTV (`app/ktv/schedule/`)

Đúng 5 chỗ, đã grep sẵn:

| Vị trí | Hiện tại | Đổi thành |
|---|---|---|
| `Schedule.logic.ts:189` | `window.confirm("Bạn có chắc muốn HỦY lịch đi làm ngày ...")` | **Bước xác nhận bên trong modal `editingReg`** (xem §2.1) |
| `Schedule.logic.ts:198` | `alert(err.message \|\| "Có lỗi xảy ra khi hủy")` | Lỗi inline trong modal + toast đỏ |
| `Schedule.logic.ts:215` | `alert(err.message \|\| "Có lỗi xảy ra khi sửa")` | Lỗi inline trong modal + toast đỏ |
| `page.tsx:146` | `window.confirm("Ngày này đã có N người xin nghỉ...")` | **Bước cảnh báo trong modal `pendingSubmit`** (xem §2.2) |
| `page.tsx:410` | `alert("Vui lòng nhập giờ cho ngày đầu tiên...")` | Lỗi inline ngay dưới ô giờ, **không** popup |

### 2.1 Modal `editingReg` — thêm bước, không mở popup mới

State `editingReg` hiện là `{ date, expected_time, status }` (`Schedule.logic.ts:64`).
Thêm bước hiển thị, ví dụ `editingStep: 'EDIT' | 'CONFIRM_CANCEL'`.

- Bấm **"Hủy đăng ký này"** → **không** gọi API ngay, chỉ đổi `editingStep = 'CONFIRM_CANCEL'`.
- Modal **giữ nguyên khung, đổi ruột**: tiêu đề thành "Xác nhận hủy lịch", nội dung nêu rõ
  ngày + loại đang đăng ký (ĐI LÀM/OFF) + giờ hiện tại, hai nút **[Quay lại]** / **[Xác nhận hủy]** (đỏ).
- Bấm [Quay lại] → về `'EDIT'`, **không** mất dữ liệu giờ đang nhập dở.
- Bấm [Xác nhận hủy] → gọi API, nút vào trạng thái loading; xong thì đóng modal + toast xanh.
- Lỗi API → **ở lại modal**, hiện lỗi inline. Tuyệt đối không `alert` rồi đóng modal mất trắng thao tác.

### 2.2 Modal `pendingSubmit` — cảnh báo "đã có N người xin nghỉ"

Hiện `page.tsx:146` chặn bằng `window.confirm` **ngay lúc chọn ngày trên lịch** — vừa xấu vừa sai chỗ:
người dùng còn đang chọn nhiều ngày mà đã bị hỏi từng ngày một.

Chuyển thành **một bước trong modal xác nhận `pendingSubmit`**, gom lại:
- Khi mở modal xác nhận, ngày nào có ≥3 người đã nghỉ thì hiển thị **cảnh báo vàng ngay cạnh ngày đó**
  trong danh sách ("Đã có 4 người nghỉ ngày này").
- Người dùng thấy hết một lần rồi bấm Gửi, không bị hỏi lắt nhắt từng ngày.

## 3. GIAI ĐOẠN B — quét phần còn lại (làm sau, khi A đã duyệt)

`grep -rn "window.confirm\|alert(" app/ktv` còn khoảng **30 chỗ**, tập trung ở:
- `app/ktv/dashboard/KTVDashboard.logic.ts` (~20 chỗ, hầu hết là `alert('Lỗi ...')` → chuyển hết sang toast đỏ)
- `app/ktv/attendance/page.tsx:410` và `:629` — **hai chỗ này là `confirm` nghiệp vụ quan trọng**
  (xin nghỉ đột xuất, tan ca sớm hơn giờ dự kiến), phải thành `ConfirmDialog` đàng hoàng, **không** hạ cấp thành toast.
- `app/ktv/attendance/Attendance.logic.ts:355,359` — chuỗi tiếng Việt còn **hỏng encoding**
  (`"C?p nh?t th�nh c�ng!"`), sửa luôn khi thay.

Ngoài ra `app/reception/dispatch/page.tsx` cũng còn `window.confirm` (dòng ~255 nút Báo Khách) —
**để lại, đừng đụng trong đợt này**, tránh đụng độ với công việc đang làm ở luồng Báo Khách.

## 4. KHÔNG làm

- Không cài thêm thư viện UI/toast mới.
- Không đổi logic nghiệp vụ, không đổi payload API. Đây là việc thuần giao diện.
- Không nhét thông báo UI vào `NotificationProvider` (lý do ở §1.2).
- Không mở `ConfirmDialog` **đè lên** một modal đang mở. Nguyên tắc: **một popup tại một thời điểm, chuyển bước bên trong nó.**
  `ConfirmDialog` chỉ dùng độc lập cho các nút **không** nằm trong modal nào.

## 5. Tự kiểm trước khi báo xong

1. Bấm "Hủy đăng ký này" → **không** còn thấy hộp `localhost:3000 says`. Modal đổi ruột tại chỗ.
2. Bấm [Quay lại] ở bước xác nhận → về form sửa, giờ đang nhập dở **vẫn còn**.
3. Ngắt mạng rồi bấm [Xác nhận hủy] → lỗi hiện **inline trong modal**, modal không đóng.
4. Chọn ngày đã có ≥3 người nghỉ → **không** bị hỏi lúc click lịch; cảnh báo hiện trong modal xác nhận.
5. Bấm "Áp dụng giờ cho tất cả" khi chưa nhập giờ → lỗi inline dưới ô giờ, không popup.
6. Test trên khung mobile (DevTools ~390px): modal không tràn, nút không bị che.
7. `grep -rn "window.confirm\|alert(" app/ktv/schedule` → **0 kết quả**.

Báo lại: file nào đã sửa/tạo mới, và kết quả 7 mục trên.
