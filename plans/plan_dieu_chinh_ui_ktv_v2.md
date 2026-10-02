# Kế hoạch điều chỉnh UI KTV (Chấm công / Lịch làm việc / Lịch sử)

Nguồn: 3 ảnh test do người dùng gửi. Không đổi schema DB, chỉ UI + 1 nhỏ ở API.

---

## Hạng mục 1 — Nút TAN CA phải bị làm mờ (disabled) khi quầy bấm "có khách"

**Hiện trạng:** khi `guestArrivalLock.active === true`, nút tan ca bị **ẩn hoàn toàn** và thay bằng banner đỏ
"🔔 Bật thủ công từ Dispatch Board" (ảnh 1).
- `app/ktv/attendance/_components/AttendanceTypeD.tsx:212-235` — nhánh `isAtVenue`: `guestArrivalLock?.active ? <banner> : <button>`.
- `app/ktv/attendance/page.tsx:618-670` — luồng TYPE_A/B/C cũng dùng cùng cơ chế (đã có `title=` cho lock nhưng cần rà lại `disabled`).

**Thay đổi:**
1. `AttendanceTypeD.tsx`: bỏ cấu trúc thay-thế. **Luôn render nút** tan ca; khi lock:
   - `disabled = actionLoading || incompleteTasksCount > 0 || guestArrivalLock?.active`
   - class chuyển từ `bg-rose-600 text-white shadow-rose-200` → `bg-slate-200 text-slate-400 shadow-none cursor-not-allowed` (mất màu), bỏ `active:scale-95` và `hover:`.
   - Giữ banner đỏ nhưng đặt **phía trên** nút làm dòng giải thích, cỡ chữ nhỏ hơn (`text-sm`), không còn thay thế nút.
2. `page.tsx` (TYPE_A/B/C): áp cùng quy tắc — thêm `guestArrivalLock?.active` vào `disabled` và thêm nhánh class xám, giữ `title` sẵn có.
3. Gom class nút vào 1 biến `checkOutBtnClass` trong mỗi file để không lặp chuỗi Tailwind dài.

**Kiểm thử:** quầy bấm "có khách" → nút xám, bấm không có phản ứng, có dòng cảnh báo; quầy tắt → nút đỏ trở lại (state đã poll 30s / `onRefreshStatus`).

---

## Hạng mục 2 — Trang LỊCH LÀM VIỆC (ảnh 2)

### 2a. Bỏ khối chi tiết trùng lặp ở cuối trang
**Hiện trạng:** `app/ktv/schedule/page.tsx:719-796` (khối `── DETAILS ──`) render thẻ "THỨ SÁU, 04/09/2026 → ĐĂNG KÝ ĐI LÀM ⏱ 00:12" — trùng với danh sách "Lịch đi làm đã đăng ký" ở trên (`page.tsx:335-390`).

**Thay đổi:** trong khối DETAILS, **bỏ phần render `myReg` khi `myReg.status === 'REGISTERED'`** (đăng ký ĐI LÀM) vì đã có danh sách ở trên.
- Vẫn giữ thẻ `ĐĂNG KÝ OFF` và danh sách `leaves` (đây là thông tin không nằm trong danh sách đi làm).
- Cập nhật điều kiện bỏ qua ngày rỗng: `if (!visibleReg && leaves.length === 0) return null;` với `visibleReg = myReg && myReg.status !== 'REGISTERED' ? myReg : null`.

### 2b. Bỏ ràng buộc mốc giờ khi đăng ký ngày làm
**Hiện trạng:** `lib/vn-time.ts:34` `canEditRegistration()` khoá theo mốc giờ (00:00 ngày D). Được dùng ở:
- `app/ktv/schedule/page.tsx:131` (chọn ngày), `:253`, `:365`, `:452` (cho sửa/huỷ)
- `app/api/ktv/daily-registration/route.ts:54` (chặn phía server)

**Thay đổi:** bỏ ràng buộc mốc giờ, chỉ còn ràng buộc theo **ngày** (đăng ký/sửa cho ngày > hôm nay):
- `lib/vn-time.ts`: viết lại `canEditRegistration(workDate)` → `return workDate > vnToday();` và cập nhật doc-comment. Giữ nguyên tên hàm để không phải sửa 6 call-site.
- Bỏ/đổi các thông báo lỗi còn nhắc mốc giờ: `page.tsx:132` ("Đã qua 00:00 nên khóa sổ…"), `page.tsx:374` ("… vì đã qua 00:00, sổ đã khóa"), `route.ts:55` ("… đã khóa lúc 00:00…") → thông điệp mới: `Chỉ có thể đăng ký/sửa lịch từ ngày mai trở đi.`
- Vì `canEditRegistration` nay đã bao hàm `> vnToday()`, gộp bỏ điều kiện lặp `dateStr <= vnToday() || !canEditRegistration(dateStr)` thành một lời gọi duy nhất ở cả 4 call-site.

