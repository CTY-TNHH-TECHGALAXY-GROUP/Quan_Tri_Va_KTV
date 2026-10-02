# Plan: Đưa công tắc Ví + màn "bảo trì" + công tắc Trang Lịch sử lên main

> **Mức 2** — chạm ví (quyền xem/rút) và phân quyền truy cập. Chờ duyệt trước khi code.
> Ngày lập: 14/09/2026.

---

## 1. Bối cảnh & nguyên nhân gốc

- Quản lý đã tắt Ví Tua + Ví Bonus cho Loại B từ link **preview Vercel** (nhánh `feat/bit-lo-hong-phase1`):
  DB có `ktv_wallet_tua_enabled_TYPE_B=false`, `ktv_wallet_bonus_enabled_TYPE_B=false` (08/09 23:24 giờ VN) và cả 7 KTV Loại B `tua_wallet=false`, `bonus_wallet=false`.
- **Link thật chạy `main`** — main không có code đọc các công tắc này. Trên main:
  - Ví Tua: chỉ chặn bằng quyền `ktv_wallet` → luôn hiện.
  - Ví Bonus: client tự đọc `feature_flags.enable_bonus_wallet === true` → 7 KTV B đang `true` → vẫn hiện.
  - Lịch sử: chỉ chặn bằng quyền `ktv_history`; không có khái niệm "bảo trì".
- Nhánh phụ hơn main 333 commit, không merge được ngay → **port tay riêng phần này** (không cherry-pick: các commit gốc trộn ép đăng xuất, khoá tài khoản, Office points, Toast).

## 2. Hành vi mong muốn (đã chốt với user)

| Tình huống | KTV thấy |
|---|---|
| Có quyền `ktv_wallet`, ví BẬT | Ví bình thường |
| Có quyền `ktv_wallet`, ví TẮT (cả loại **hoặc** cá nhân) | Mục ví **vẫn còn**, bấm vào → "Tính năng của bạn đang bảo trì"; API trả 403 |
| Có quyền `ktv_history`, `history_page` TẮT | Menu Lịch sử **vẫn còn**, vào → "Tính năng của bạn đang bảo trì"; API trả 403 |
| Không có quyền | Ẩn như cũ |
| **Ví Bonus chỉ tồn tại ở Loại A và B.** Loại C, D | Không có mục Ví Bonus (không phải "bảo trì"), API bonus trả 403 |
| Không gọi được API kiểm quyền (lỗi mạng) | Báo lỗi kết nối, **không** báo "bảo trì" |

**Tiền không đổi:** cron `sync-daily-ledger` vẫn ghi tiền tua/bonus vào `KTVDailyLedger`; màn Tài chính giữ nguyên. Đây chỉ là chặn **xem / rút / quy đổi** phía KTV.

## 3. Cách làm

Tạo nhánh mới từ `origin/main` bằng **git worktree** (không đụng working tree đang có thay đổi dở ở `feat/bit-lo-hong-phase1`): nhánh `fix/cong-tac-vi-lich-su-main`.

### 3.1. File mới (copy từ nhánh phụ, cắt bớt)

| File | Ghi chú khi port |
|---|---|
| `lib/featureFlags.ts` | Copy. **Thêm luật:** `BONUS_WALLET_TYPES = ['TYPE_A','TYPE_B']` — `isWalletEnabled('BONUS', staff)` trả `false` nếu loại không thuộc danh sách (lệch nhánh phụ, nơi D có "Ví Điểm theo Office" — ghi chú để khi merge nhánh phụ phải xử lý). |
| `lib/services/WalletAccessService.ts` | Copy nguyên. |
| `lib/constants/featureMaintenance.i18n.ts` | Copy nguyên. |
| `lib/featureMaintenance.ts` | Copy (`featureMaintenanceBody`, `isFeatureMaintenanceError`) — `ApiError.code` đã có trên main. |
| `components/shared/FeatureMaintenanceNotice.tsx` + `.i18n.ts` | Copy, bỏ biến thể `fullscreen`/`onLogout` (của tính năng khoá tài khoản). |
| `app/api/ktv/wallet/access/route.ts` | Copy — trả `{ TUA, BONUS, work_type }`. |
| `app/ktv/wallet/KTVWallet.i18n.ts` | Copy — chữ "không kiểm tra được quyền". |
| `app/admin/settings/system/WalletSwitchesBlock.tsx` | Copy, **bỏ** khối "Ép đăng xuất" (`FORCE_LOGOUT_KEY`). Tab C/D chỉ hiện công tắc Ví Tua. |

### 3.2. File sửa trên main

