# Plan — Sửa thưởng 4★ bị nhân đôi khi khách có dịch vụ thêm (addon)

> Mức 2 — chạm `lib/services/KtvDLedgerEngine.ts` (công thức tiền loại D).
> Ngày: 2026-10-02 · Nhánh: `feat/bit-lo-hong-phase1`

## 1. Nguyên nhân gốc rễ (đã xác nhận bằng dữ liệu thật)

`applyBonusAndTax` coi mỗi `group_id` là một khách. Nhưng `group_id = options.mergedIntoId || item.id`,
nên dịch vụ thêm (addon) **không gộp** sẽ có `group_id` riêng dù cùng một khách.

Dữ liệu thật đơn `005-02102026` (bill đã tách -A / -B theo khách):

| Bill | KTV | Item | guest_id | group_id | bonus |
|---|---|---|---|---|---|
| -A | T027 | item1 (NHS0100) | A_guest_1 | item1 | 20.000 |
| -A | T027 | A-addon-…-0 | A_guest_1 | A-addon-…-0 | 20.000 ❌ |
| -B | T021 | item2 (NHS0100) | B_guest_1 | item2 | 20.000 |
| -B | T021 | B-addon-…-0 | B_guest_1 | B-addon-…-0 | 20.000 ❌ |

Quét toàn bộ `KTVDTurnLedger` (29 dòng có thưởng): **chỉ đơn này** bị trùng — dư 40.000đ trước thuế
(mỗi KTV dư 20.000đ, thuế 10% cũng tính dư 2.000đ → dư 18.000đ thực nhận/người).

## 2. Thay đổi

**Chỉ 1 file:** `lib/services/KtvDLedgerEngine.ts`, hàm `applyBonusAndTax`.

```ts
// Khách thật: guest_id; đơn cũ chưa có BookingGuests thì lùi về group_id.
const guestKey = (r: TurnRow) => r.guest_id || r.group_id;
```
Dùng `guestKey(r)` thay cho `r.group_id` ở **cả hai** chỗ: đếm `staffPerGuest` và khoá `paid`.
Sửa comment JSDoc của `bonus_amount` / `applyBonusAndTax` cho khớp.

Không đổi: `group_id`, `bill_suffix`, `groupForHistory`, DB, migration.

## 3. Hệ quả nghiệp vụ (đổi so với hôm nay)

| Tình huống | Trước | Sau |
|---|---|---|
| 1 khách, 1 KTV, 2 dịch vụ không gộp (addon) | 2 suất | **1 suất** ✅ (lỗi đang sửa) |
| 1 khách, 2 KTV loại D, mỗi KTV 1 dịch vụ khác nhau (không gộp) | mỗi KTV 1 suất trọn | **chia đôi** — đúng luật "1 khách = 1 suất, chia đều số KTV D" |
| 1 khách, dịch vụ gộp (`mergedIntoId`) | 1 suất | 1 suất (không đổi) |
| Đơn cũ không có `guest_id` | theo group_id | theo group_id (không đổi) |
| 2 khách khác nhau | 2 suất | 2 suất (không đổi) |

⚠️ Dòng 2 là thay đổi hành vi có chủ đích — cần user xác nhận đúng luật spa.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `app/ktv/wallet`, `api/ktv/wallet/{timeline,bonus/balance}`, `api/ktv/history` | `app/finance/ktv`, `api/finance/staff-ledger`, `api/finance/ktv-bonus-summary` | `KTVDTurnLedger.bonus_amount` do engine ghi | Không sửa code — chỉ đọc cột, tự đúng sau khi tính lại |
| Số liệu | ví/lịch sử cộng `commission_net + bonus_amount − tax_amount` | staff-ledger cộng y hệt | công thức duy nhất ở `applyBonusAndTax` | Khớp (cùng nguồn) |
| Realtime / refresh | đọc sổ cái | đọc sổ cái | ledger ghi lại qua `recomputeTurnRows` | Đồng bộ sau khi recompute |
| Quyền xem | không đổi | không đổi | | Không lộ dữ liệu |

Lịch sử KTV (`groupForHistory`) vẫn tách 2 dòng (theo group_id) nhưng chỉ 1 dòng mang thưởng — tổng đúng.
Hiển thị hậu tố bill kiểu `005-02102026-A-B` là chuyện riêng, **ngoài phạm vi**.

## 5. Kiểm thử

1. Thêm case vào `scripts/qa/qa_10_bonus_in_turn.ts`:
   - 1 khách / 1 KTV / 2 group khác nhau cùng guest_id → 20.000
   - 2 khách (A, B), mỗi khách 2 dịch vụ addon, mỗi khách 1 KTV → mỗi KTV 20.000, tổng 40.000
   - 1 khách / 2 KTV / 2 group khác nhau cùng guest_id → mỗi người 10.000
   - guest_id null, 2 group → 2 suất (giữ hành vi đơn cũ)
   - thuế = (tua + thưởng) × 10% vẫn đúng
2. Mô phỏng lại đơn 005-02102026 bằng fixture đúng dữ liệu thật qua `computeRows`, in trước/sau.
3. Chạy thêm dưới `TZ=UTC`.

## 6. Sửa dữ liệu đơn 005-02102026 (sau khi deploy code)

Gọi `recomputeTurnRows` cho 4 item của 2 bill -A, -B (script một lần, in trước/sau).
Kiểm `rowsSkippedLocked` = 0 — nếu dòng đã khoá (đã chốt/rút) thì báo lại, không ép ghi.
Kết quả mong đợi: T021 và T027 mỗi người còn 20.000đ thưởng.

## 7. Chốt luật (user xác nhận 2026-10-02) & kết quả

- Tách đơn = mỗi đơn con 1 khách. Gộp chung = 1 khách. Nối tiếp/song song = 1 item, 1 khách,
  màn khách đánh giá 1 lần cho cả 2 KTV → 20k chia đều.
- Dịch vụ thêm: xét theo `guest_id` của đơn con → 1 khách, tối đa 20k (1 KTV nhận trọn, nhiều KTV chia đều).
- Đã sửa `applyBonusAndTax` (khoá `guest_id || group_id`). `qa_10_bonus_in_turn.ts` thêm B1b, B1c:
  code mới ĐẠT toàn bộ (Asia/Bangkok + UTC); code cũ HỎNG 9 case mới.
- Còn lại: recompute sổ cái 4 item đơn 005-02102026 (mục 6) — chờ user cho phép ghi DB.
