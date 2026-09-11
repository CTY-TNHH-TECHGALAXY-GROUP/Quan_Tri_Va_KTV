# Plan — Công tắc "Hoạt động" + "Trang Lịch sử" + câu bảo trì + ghim cột Mã NV

**Mức 2** — đụng khoá/mở khoá tài khoản (Auth), thêm cột DB (`Staff.lock_source`), sửa cron kỷ luật, đụng thông báo/luồng Ví.
**Nơi đặt công tắc:** bảng Tính năng nhân viên ở `admin/settings/system` (`KtvFeaturesTable`).
**Bản 3** — đã chốt quy tắc báo bảo trì và cách xử lý khoá kỷ luật (xem mục 1).

---

## 1. Yêu cầu & quyết định đã chốt

| # | Nội dung | Trạng thái |
|---|---|---|
| A | Cột **"Hoạt động"** (tên cũ trong plan: "Mở app"): BẬT = KTV dùng được app, TẮT = khoá tài khoản. Dùng CHUNG trạng thái với Khoá/Mở khoá bên Office | Chốt tên "Hoạt động" |
| B | Cài đặt BẬT → Office không hiện "Mở khóa"; TẮT → Office hiện "Mở khóa" | — |
| C | Cột **"Trang Lịch sử"** theo từng người | — |
| D | Ghim cột **Mã NV** khi kéo ngang | — |
| E | **Quy tắc câu bảo trì:** tính năng bị TẮT **mà quyền vẫn còn** → luôn báo đúng *"Tính năng của bạn đang bảo trì"* ở mọi lối vào. **Quyền cũng tắt** → coi như không có tính năng, ẩn như hiện nay | **Chốt** |
| F | Khoá kỷ luật **giữ nguyên lý do**; chỉ khoá do tắt "Hoạt động" mới báo bảo trì → cần cột `Staff.lock_source` | **Chốt** |
| — | Phí kích hoạt lại | **Không sửa** — tiền thu thủ công |
| — | Nhập Tip | **Bỏ** — tính năng không còn |

### Quy tắc E áp vào đâu

Quyền (vai trò, trang Phân quyền) chính là dấu hiệu "đã được cấp" — nhờ vậy không còn nhầm "admin vừa tắt" với "chưa từng có".

| Công tắc | Quyền đi kèm | Áp quy tắc? |
|---|---|---|
| Trang Lịch sử (`history_page`, mới) | `ktv_history` | **Có** |
| Ví Tua / Ví Thu Nhập (`tua_wallet` + công tắc cả loại) | `ktv_wallet` | **Có** |
| Ví Bonus / Ví Điểm (`bonus_wallet` + công tắc cả loại) | `ktv_wallet` | **Có** |
| Hoạt động (khoá tay) | — (cấp tài khoản) | **Có** — theo quyết định F |
| Bàn giao công việc (`enable_employee_tasks`) | Không có lớp quyền riêng: với KTV, `hasPermission('employee_tasks')` **chính là** cờ này | Không — giữ như cũ |
| Nhận đơn ngoài giờ, KPI Demo | Không có quyền đi kèm | Không — giữ như cũ |
| Trừ giặt đồ, Phạt nghỉ ĐX, Phí bảo trì, Rút tiền buổi sáng | Không có màn phía KTV | Không áp dụng |

---

## 2. Rà soát — lý do thiết kế (workflow 8 agent + tự kiểm lại)

1. **Cờ phía KTV cũ suốt phiên.** `user.featureFlags` chỉ nạp lúc đăng nhập; Realtime `Staff` bỏ qua `feature_flags`; ép đăng xuất mặc định TẮT → không thể dựa vào cờ ở client.
2. **Lỗi API bị nuốt.** `KTVHistory.logic.ts:121` / `:222` nuốt lỗi → chặn ở server mà không sửa client thì KTV thấy "Chưa có đơn hàng nào." + 0đ.
3. **Ví đang ẩn lặng lẽ:** tắt 1 ví thì ví đó biến khỏi danh sách chọn (`wallet/page.tsx:171/180`); câu hiện tại "Ví đang bảo trì" (`:204`) sai câu và lỗi mạng cũng hiện câu đó; toast "Lỗi: Ví Tua của bạn hiện đang tắt…" (`KTVWallet.logic.ts:96/130`); ô Điểm Office loại D biến mất (`office-score/route.ts:42`).
4. **Khoá tay / khoá kỷ luật không phân biệt được** qua dữ liệu hiện có; màn khoá viết cứng "khóa kỷ luật" (`AccountLockedScreen.tsx:27`, fallback `AppLayout.tsx:66/71`).
5. **Màn khoá mất khi chuyển trang** (state riêng từng trang, `AppLayout.tsx:30`), **không hiện khi mở lại app**, nhánh gỡ khoá dựa `payload.old` (cần `REPLICA IDENTITY FULL`, repo không có).

