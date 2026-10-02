# Fix — Loại D báo "Tính năng không khả dụng / Bạn chưa được cấp quyền sử dụng chế độ Nhận Đơn"

> Prompt gửi cho anti. Nối tiếp `plans/plan_type_d_tan_ca_bat_nhan_don.md`. Áp dụng **ANTIGRAVITY MODE**.

---

## 1. Đã chẩn đoán xong — không cần đoán lại

Màn hình vàng đó là `app/ktv/attendance/_components/AttendanceTypeD.tsx:96-102`, bung ra khi `state.allow_on_call === false`.

Giá trị đó đến từ `app/api/ktv/type-d/on-call/route.ts:32`:

```ts
const allow_on_call = data?.work_type === 'TYPE_D' && featureFlags.allow_on_call === true;
```

Tôi đã query thẳng DB production (chỉ đọc). **Cả 12/12 KTV TYPE_D đều có `feature_flags.allow_on_call = false`**:

```
T027 Sunny | T021 Ua | T002 NHI | T001 Phát | T069 JK | T025 Rose
T079 Hiếu  | T011 Yully | T016 Tieu Kim Nghi | T018 Cherry
NH079 Huỳnh Ngọc Tuấn Hiếu | T014 Tea
→ allow_on_call = false, cả 12 người
```

Nên UI đúng, API đúng, **dữ liệu sai**. Code chặn đúng như được viết.

### Vì sao dữ liệu sai: sửa mới 1 trong 2 chỗ định nghĩa mặc định

Đợt trước đã sửa `app/admin/settings/system/KtvFeatures.logic.ts:113` từ `false` → `true`. Nhưng:

**a) Hàm đó không backfill ai cả.** `getDefaultFlagsForType` chỉ được gọi đúng 1 chỗ: `KtvFeatures.logic.ts:194` trong `updateWorkType` — tức chỉ chạy khi admin **đổi loại** cho một người trong bảng Admin. 12 KTV D đang tồn tại không bao giờ đi qua đường đó, nên cờ trong DB vẫn nguyên `false`.

**b) Còn một nguồn mặc định thứ hai chưa sửa.** `lib/constants/staff.constants.ts:27`:

```ts
export const DEFAULT_FEATURE_FLAGS_TYPE_D: FeatureFlagsTypeD = {
    ...
    allow_on_call: false,     // ← vẫn false
```

Đây là hằng dùng khi **tạo nhân viên mới** (`app/admin/employees/actions.ts:133`). Nên kể cả sau khi backfill 12 người cũ, mọi KTV Loại D tạo mới từ hôm nay vẫn dính đúng màn hình vàng này. Hai nguồn mặc định cùng mô tả một quyết định — đúng kiểu lỗi mà rule antigravity nhắm tới.

---

## 2. Việc phải làm

### Bước 1 — Gom một nguồn mặc định duy nhất (bắt buộc, làm trước)

`lib/constants/staff.constants.ts` là nguồn thật (nằm ở `lib/`, không phụ thuộc UI admin).

- Sửa `DEFAULT_FEATURE_FLAGS_TYPE_D.allow_on_call` → `true`.
- Rà cả `DEFAULT_FEATURE_FLAGS_TYPE_A` / `_TYPE_B` xem có lệch với `getDefaultFlagsForType` ở cờ nào khác không — báo lại bảng so sánh, đừng im lặng sửa.
- `getDefaultFlagsForType` trong `KtvFeatures.logic.ts` phải **import và trả về các hằng đó**, không tự khai lại object. Sau bước này chỉ còn 1 chỗ định nghĩa mặc định cho mỗi loại.

### Bước 2 — Backfill 12 KTV Loại D hiện có

Viết script một lần `scripts/backfill_type_d_allow_on_call.ts` (đừng sửa tay trên Supabase UI — cần vết để lặp lại được trên môi trường khác):

- Lấy toàn bộ `Staff` có `work_type = 'TYPE_D'`.
- Với từng người: `feature_flags = { ...feature_flags, allow_on_call: true }` — **merge, không ghi đè cả object** (họ đang có `internal_fund_enabled`, `withdraw_morning_only`, `tua_wallet`, `bonus_wallet`... mất là hỏng ví và quỹ nội bộ).
- In ra trước/sau cho từng mã NV.
- Chạy được nhiều lần mà không hại (idempotent).

### Bước 3 — Xác nhận quy tắc đọc quyền

Giữ nguyên `isTypeD && featureFlags.allow_on_call === true` ở `type-d/on-call/route.ts` và `KtvTypeDOnlineService`. Lý do: cờ tường minh thì admin còn tắt được cho từng người trong tab "Loại D" (bảng đã có sẵn toggle `🛵 Nhận đơn ngoài giờ` và nút bật hàng loạt).