| File | Thay đổi |
|---|---|
| `app/api/ktv/wallet/balance/route.ts`, `timeline/route.ts` | Thêm `denyIfDisabled(..., 'TUA')` sau khi xác định techCode. |
| `app/api/ktv/wallet/bonus/balance/route.ts`, `bonus/timeline/route.ts` | Thêm `denyIfDisabled(..., 'BONUS')`. Không mang code Office points. |
| `app/api/ktv/wallet/withdraw/route.ts` | Thêm `denyIfDisabled(..., walletType === 'BONUS' ? 'BONUS' : 'TUA')`. |
| `lib/api-endpoints.ts` | Thêm `KTV.WALLET.ACCESS`. |
| `app/ktv/wallet/KTVWallet.logic.ts` | Thay đọc thẳng `Staff.feature_flags` bằng gọi `WALLET.ACCESS`; thêm `canViewTua`, `accessError`, chọn tab lần đầu, `showTuaEntry`, `showBonusEntry = canViewBonus \|\| loại ∈ {A,B}`; bắt lỗi bảo trì khi rút/quy đổi (dùng `alert()` như main, không mang Toast). Giữ tab Tích Luỹ như main. |
| `app/ktv/wallet/page.tsx` | `accessError` → khối lỗi kết nối; tab TUA mà `!canViewTua` hoặc tab BONUS mà `!canViewBonus` → `<FeatureMaintenanceNotice/>`; danh sách chọn ví theo `showTuaEntry`/`showBonusEntry`. |
| `app/api/ktv/history/route.ts` | Nếu `!resolveStaffFlag(flags, 'history_page')` → 403 `FEATURE_MAINTENANCE`. |
| `app/ktv/history/KTVHistory.logic.ts` | State `maintenance`: bắt lỗi bảo trì → bật, xoá danh sách; thành công → tắt. |
| `app/ktv/history/page.tsx` | Sau check quyền: `maintenance` → `<FeatureMaintenanceNotice/>` (không hiện 0đ / "Chưa có đơn"). |
| `app/admin/settings/system/page.tsx` | Render `WalletSwitchesBlock` cho mọi tab loại (D render cạnh `KtvTypeDSettingsBlock`). |
| `app/admin/settings/system/KtvFeatures.logic.ts` | Thêm cột `tua_wallet` (Ví Tua), `history_page` (Trang Lịch sử); cột Ví Bonus chỉ hiện ở tab A/B; `isFlagOn = resolveStaffFlag`. |
| `app/admin/settings/system/KtvFeaturesTable.tsx` | Dùng `isFlagOn(staff, key)` thay `feature_flags[key] === true` (tránh cờ thiếu hiện OFF mà KTV vẫn BẬT). |
| `app/api/ktv/attendance/route.ts` + `app/ktv/attendance/page.tsx` | Ví Tua TẮT → server bỏ qua `wantsToWithdraw` (không tạo lệnh rút ý định), UI ẩn ô "muốn rút tiền". Chỉ lấy phần ví, không lấy phần khoá tài khoản. |

### 3.3. Cố ý KHÔNG làm

- **Không sửa** `app/ktv/dashboard/*` (vùng lõi mục 8): API ví trên Dashboard nằm trong `try/catch`, 403 chỉ log; màn chỉ có icon ví (theo quyền) dẫn tới trang Ví → màn bảo trì. Dashboard không hiện con số số dư.
- Không mang: ép đăng xuất / `SessionEpochService`, khoá tài khoản (`lock_source`, `AccountActiveDialog`), Office points, Toast, chuẩn hoá `Staff.status`.
- **Không migration.** Khoá SystemConfigs và cờ đã có trong DB (dùng chung với preview).
- Không đổi cách tính tiền/bonus/ledger.

## 4. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `/ktv/wallet`, `/ktv/history`, `/ktv/attendance` (ô rút tiền); API `ktv/wallet/*`, `ktv/history`, `ktv/attendance` | `admin/settings/system` (công tắc loại + bảng Tính năng) | `lib/featureFlags.ts`, `WalletAccessService`, bảng `Staff.feature_flags`, `SystemConfigs` | Sửa |
| Số liệu (tiền, tua, bonus) | Không tính lại gì — chỉ chặn trả dữ liệu | `app/finance/*`, `app/api/finance/*` **không** gọi `WalletAccessService` → giữ nguyên | `KtvCommissionService`, cron ledger — không đụng | Không ảnh hưởng — vì chỉ thêm cổng chặn trước khi trả dữ liệu |
| Rút tiền | KTV bị tắt ví: API rút trả 403; ô rút khi điểm danh ẩn | Duyệt lệnh rút ở Tài chính giữ nguyên; lệnh PENDING cũ vẫn duyệt được | `KTVWithdrawals` | Cần báo quầy (mục 6) |
| Realtime / refresh | Không subscribe mới; trang Ví hỏi `WALLET.ACCESS` mỗi lần tải → đổi công tắc có hiệu lực ở lần tải kế tiếp, **không cần đăng nhập lại** | Không đổi | `SystemConfigs`, `Staff` | Đồng bộ |
| Quyền xem | Chỉ thấy "bảo trì" hoặc ví của mình; không lộ lý do nội bộ | Admin thấy đủ công tắc | | Không lộ dữ liệu nội bộ |