---

## 3. Thiết kế

### Nguyên tắc chung

- **Server là nguồn sự thật.** Tắt/bật có hiệu lực ở lần gọi API kế tiếp, không cần đăng nhập lại.
- **Một câu:** `FEATURE_MAINTENANCE_MESSAGE = 'Tính năng của bạn đang bảo trì'` + mã `FEATURE_MAINTENANCE` trong `lib/constants/featureMaintenance.i18n.ts` (`.ts` thuần, route lẫn client import được).
- **Một component:** `components/shared/FeatureMaintenanceNotice.tsx` — biến thể `inline` và `fullscreen`, nằm trên toast (`z-[9999]`).
- **Thứ tự kiểm ở mọi trang:** không có quyền → giữ màn "không có quyền" như cũ → có quyền mà tính năng tắt → `FeatureMaintenanceNotice`.
- **Không ẩn** mục menu nào vì cờ tắt.

### C. Trang Lịch sử

1. Cờ `history_page`, **thiếu cờ = BẬT** (thêm vào `FLAG_DEFAULT_WHEN_MISSING` — thiếu bước này cả tiệm thấy bảo trì). Thêm vào `FEATURE_FLAG_DEFS` + mặc định 4 loại.
2. Server: `GET /api/ktv/history` và `GET /api/ktv/hours-ledger` → cờ tắt trả `403 { code: 'FEATURE_MAINTENANCE', error: <câu bảo trì> }`.
3. Client: `KTVHistory.logic.ts` bắt mã đó → state `maintenance` → trang chỉ vẽ notice (không vẽ ô 0đ/lịch/danh sách). Kéo làm mới vẫn hỏi server.
4. Không sửa `hasPermission('ktv_history')`, Sidebar, `NotificationProvider`.
5. Không chặn dữ liệu đơn trong trang Ví (`wallet/timeline`) — đó là tính năng Ví, có công tắc riêng.

### Ví (quy tắc E)

6. `walletDisabledMessage()` (`lib/featureFlags.ts:182`, nơi gọi duy nhất: `WalletAccessService`) → trả câu bảo trì. Một dòng này sửa chữ cho mọi route ví (số dư, lịch sử ví, rút tiền, đổi điểm). Giữ mã `WALLET_DISABLED` (không client nào đọc mã này — đã kiểm).
7. `app/ktv/wallet/page.tsx`: ví bị tắt **vẫn còn trong danh sách chọn**, chọn vào thì hiện notice; câu "Ví đang bảo trì" → câu chuẩn; **lỗi mạng hiện lỗi mạng**, không nhận vơ là bảo trì.
8. `KTVWallet.logic.ts`: toast rút tiền/đổi điểm gặp `WALLET_DISABLED` → đúng câu bảo trì, bỏ tiền tố "Lỗi: ".
9. Ô Điểm Office loại D: `office-score` trả `disabled: true` thay vì `applicable: false` khi Ví Điểm tắt → Dashboard hiện ô với câu bảo trì; modal Điểm Office thay nội dung bằng notice (đang giữ số liệu cũ).
10. Điểm danh: ô "Yêu cầu rút tiền" (`attendance/page.tsx:901`) + insert tín hiệu rút (`api/ktv/attendance/route.ts:685`) — Ví Tua tắt thì **không** ghi tín hiệu rút (điểm danh vẫn thành công) và hiện câu bảo trì thay cho ô tích.

### A+B+F. Hoạt động