Chú ý điểm bất đối xứng, ghi lại chứ **không đổi**: route của B là `isTypeB || flag` (loại B mặc định luôn có quyền, cờ chỉ để mở thêm cho A/C), route của D là `isTypeD && flag`. Khác nhau có chủ đích — D là quyền cấp theo người, B là quyền theo loại. Nếu sau này anh muốn D giống B thì đổi thành `isTypeD` và bỏ cờ, nhưng lúc đó mất khả năng tắt cho từng người.

---

## 3. Hai lỗi khác trong code vừa viết, sửa luôn trong đợt này

### 3.1. `isOffToday` tính lệch ngày so với phần còn lại của hệ thống

`app/api/ktv/type-d/on-call/route.ts:34-42` dựng `businessDateStr` bằng cách trừ `spa_day_cutoff_hours` (6h) rồi tra `KTVTypeDDailyRegistration.work_date`.

Nhưng `app/api/ktv/daily-registration/route.ts` và `app/api/ktv/attendance/route.ts:165` đều dùng `vnToday()` — **ngày lịch VN, không trừ cutoff**.

→ Trong khung 00:00–06:00, GET này tra ngày hôm qua trong khi lúc đăng ký ghi vào ngày hôm nay. KTV D làm ca khuya sẽ thấy sai trạng thái OFF.

Sửa: dùng `vnToday()` từ `lib/vn-time`, khớp với bảng `KTVTypeDDailyRegistration`. `businessDate` chỉ dùng cho `TurnQueue`/`KTVShifts` — hai thứ đó đúng là theo Business Date, giữ nguyên.

### 3.2. `isOffToday` chặn cả nút Tan Ca → KTV bị kẹt

`AttendanceTypeD.tsx:104-110` early-return toàn màn hình khi `isOffToday`, đặt **trước** mọi nhánh trạng thái. Hệ quả: một KTV D đang `AT_VENUE` (đã Oria Xin chào, đang làm) mà bản ghi ngày chuyển sang `OFF_REGISTERED` — hoặc chỉ đơn giản là dính lệch ngày ở §3.1 — sẽ **mất luôn nút "Oria Xin cảm ơn"**, không tan ca được, phải nhờ admin can thiệp DB.

Sửa: `isOffToday` chỉ được khoá **hai nút vào việc** (`Oria Xin chào`, `Bật Nhận Đơn`) trong nhánh `isOffline`. Nhánh `isAtVenue` phải luôn hiện nút tan ca. Hiển thị banner "Hôm nay bạn đã đăng ký nghỉ" phía trên thay vì thay thế cả màn hình.

---

## 4. Cách verify

1. Chạy script backfill → in ra 12 dòng, tất cả `allow_on_call: false → true`.
2. Query lại DB xác nhận 12/12 đã `true` **và** các cờ khác (`tua_wallet`, `bonus_wallet`, `internal_fund_enabled`, `withdraw_morning_only`) còn nguyên. Dán kết quả.
3. Đăng nhập bằng `NH079` → màn Chấm Công hiện `ĐANG TẮT` với 2 nút, **không còn màn vàng**.
4. Tạo mới 1 KTV Loại D trong Admin → vào app thấy ngay 2 nút (chứng minh Bước 1 đã đóng nguồn thứ hai).
5. Trong tab Admin "Loại D", tắt `🛵 Nhận đơn ngoài giờ` cho 1 người → người đó thấy lại màn vàng; bật lại → hết. Chứng minh cờ vẫn còn tác dụng hai chiều.
6. Đăng ký OFF hôm nay → hai nút vào việc bị khoá kèm lý do, nhưng **nếu đang AT_VENUE thì nút tan ca vẫn còn** (§3.2).
7. Chỉnh giờ máy về 01:00 (hoặc test hàm trực tiếp) → `isOffToday` trả cùng kết quả với `daily-registration` (§3.1).
8. **Hồi quy Loại B**: `on-call/route.ts`, `KtvOnlineService.ts`, `AttendanceTypeB.tsx` không đổi một dòng — dán `git diff --stat` chứng minh.
9. `npx tsc --noEmit` sạch; `npm run test:type-d` xanh.

---

## 5. Output bắt buộc

- Bảng so sánh `DEFAULT_FEATURE_FLAGS_*` với `getDefaultFlagsForType` trước/sau khi gom.
- Log script backfill (12 dòng) + query xác nhận sau backfill.
- Xác nhận sau khi gom, `allow_on_call` cho TYPE_D chỉ còn **đúng 1 chỗ** định nghĩa mặc định trong toàn repo (`grep -rn "allow_on_call" lib/ app/` và dán kết quả).
- Chỗ nào còn risk chưa đóng.