**Rủi ro:** `canEditRegistration` chỉ dùng cho đăng ký lịch TYPE_D (đã grep toàn repo), không ảnh hưởng nghỉ phép / đổi ca.

---

## Hạng mục 3 — Trang LỊCH SỬ (ảnh 3)

### 3a. Bỏ Tip
- `app/ktv/history/page.tsx:440-443`: xoá thẻ KPI **"Tip"**.
- `page.tsx:117-130, 340-375`: xoá state `tipValue/tipSaved`, ô nhập "TIỀN TIP" và nút Lưu, cùng lời gọi `API.KTV.HISTORY_UPDATE`.
- `page.tsx:423`: đổi phụ đề "Bấm vào đơn để xem chi tiết & nhập tip" → "Bấm vào đơn để xem chi tiết".
- `KTVHistory.logic.ts`: bỏ `totalTip` khỏi `summary` (giữ field `tip` trong `HistoryRecord` vì API vẫn trả, chỉ không hiển thị).
- API `HISTORY_UPDATE` **giữ nguyên** (không xoá route) — chỉ gỡ điểm gọi ở UI KTV.

### 3b. Bỏ thẻ "ví bonus" đứng riêng
- `page.tsx:444-447`: xoá thẻ KPI **"Bonus"**. Bonus vẫn được cộng vào Thu nhập (mục 3c) và vẫn hiện trong chi tiết đơn ("BONUS XUẤT SẮC").

### 3c. Rút gọn còn 2 chỉ số: Thu nhập / Thực nhận
- Lưới KPI mới: **Thu nhập** (`totalCommission + totalBonusValue`) · **Thực nhận** (`totalNet` = thu nhập − TNCN) · giữ **Đơn** và banner **Điểm chuyên cần**.
- `KTVHistory.logic.ts:95-104`: thêm `totalGross = Σ(grossIncome)` (fallback `commission + (bonusValue ?? bonusPoints)`); `totalNet` đã có sẵn nhưng hiện chỉ tính khi có thuế → dùng fallback `totalNet || totalGross` để khi thuế = 0 vẫn hiển thị đúng.
- Bỏ khối "Thuế TNCN đã trừ / Thực nhận" có điều kiện ở `page.tsx:462-479` (đã gộp vào lưới chính). Dòng chi tiết trong từng đơn giữ nguyên (vẫn hữu ích để đối soát).

### 3d. Thay bộ nút mốc thời gian bằng lịch chọn ngày
**Hiện trạng:** `page.tsx:20-25` `PRESET_BUTTONS` (Hôm nay / Hôm qua / 7 ngày / Tuỳ chọn) + `page.tsx:481-517`.

**Thay đổi:**
- Xoá `PRESET_BUTTONS` và toàn bộ UI nút preset.
- Hiển thị **một cuốn lịch tháng** (tái dùng pattern lưới lịch đã có ở `app/ktv/schedule/page.tsx` để đồng bộ giao diện, tách thành component nội bộ `HistoryCalendar` trong `app/ktv/history/_components/`): điều hướng tháng ‹ ›, bấm 1 ngày → `fetchHistory(day, day)`; ngày đang chọn tô đậm; chặn chọn ngày tương lai.
- `KTVHistory.logic.ts`: bỏ `DatePreset` / `datePreset` / `setDatePreset` / `applyCustomDate`; thay bằng `selectedDate` (mặc định `getVnDateStr()`) và `selectDate(d)`; `useEffect` khởi tạo chỉ chạy 1 lần khi có `user.id`. `refetch` dùng `selectedDate`.
- Kiểm tra không còn nơi nào khác import `DatePreset` (grep trước khi xoá).

---

## Thứ tự thực hiện
1. Hạng mục 1 (độc lập, nhỏ) → build check.
2. Hạng mục 2b (`vn-time.ts` + 4 call-site + API) → 2a.
3. Hạng mục 3a/3b/3c (logic + KPI) → 3d (component lịch, phần nặng nhất).
4. `npx tsc --noEmit` + chạy dev, kiểm tra 3 màn hình trên mobile viewport.

## Điểm cần xác nhận
- **Mục 2b:** trong ảnh/mô tả có nhắc "12h" nhưng code hiện tại khoá ở **00:00**, không có mốc 12h nào cho đăng ký ngày làm. Kế hoạch đang hiểu là "bỏ mọi ràng buộc theo giờ, chỉ giữ ràng buộc theo ngày". Nếu ý là mốc khác, báo lại.
- **Mục 3b:** "bỏ ví bonus" đang hiểu là bỏ **thẻ KPI Bonus**, còn bonus vẫn nằm trong Thu nhập theo đúng công thức "Thu nhập = tiền tua + bonus".