11. **Cột mới `Staff.lock_source`** (`text NULL`, CHECK `IN ('MANUAL','DISCIPLINE')`) — migration + `TableInSupabase.md`. Ghi **cùng câu UPDATE** với `status`:
    - `POST /api/admin/staff/lock` (mới) → `'MANUAL'`.
    - `POST /api/admin/staff/unlock` → `NULL` (thêm 1 trường; **không đụng phí**).
    - Cron `daily-absence-check` (3 chỗ) + `ktv/discipline/reject-order` (1 chỗ) → `'DISCIPLINE'` (thêm 1 trường).
    - `admin/employees/actions.ts:176` rời trạng thái khoá → `NULL`.
12. Route khoá (quyền `staff_features`): bắt buộc lý do; chỉ khoá người `ĐANG LÀM`; **chặn khi KTV đang có đơn chưa xong** (409 kèm mã đơn — truy vấn chốt khi code sau khi đọc `TableInSupabase.md` phần `BookingItems`/`KtvAssignments`); `invalidateLockedStaffCache()`; `SecurityAuditLogs` `MANUAL_LOCK`; thông báo KTV đúng câu bảo trì; **không** ghi `KTVDPenaltyLedger`.
13. Bật lại = gọi đúng `POST /api/admin/staff/unlock` như Office (hộp thoại lý do).
14. Mọi chỗ KTV thấy "bị khoá" rẽ nhánh theo `lock_source`: `MANUAL` → câu bảo trì; còn lại → **giữ nguyên lý do kỷ luật**. Các chỗ: đăng nhập (`login/actions.ts:137`, `login/page.tsx:28`), `attendance/status` (trả thêm `lockKind`), `AccountLockedScreen`, fallback `AppLayout.tsx:66/71`, `auth-server.ts` `requireActiveStaff`.
15. **Để "luôn" thật sự luôn:** `GET /api/auth/session-check` (client hỏi mỗi 60s + mỗi lần quay lại tab, chạy được cả khi JWT hết hạn) trả thêm `locked` + `lockKind` → `auth-context` set `lockedInfo` **toàn cục** (biến có sẵn, chưa từng được set) → `AppLayout` đã đọc sẵn → màn không mất khi chuyển trang, hiện cả khi mở lại app, tự gỡ khi mở khoá.
16. Bảng Tính năng: `GET /api/admin/staff-features` lấy cả `ĐANG LÀM` lẫn `KHÓA_TÀI_KHOẢN` (không thì tắt xong dòng biến mất); dòng bị khoá có nhãn; 2 chiều đều hỏi xác nhận + lý do.

### D. Ghim cột Mã NV

17. `th`/`td` Mã NV: `sticky left-0 z-10` + nền trắng (giữ khi hover) + viền phải mờ.

### Kiểm tra

18. `tsc`, `eslint`, `npm run test:qa`. Thêm **`qa_15_feature_off_maintenance.ts`**:
    - `history_page` thiếu = BẬT; tắt → 2 route trả 403 `FEATURE_MAINTENANCE` đúng câu.
    - Ví tắt (cờ người / công tắc loại) → `WalletAccessService` trả đúng câu bảo trì; điểm danh không ghi tín hiệu rút khi Ví Tua tắt.
    - `lock_source`: khoá tay `'MANUAL'`, kỷ luật `'DISCIPLINE'`, mở khoá `NULL` — cùng câu với `status`.
    - Khoá tay → đăng nhập / session-check / attendance-status ra câu bảo trì; khoá kỷ luật vẫn ra lý do cũ; khoá tay không ghi `KTVDPenaltyLedger`.
    - Bảng Tính năng vẫn thấy người bị khoá.
    - Soi mã: câu bảo trì chỉ nằm ở hằng số, không viết tay chỗ khác.
    - Cập nhật **qa_06 F4** (đang đếm theo `ĐANG LÀM`).