## 5. Rủi ro dữ liệu — PHẢI chốt trước khi deploy

Giá trị thật trong DB (kiểm 14/09):

| Nhóm | Cờ hiện tại | Hôm nay (main) | Sau deploy | Cần user xác nhận |
|---|---|---|---|---|
| Loại B (7 KTV) | `tua_wallet=false`, `bonus_wallet=false`, công tắc loại B TẮT | Thấy cả 2 ví | Cả 2 ví "bảo trì" | ✅ Đúng ý |
| Loại B — Lịch sử | `history_page` chưa đặt (= BẬT) | Thấy | **Vẫn thấy** | Tắt cột "Trang Lịch sử" cho 7 KTV B (sau deploy, ở bảng Tính năng) |
| **Loại A** NH000, NH001, NH014, NH016, NH069 | `tua_wallet=false`, `bonus_wallet=false` (`enable_bonus_wallet=true`) | Thấy cả 2 ví | **Cả 2 ví "bảo trì"** | ❓ Có cố ý tắt không? Nếu không → bật lại `tua_wallet`/`bonus_wallet` trước deploy |
| **Loại A** NH099 | `tua_wallet=false` | Thấy Ví Tua | Ví Tua "bảo trì" | ❓ Như trên |
| Loại C | Không có quyền `ktv_wallet` | Không thấy ví | Không đổi | — |
| Loại D (13 KTV) | `tua_wallet=true`; NH079 `enable_bonus_wallet=true` | NH079 thấy Ví Bonus | Không ai có Ví Bonus (luật A/B) | ✅ Đúng ý user ("Loại D không có ví bonus") |

## 6. Ảnh hưởng vận hành (trình lại trước khi commit)

| Ai | Khác gì so với hôm nay | Cần báo / hướng dẫn |
|---|---|---|
| KTV Loại B | Mở Ví / Lịch sử thấy "Tính năng của bạn đang bảo trì"; không tự rút tiền trên app, không tick "muốn rút" khi điểm danh | Báo trước: thu nhập vẫn được ghi nhận, cần rút thì liên hệ quầy |
| KTV Loại A (nếu cờ ở mục 5 giữ nguyên) | Tương tự Loại B | Chốt mục 5 trước |
| KTV Loại D | NH079 mất Ví Bonus (vốn không thuộc gói D) | Không cần, hoặc báo riêng NH079 |
| Quầy / Thu ngân | KTV bị tắt ví hỏi số dư → tra ở màn Tài chính; duyệt rút như cũ | Hướng dẫn tra số dư ở `finance/ktv` |
| Admin | Có công tắc ví theo loại + cột Ví Tua, Trang Lịch sử ở bảng Tính năng trên **link thật** | Không cần ép đăng xuất — có hiệu lực ở lần tải trang kế tiếp |

**Rủi ro & cách lùi:** revert 1 commit là về như cũ; không ghi dữ liệu nào (trừ khi admin bấm công tắc — bật lại được).
**Deploy:** nhánh `fix/cong-tac-vi-lich-su-main` → PR vào `main`. Không migration. Làm mục 5 trước.
**Khi merge nhánh `feat/bit-lo-hong-phase1` sau này:** các file trên sẽ xung đột; lấy bản nhánh phụ nhưng giữ luật "Ví Bonus chỉ A/B" (nhánh phụ đang cho D có Ví Điểm Office — cần user chốt lại lúc đó).

## 7. Test (mock + gọi route thật trên local, dưới cả `TZ=UTC`)

