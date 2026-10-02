# Plan: Áp cờ "Rút tiền buổi sáng" cho ô "Yêu cầu rút tiền" lúc điểm danh

> **Mức 2** — chạm luồng ghi `KTVWithdrawals` (tín hiệu báo Thu ngân chuẩn bị tiền) trong `app/api/ktv/attendance/route.ts`.
> Ngày lập: 14/09/2026. Nhánh: `feat/bit-lo-hong-phase1`.
> **Chưa sửa code — chờ duyệt.**

---

## 1. Nguyên nhân gốc

Bảng **Admin → Cài đặt → Quản lý Tính năng KTV** có cột **"Rút tiền buổi sáng"** (cờ `Staff.feature_flags.withdraw_morning_only`). Gạt OFF nhưng form điểm danh vẫn hiện ô **"Yêu cầu rút tiền"** — vì **không có code nào đọc cờ này** khi chạy:

| Nơi | Đang quyết định bằng | Đọc cờ? |
|---|---|---|
| `app/api/ktv/attendance/status/route.ts:284, 288` | `canRequestWithdraw: !daDiemDanhHomNay` (chỉ lần điểm danh đầu ngày) | ❌ |
| `app/ktv/attendance/page.tsx:904` | `canRequestWithdraw` + ví Tua bật/tắt (`withdrawShowsMaintenance`) | ❌ |
| `app/api/ktv/attendance/route.ts:695-700` | `wantsToWithdraw` + `WalletAccessService.isEnabled(TUA)` → insert `KTVWithdrawals` | ❌ |

grep `withdraw_morning_only`: chỉ có định nghĩa cột (`KtvFeatures.logic.ts:61`), mặc định (`lib/featureFlags.ts:39` = false, `DEFAULT_FEATURE_FLAGS_TYPE_D` = true), kiểu (`lib/types/staff.types.ts`). **Công tắc chết** — cho mọi loại KTV (C và D dùng chung form điểm danh).

⚠️ Dễ nhầm: `app/api/ktv/wallet/withdraw/route.ts:52` đọc **cấu hình hệ thống** `ktv_type_d_withdraw_morning_only` (loại D chỉ rút ở trang Ví trước 12:00) — KHÔNG phải cờ từng người. Plan này không đụng nó.

---

## 2. Số liệu (DB, 14/09/2026)

| Loại | Cờ BẬT | Cờ TẮT | Chưa có (= TẮT) |
|---|---|---|---|
| A | 0 | 0 | 5 |
| B | 0 | 0 | 7 |
| C | 0 | 1 (KTV01) | 4 |
| D | 1 (T016) | 0 | 1 (T007) |

- Cột hiện ở **cả 4 tab loại** trên bảng Tính năng (`FEATURE_FLAG_DEFS` không lọc theo loại). Bảng đang hiện OFF cho 18/19 người.
- **"Báo rút tiền lúc điểm danh" 30 ngày qua: 0 lần** (`KTVWithdrawals.note = 'Báo trước lúc điểm danh (Chưa chốt số tiền)'`).

---

## 3. Thay đổi

Nghĩa cờ (theo đúng thứ Admin đang thấy): **BẬT = KTV thấy và gửi được "Yêu cầu rút tiền" khi điểm danh; TẮT / chưa có = ẩn, server bỏ qua.** Áp mọi loại KTV.

| # | File | Đổi |
|---|---|---|
| 1 | `lib/attendance/withdrawIntent.ts` (mới, hàm thuần) | `canRequestWithdrawIntent({ flags, alreadyCheckedInToday })` = `!alreadyCheckedInToday && resolveStaffFlag(flags, 'withdraw_morning_only')` — một nguồn cho cả API trạng thái và API điểm danh |
| 2 | `app/api/ktv/attendance/status/route.ts` | select thêm `feature_flags`; `canRequestWithdraw` dùng hàm #1 |
| 3 | `app/api/ktv/attendance/route.ts:695` | Lớp chặn thật (ẩn nút không phải là chặn): cờ TẮT → `withdrawIntentBlocked = true`, KHÔNG insert `KTVWithdrawals`, không nối câu "Báo Thu ngân chuẩn bị tiền mặt" |
| 4 | `app/admin/settings/system/KtvFeatures.logic.ts:62-63` | Mô tả cho đúng: *"Bật = KTV thấy ô 'Yêu cầu rút tiền' khi điểm danh (báo Thu ngân chuẩn bị tiền mặt). Tắt = ẩn."* — bỏ chữ "TYPE_D" gây hiểu nhầm |
| 5 | `app/ktv/attendance/page.tsx` | Không đổi — đã ẩn theo `canRequestWithdraw` |

Không đổi: số tiền, số dư, cọc, trang Ví, cấu hình 12:00 của loại D, `DEFAULT_FEATURE_FLAGS_*`.

---

## 4. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Form điểm danh (A/B/C/D): ô "Yêu cầu rút tiền" chỉ hiện khi cờ BẬT | Bảng Tính năng: gạt cột này giờ có tác dụng thật | `Staff.feature_flags`, `api/ktv/attendance`, `api/ktv/attendance/status` | Sửa |
| Tiền / ví | Không đổi số dư, không đổi trang Ví | Thu ngân chỉ nhận báo "chuẩn bị tiền mặt" từ người có cờ BẬT | `KTVWithdrawals` (tín hiệu `amount = 1`) | Không đổi công thức |
| Realtime | — | Thông báo `ATTENDANCE_REQUEST` bớt dòng "💰 Báo Thu ngân" khi cờ TẮT | `StaffNotifications` | Đồng bộ |
| Quyền xem | Không lộ | Không đổi | — | — |

---

## 5. Kiểm thử

- Mô phỏng hàm #1: (cờ BẬT/TẮT/chưa có/chuỗi `"true"`) × (đã/chưa điểm danh hôm nay) → 8 ca.
- Mô phỏng lớp chặn server: cờ TẮT + `wantsToWithdraw = true` → không insert (kiểm bằng hàm thuần, không ghi DB thật).
- `npx tsc --noEmit`.
- User thử trên app: KTV01 (TẮT) không thấy ô; bật cờ ở bảng Tính năng → KTV01 đăng xuất/đăng nhập lại (cờ "Ép đăng xuất khi đổi cấu hình" đang BẬT) → thấy ô; T016 (loại D, BẬT) thấy ô.

---

## 6. Ảnh hưởng vận hành (rule 5.1)

| Ai | Khác gì so với hôm nay | Cần báo / hướng dẫn gì |
|---|---|---|
| KTV | **18/19 KTV đang làm mất ô "Yêu cầu rút tiền"** lúc điểm danh (chỉ T016 còn). 30 ngày qua không ai dùng. | Ai cần báo rút tiền buổi sáng → nhờ Admin bật |
| Admin | Cột "Rút tiền buổi sáng" giờ có tác dụng thật; muốn giữ ô cho cả loại → dùng **"Bật hết"** ở tab loại đó | Bật cho người cần trước khi deploy |
| Thu ngân | Chỉ nhận báo chuẩn bị tiền mặt từ người được bật | — |

**Rủi ro & cách lùi:** revert là về như cũ; không migration, không đổi dữ liệu.