---

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Lịch sử, Ví, ô Điểm Office + modal, Điểm danh (ô rút tiền), đăng nhập, màn khoá, `AppLayout`, `auth-context`; API `ktv/history`, `ktv/hours-ledger`, `office-score`, `ktv/attendance` (POST), `attendance/status`, `auth/session-check`. **Không** sửa Sidebar, NotificationProvider | Bảng Tính năng (2 cột + ghim), `staff-features` GET, route mới `staff/lock`, `staff/unlock` (+1 trường), `employees/actions.ts` (+1 trường). **Office không sửa** | Cột mới `Staff.lock_source`; `featureFlags.ts` (`walletDisabledMessage`, cờ mới); `staff.constants`; hằng câu bảo trì; `FeatureMaintenanceNotice`; cron kỷ luật + `reject-order` (+1 trường) | Sửa |
| Số liệu (tiền / giờ / điểm) | Không đổi công thức. Tính năng tắt thì không hiện số (không hiện 0đ giả). Ví Tua tắt thì không phát tín hiệu rút lúc điểm danh | Phí kích hoạt lại, số dư ví, sổ tua không đổi | Không sửa công thức nào | Khớp |
| Realtime / refresh | Khoá/bảo trì: session-check ≤60s hoặc ngay khi quay lại tab (+ Realtime nếu có). Lịch sử/Ví: có hiệu lực ở lần gọi API kế tiếp | Office đọc `status` khi tải trang | `Staff.status`, `Staff.lock_source`, `Staff.feature_flags` | Đồng bộ; Office cần tải lại trang |
| Quyền xem | Không quyền → như cũ. Có quyền + tắt → câu bảo trì. Khoá kỷ luật → vẫn thấy lý do | Khoá: `staff_features`. Mở khoá: `dashboard` như Office (không đổi) | — | Không lộ dữ liệu nội bộ |

---

## 5. Còn lại trước khi code

- **`app/ktv/history/page.tsx` đang có thay đổi chưa commit từ cửa sổ khác** (kiểm lại lúc viết bản 3: vẫn `M`). Cần cửa sổ đó xong/commit trước.
- Duyệt plan bản 3.

---

## 6. Ngoài phạm vi — phát hiện trong lúc rà (đã tự kiểm lại)

- **Loại D kẹt trạng thái "nhận đơn ngoài giờ"** (`type-d/on-call/route.ts:83` kiểm quyền trước nhánh tắt) — đã tạo việc riêng.
- `GET /api/ktv/history` không kiểm phiên — ai biết `techCode` cũng đọc được lịch sử (kể cả sổ kỷ luật) của KTV đó.
- Mở khoá chỉ cần quyền `dashboard` — lễ tân mở khoá được.
- Ví Điểm tắt nhưng trang Lịch sử vẫn hiện điểm bonus từng đơn (route lịch sử chỉ đọc `enable_bonus`).

---

## 7. Đã triển khai — chỗ khác plan bản 3

| Plan | Thực tế | Lý do |
|---|---|---|
| Route khoá dùng quyền `staff_features` | Dùng `system_settings` | `staff_features` **không có trong `MODULES`** → admin dùng quyền dự phòng bị chặn (cùng bẫy `turn_tracking` trước đây). Bảng Tính năng nằm trên trang `system_settings` nên đúng nhóm người |
| Sửa cron kỷ luật (3 chỗ) + `reject-order` + `employees/actions.ts` + `staff/unlock` để ghi/xoá `lock_source` | **Trigger DB** `staff_clear_lock_source_trigger`: `status` rời `KHÓA_TÀI_KHOẢN` là tự xoá `lock_source` | Phủ mọi chỗ ghi `status` (kể cả chỗ chưa biết), không đụng cron kỷ luật lẫn route mở khoá có thu phí. Quy ước: `NULL` = khoá kỷ luật / dữ liệu cũ |
| Ví bị tắt vẫn hiện trong danh sách chọn | Ví Tua luôn hiện; Ví Bonus hiện khi đang bật **hoặc** thuộc gói mặc định của loại (A, D) | Quyền `ktv_wallet` phủ cả trang chứ không riêng từng ví → không phân biệt được "admin tắt" với "loại B/C chưa từng có Ví Bonus". Gói mặc định của loại là dấu hiệu "đã được cấp" |

Kiểm tra: `tsc` sạch; `eslint` các file đã sửa 0 lỗi; `npm run test:qa` 15/15 ĐẠT; chạy thật trên tài khoản thử T001 (đã khôi phục nguyên trạng): tắt Lịch sử → 403 đúng câu, bật lại → 200 ngay; khoá tay → `MANUAL`, khoá kỷ luật → `DISCIPLINE`.
