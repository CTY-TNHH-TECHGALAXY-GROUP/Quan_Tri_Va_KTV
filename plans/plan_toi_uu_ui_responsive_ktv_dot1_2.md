# Kế hoạch tối ưu UI & Responsive cho thợ KTV — Đợt 1 + 2

**Ngày lập:** 03/09/2026
**Nhánh:** `feat/bit-lo-hong-phase1`
**Phạm vi:** Luồng thợ KTV sau khi bắt đầu ca (chấm công) và sau khi bắt đầu phục vụ (TIMER → REVIEW → HANDOVER → REWARD), tập trung vào trải nghiệm trên điện thoại.
**Trạng thái:** Chờ duyệt — chưa thực thi.

---

## Bối cảnh

Khảo sát mã nguồn ngày 03/09/2026 phát hiện 9 vấn đề về giao diện/responsive trong luồng KTV. Tài liệu này chỉ gom 2 đợt ưu tiên cao (Đợt 1: lỗi thợ gặp ngay; Đợt 2: bố cục & an toàn viền). Đợt 3 (dọn dẹp nhỏ) để lại làm sau.

Nền tảng hiện tại đã ổn: `viewport width=device-width`, sidebar là drawer `fixed` có overlay dưới breakpoint `lg`, header mobile sticky `h-14`, các màn KTV đều mobile-first (`max-w-sm/md/lg mx-auto`).

---

## ĐỢT 1 — Lỗi thợ gặp ngay

### 1.1 Khoá pull-to-refresh và ẩn nút AI khi đang phục vụ

**Vấn đề:** Trang dashboard bọc trong `AppLayout` không truyền `disablePullToRefresh`, nên khi thợ đang ở màn TIMER mà vô tình kéo xuống thì `handleGlobalRefresh` gọi `window.location.reload()` giữa ca. Nút AI nổi (`fixed bottom-6 right-6 z-50`) cũng che nội dung dù menu 3 gạch đã bị khoá.

**Cách sửa:** Tận dụng `ktvScreen` — state toàn cục đã có trong `NotificationProvider` và đã được `AppLayout` đọc cho `isServingLocked`. Không cần đổi API của `AppLayout`.

| File | Vị trí | Thay đổi |
|---|---|---|
| `components/layout/AppLayout.tsx` | nhánh render PullToRefresh | `disablePullToRefresh` → `disablePullToRefresh \|\| isServingLocked` |
| `components/layout/AppLayout.tsx` | dòng render AIAssistant | `{!hideAI && <AIAssistant />}` → `{!hideAI && !isServingLocked && <AIAssistant />}` |

**Kiểm chứng:** Ở màn TIMER, kéo xuống không reload; nút AI không hiển thị. Ở màn DASHBOARD, cả hai hoạt động như cũ.

### 1.2 Nút AI đè nút "Lưu hồ sơ" ở màn REVIEW

**Vấn đề:** Mục 1.1 chỉ xử lý màn TIMER; các màn REVIEW/HANDOVER/REWARD vẫn còn FAB, đè lên nút submit full-width nằm sát đáy.

**Cách sửa:** `app/ktv/dashboard/page.tsx`
- Container `ScreenReview` (`p-5 pt-10 space-y-6 max-w-lg mx-auto`): thêm `pb-28`.
- Khối bọc nút submit (`pb-10 pt-2`): bỏ `pb-10`, giữ `pt-2`.
- Rà `ScreenHandover`: nếu nút gửi cũng sát đáy thì áp cùng cách.

**Kiểm chứng:** Cuộn hết màn REVIEW, nút "Lưu hồ sơ" không bị FAB che ở 375×812.

### 1.3 Header màn Timer tràn ngang

**Vấn đề:** Header dùng `flex justify-between` nhưng cột trái thiếu `min-w-0`; tên dịch vụ dài ở `text-3xl font-black` cộng badge khách sẽ đẩy cụm 2 nút 48px (Tải lại / Quy trình) ra ngoài màn 360px.

**Cách sửa:** `app/ktv/dashboard/page.tsx`, khối header của `ScreenTimer`
- Cột trái (`flex flex-col gap-1`): thêm `min-w-0 flex-1`.
- Thẻ `<h1>`: thêm `break-words`, hạ cỡ chữ theo breakpoint `text-2xl sm:text-3xl`.
- Cụm 2 nút bên phải (`flex gap-2`): thêm `shrink-0`.
- Hàng meta (phòng • phút • nhãn loại DV): thêm `flex-wrap gap-y-1`.

**Kiểm chứng:** Với tên dịch vụ dài nhất trong hệ thống, `document.documentElement.scrollWidth === clientWidth` ở 360px.

### 1.4 Bỏ chặn zoom

**Vấn đề:** `app/layout.tsx` đặt `maximumScale: 1` và `userScalable: false`. App dùng rất nhiều `text-[10px]`, đây là rào cản thật cho thợ lớn tuổi.

**Cách sửa:** Xoá 2 thuộc tính đó khỏi `export const viewport`.

**Rủi ro & cách xử lý:** iOS Safari tự zoom khi focus vào input có `font-size < 16px`. Nếu sau khi bỏ chặn thấy khó chịu ở form chấm công/rút tiền, xử lý bằng cách nâng `font-size` các input lên 16px, **không** quay lại chặn zoom toàn app.