1. `featureFlags` — bảng chân trị: loại {A,B,C,D} × công tắc loại {thiếu, true, false, `"true"`, `'"false"'`} × cờ cá nhân {thiếu, true, false} × alias `enable_bonus_wallet` cho cả TUA và BONUS. C/D luôn BONUS=false.
2. API: KTV B tắt ví → `balance`, `timeline`, `bonus/*`, `withdraw` đều 403 `WALLET_DISABLED`; KTV A bật → 200, số dư **bằng đúng** trước khi port.
3. `history`: `history_page=false` → 403 `FEATURE_MAINTENANCE`; thiếu cờ → 200.
4. Trang Ví: tắt TUA bật BONUS → mở thẳng tab BONUS lần đầu; bấm lại TUA → thấy màn bảo trì (không bị đá về BONUS).
5. Lỗi mạng khi gọi `WALLET.ACCESS` → báo lỗi kết nối, không báo bảo trì.
6. Rút tiền: đang mở trang thì admin tắt ví → bấm rút → báo bảo trì, trang tự chuyển màn bảo trì.
7. Điểm danh: Ví Tua tắt → không có ô rút; gửi `wantsToWithdraw=true` thẳng API → không tạo `KTVWithdrawals`.
8. Dashboard KTV B: không crash, icon ví vẫn còn, bấm vào ra màn bảo trì. 4 luồng lõi (mục 8) không bị đụng.
9. Đối chiếu 2 phía: màn `finance/ktv` cho NH025 cùng khoảng ngày trước/sau port → số bằng nhau.
10. `npx tsc --noEmit` sạch.

## 8. Quyết định của user (14/09/2026) — ĐÃ DUYỆT

1. 5 KTV Loại A (NH000, NH001, NH014, NH016, NH069) + NH099 tắt ví: **cố ý** → giữ nguyên dữ liệu.
2. Sửa luồng "muốn rút tiền" khi điểm danh: **OK**.
3. NH079 (Loại D) mất Ví Bonus: **OK**.

Thực thi trên worktree `../QTKTV_port_main`, nhánh `fix/cong-tac-vi-lich-su-main` (từ `origin/main`).

## 9. Trạng thái thực thi (14/09/2026) — ĐÃ MERGE VÀO MAIN

- Commit `e21a9dbd` trên nhánh `fix/cong-tac-vi-lich-su-main` (đã push), fast-forward vào `origin/main` ngày 14/09/2026 (không mở PR theo yêu cầu user).
- Admin đã tắt `history_page` cho 7 KTV Loại B trên preview trước khi merge (DB dùng chung).
- Fast-forward `main` → `e21a9dbd` không sinh deploy Production. Đã push commit rỗng `c538db6d` → project **`tech-galaxy/quan-tri-va-ktv` (Pro, link thật) deploy thành công** ("Deployment has completed").
- Bình luận "Deployment failed: Hobby accounts are limited to daily cron jobs" là của project phụ `test-98d3c5e6/quan-tri-va-ktv` (Hobby) — không ảnh hưởng link thật.
- Khi merge `feat/bit-lo-hong-phase1` vào main sau này: xung đột ở `lib/featureFlags.ts`, `WalletAccessService`, trang Ví/Lịch sử/Cài đặt — giữ luật "Ví Bonus chỉ A/B" hoặc chốt lại với user.

**Lệch nhỏ so với mục 3 (có chủ đích):**
- Ô "Yêu cầu rút tiền" khi điểm danh: không ẩn trơn mà thay bằng thẻ "Tính năng của bạn đang bảo trì" (đúng quy tắc "còn mục + báo bảo trì" user yêu cầu).
- Bảng Tính năng: chỉ 3 cờ `tua_wallet`, `bonus_wallet`, `history_page` đọc qua `resolveStaffFlag`; các cờ khác giữ cách đọc `=== true` như cũ để không đổi hiển thị.
- Không đụng `app/ktv/dashboard/*`.

**Kết quả kiểm:**
- `npx tsc --noEmit` trên worktree: 0 lỗi.
- `scripts/qa/qa_wallet_switch_main.ts` (chạy `TZ=UTC`): 33/33 kiểm tra logic đạt; mô phỏng dữ liệu thật (chỉ đọc) — A (5 KTV) & B (7 KTV): Ví Tua/Bonus → BẢO TRÌ; C không đổi; D: Ví Tua OK, không có Ví Bonus; Lịch sử B vẫn OK (chờ admin tắt cờ).
- Gọi API thật trên dev server worktree (GET, chỉ đọc): NH021/NH025 → 403 `WALLET_DISABLED` ở `balance`, `timeline`, `bonus/balance`, `bonus/timeline`; T007 (D) Ví Tua 200, Ví Bonus 403; `access` trả đúng; `history` NH021 200.
- **Chưa kiểm được:** giao diện trang Ví / Lịch sử / Cài đặt (cần đăng nhập — user tự xem trên preview của nhánh), POST `withdraw` và POST điểm danh (ghi dữ liệu thật — chỉ kiểm bằng đọc code + tsc), `attendance/status` (route có nhánh tự cho KTV offline — không gọi trên DB thật).