**Kiểm chứng:** Pinch-to-zoom hoạt động; mở form chấm công và form rút tiền trên iOS xem có bị nhảy zoom không.

---

## ĐỢT 2 — Bố cục & an toàn viền

### 2.1 Lưới 5 nút hành động lẻ ô

**Vấn đề:** Lưới hành động khi timer đang chạy dùng `grid-cols-2 md:grid-cols-5` với 5 nút → trên điện thoại thành 3 hàng, nút thứ 5 (Tạm dừng / Chờ quầy mở) đứng lẻ nửa hàng.

**Cách sửa:** `app/ktv/dashboard/page.tsx`
- Lưới: `grid-cols-2 md:grid-cols-5` → `grid-cols-3 md:grid-cols-5`.
- Nút thứ 5: thêm `col-span-3 md:col-span-1` để nằm trọn hàng dưới.
- `ActionGridButton`: nhãn `text-[10px]` thêm `leading-tight text-center` (3 cột hẹp hơn 2 cột, nhãn "KHÁCH VỀ SỚM" / "MUA THÊM DV" sẽ xuống dòng).

**Kiểm chứng:** Ở 360px, 5 nút xếp 4+1 gọn gàng, nhãn không bị cắt.

### 2.2 Safe-area đáy

**Vấn đề:** Chỉ `AIAssistant` và Toast dùng `env(safe-area-inset-bottom)`. Các nút cuối trang (Báo động khẩn cấp `mb-12`, submit REVIEW) dễ chạm vạch home iPhone.

**Cách sửa:**
- Thêm tiện ích dùng lại được vào `app/globals.css`:
  ```css
  .pb-safe { padding-bottom: calc(env(safe-area-inset-bottom) + 1rem); }
  ```
- Áp cho: khối nút khẩn cấp trong `ScreenTimer`, nút cuối `ScreenReward`, và container `MainContent` trong `AppLayout.tsx`.

**Kiểm chứng:** Trên iPhone có vạch home (hoặc mô phỏng), nút cuối không nằm dưới vạch.

### 2.3 Màn REWARD bó hẹp cứng

**Vấn đề:** 4 chỗ dùng `max-w-[280px]` cố định (card tua, form đánh giá, nút cuối) — trên máy 414px trông hụt hai bên, textarea `h-20` gõ rất chật.

**Cách sửa:** `app/ktv/dashboard/page.tsx`, `ScreenReward`
- Thay `max-w-[280px]` → `max-w-xs sm:max-w-sm w-full` ở cả 4 chỗ.
- Textarea: `h-20` → `h-24`.
- Container ngoài đã có `md:max-w-2xl md:mx-auto` nên bố cục desktop không đổi.

**Kiểm chứng:** So sánh ở 375px và 414px, nội dung nở đúng theo màn hình.

### 2.4 Ô tổng kết 4 cột ở màn Lịch sử

**Vấn đề:** `app/ktv/history/page.tsx` dùng `grid-cols-4`, số tiền đặt `whitespace-nowrap overflow-hidden text-ellipsis` → số từ 7 chữ số trở lên bị cắt cụt trên màn hẹp.

**Cách sửa:**
- Lưới: `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`.
- Bỏ `text-ellipsis` / `whitespace-nowrap` ở dòng số tiền, cho phép xuống dòng; hoặc rút gọn số lớn (`1.2tr`) nếu vẫn chật.

**Kiểm chứng:** Nhập/giả lập doanh thu 8 chữ số, kiểm tra ở 360px không mất chữ số nào.

---

## Kiểm chứng chung sau mỗi đợt

1. Chạy dev server qua Browser pane (không dùng Bash).
2. `resize_window` preset `mobile` (375×812), sau đó thêm một lượt 360×640.
3. Đi hết chuỗi TIMER → REVIEW → HANDOVER → REWARD và màn chấm công trạng thái `CONFIRMED`.
4. Ở mỗi màn kiểm tra `document.documentElement.scrollWidth === document.documentElement.clientWidth` (không tràn ngang).
5. Chụp màn hình gửi lại để đối chiếu.

**Điều kiện cần:** một tài khoản KTV có đơn đang chạy để render đủ các màn. Nếu chưa có, sẽ dựng trạng thái bằng dữ liệu giả ở tầng logic (không ghi vào DB thật).

---

## Ghi chú rủi ro

- Mục 1.1 và 2.2 chạm vào `AppLayout.tsx` — file dùng chung cho **mọi** vai trò (admin, lễ tân, KTV). `isServingLocked` chỉ bật khi `ktvScreen === 'TIMER'` nên các vai trò khác không bị ảnh hưởng, nhưng cần kiểm tra lại màn lễ tân sau khi sửa.
- Mục 1.4 tác động toàn app, không chỉ luồng KTV.
- File `AppLayout.tsx` hiện đang có thay đổi chưa commit (`AccountLockedScreen`, `isServingLocked`, `lockInfo`) — cần commit hoặc stash cẩn thận trước khi sửa tiếp.

---

## Việc còn lại (Đợt 3 — chưa đưa vào phạm vi)

- Ruler timeline ở màn Ví vẽ thừa đường kẻ cuối danh sách (`before:h-full` → `last:before:hidden`).
- Sidebar mobile kế thừa `w-20` khi người dùng từng thu gọn ở desktop (`w-64 lg:w-20`).
