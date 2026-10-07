# Plan (Mức 2 — dispatch) — Ô chọn KTV B (đơn nối tiếp) nhận KTV ngoài và KTV loại C

Repo: `Quan_Tri_Va_KTV`, nhánh `feat/bit-lo-hong-phase1`. Ngày lập: 05/10/2026. Trạng thái: **đã duyệt 05/10 ("như luồng bình thường: chọn nhân viên và nhập tên KTV ngoài cho B"), đã code, mock test `scripts/test_sequential_b_prep.cjs` 6/6, chờ commit**.

## 1. Hiện trạng

Ô chọn KTV **A** (ô tìm kiếm ở bảng điều phối nhanh) đã nhận đủ: KTV nhà A/B/D, KTV loại C có tài khoản (có trong sổ tua),
nhóm "KTV ngoài (không tài khoản)" (`EXT_`/`C_`, ĐANG LÀM) và dòng "➕ Thêm KTV ngoài: <tên>" (plan 15/09/2026).

Ô chọn KTV **B** thì không. Có 3 chỗ chọn B, cả ba là `<select>` chỉ liệt kê **sổ tua** (`turns`):
1. `QuickDispatchTable.tsx:1912` — `<select aria-label="Chọn nhân viên B">` trong khung "B · Chưa chọn nhân viên" (mới có A).
2. `QuickDispatchTable.tsx:1677` — `<select aria-label="Nhân viên B">` khi đổi B đã có trong bản nháp nối tiếp.
3. `page.tsx:3653` — popup "Chọn nhân viên làm tiếp" (bàn giao trực tiếp / nút "Chưa gán B · + Điều phối" trên Kanban),
   lọc `t.status === 'waiting' && isVisibleInKtvPicker(t)`.

KTV ngoài không có dòng sổ tua nên không bao giờ xuất hiện; không có chỗ gõ tên mới. KTV loại C có tài khoản chỉ hiện nếu đã
điểm danh (giống ô A). Không có chỗ nào hard-code "A_B_D" theo nghĩa đen — việc lọc theo sổ tua là nguyên nhân.

**Phía server** (`actions.ts` → RPC `dispatch_assign_sequential_slot_b`, migration `20261001100000`):
- Đòi `Staff.status = 'ĐANG LÀM'` và **phải có dòng `TurnQueue` ngày đó, `waiting`, chưa có đơn** → KTV ngoài không có dòng
  sổ tua sẽ bị "KTV B không còn rảnh; tải lại sổ tua".
- Luồng **form điều phối** (`processDispatch` → RPC `dispatch_commit_form`): đã chèn `TurnQueue` cho mọi KTV thiếu dòng
  (`turnStaffIds`, migration `20260929160000:524`) **trước** khi gọi `ASSIGN_B` nội bộ (dòng 811) và đã đổi token `NEW_EXT:` →
  mã `EXT_` (`resolveNewExternalKtvIds`). → Form chỉ cần sửa UI.
- Luồng **bàn giao trực tiếp** (`handoffSequentialKtv`): gọi thẳng `ASSIGN_B`, **không** đổi token, **không** chèn sổ tua → phải bổ sung.

## 2. Phương án (một khuyến nghị)

Không sửa SQL. Dùng chung một ô chọn, và cho `handoffSequentialKtv` làm đúng hai bước mà `processDispatch` đã làm.

| File | Việc làm |
|---|---|
| `app/reception/dispatch/_components/KtvPickerCombo.tsx` (mới) | Ô tìm + dropdown dùng chung cho **chọn B**: (a) sổ tua: `isVisibleInKtvPicker`, loại trừ A và mã đã chọn, giữ mã đang chọn; (b) nhóm "KTV ngoài (không tài khoản)" từ `staffs` placeholder ĐANG LÀM (`externalKtvNameKey` so không dấu, tối đa 8); (c) "➕ Thêm KTV ngoài: <tên>" khi `externalKtvNameProblem` = null → trả token `newExternalKtvToken(name)`; (d) nhãn hiển thị `ktvDisplayLabel` + badge loại. Chữ lấy từ `CheckinConfirm.i18n.ts` (đã có `externalGroup`, `externalNoAccount`, `addExternal`). Logic lọc tách `KtvPickerCombo.logic.ts`, tái dùng `pickKtvByExactInput` (chuyển từ QDT sang `lib/constants/staff.constants.ts` hoặc export). |
| `QuickDispatchTable.tsx:1912` và `:1677` | Thay cả hai `<select>` B bằng `KtvPickerCombo` (khung "Chưa chọn B" → `addKtv(id)`; đổi B → thay `selectedKtvIds[1]`). Token `NEW_EXT:` đi vào `selectedKtvIds[1]` → `processDispatch`/`saveDraft` đã đổi mã như ô A. Tên hiển thị tạm lấy `externalNameOfToken`. |
| `page.tsx:3653` | Thay `<select>` trong popup bàn giao bằng `KtvPickerCombo`. `openLiveHandoff` bỏ điều kiện `turns.some(...)` khi `toKtvId` là placeholder/token. |
| `app/reception/dispatch/actions.ts` — `handoffSequentialKtv` | Trước RPC: (1) nếu `toKtvId` là `NEW_EXT:` → gọi `resolveNewExternalKtvIds(supabase, { staffAssignments: [{ ktvId }] })`, lấy mã thật, đổi khoá trong `metadata.serviceNamesForKtvs`; (2) nếu KTV B chưa có dòng `TurnQueue` ở `business_date` của phân công A (`KtvAssignments` theo `booking_item_id`, `status <> 'CANCELLED'`) → upsert dòng `waiting`, `queue_position`/`check_in_order` = max+1 (giống RPC `turnStaffIds`, `ignoreDuplicates` theo `(employee_id,date)`); (3) gọi RPC như cũ; thông báo `createNotification` cho KTV ngoài không có tài khoản → bỏ qua cảnh báo "chưa tạo được thông báo" khi `isPlaceholderStaffId`. Trả thêm `toKtvId` thật và tên để toast hiện tên thay vì mã `EXT_`. |
| `DispatchConfirm.i18n.ts` | `assignBSaved`/`assignBAlreadySaved` nhận nhãn hiển thị (tên KTV ngoài) thay vì mã. |
| `SequentialLifecycleModal.tsx` (SWAP) | **Không đổi** trong plan này: đã liệt kê `staffs` (gồm KTV ngoài ĐANG LÀM, loại C). Đường SWAP phía server (`sequential-lifecycle`) chưa kiểm tra với KTV không sổ tua — ghi nhận, làm sau nếu cần. |

Không migration, không đổi `TableInSupabase.md`.

## 3. Rủi ro

- KTV ngoài không có tài khoản → không nhận thông báo "lượt B"; quầy phải báo miệng (đã có cảnh báo tương tự ở ô A).
- Hai máy quầy cùng thêm một tên ngoài làm B: `resolveNewExternalKtvIds` đã chốt về một dòng.
- Dòng `TurnQueue` chèn cho KTV ngoài nằm cuối hàng (giống form điều phối). Không ảnh hưởng tua KTV nhà.
- Hoa hồng / tua / giờ: KTV ngoài và loại C đi đúng công thức sẵn có theo `work_type`; plan này không chạm công thức.

## 4. Ảnh hưởng chéo KTV ↔ Quản lý

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Dashboard KTV đọc `segments` slot 2 như mọi B khác; KTV ngoài không có app — Không ảnh hưởng | `reception/dispatch` (QDT, popup bàn giao, Kanban hiện B) | `actions.handoffSequentialKtv`, RPC `dispatch_assign_sequential_slot_b`, `TurnQueue`, `Staff` | Sửa UI 3 chỗ + 1 action |
| Số liệu (tiền, tua, giờ) | Theo `work_type` của mã B thật (TYPE_C cho KTV ngoài) | Kanban/sổ tua hiện badge C | ledger hiện có | Khớp — không đổi công thức |
| Realtime / refresh | — | Dispatch subscribe `BookingItems`, `TurnQueue` như cũ | | Đồng bộ |
| Quyền xem | — | Quầy có `dispatch_board` | | Không lộ dữ liệu nội bộ |

## 5. Kiểm thử (mục 9 CLAUDE.md — bắt buộc)

Mock Node cho `handoffSequentialKtv` (stub supabase): (1) B là mã nhà có sổ tua → RPC nhận nguyên; (2) B là `EXT_` ĐANG LÀM
chưa có sổ tua → có upsert `TurnQueue` rồi RPC; (3) B là `NEW_EXT:TÊN MỚI` → tạo Staff TYPE_C, đổi khoá metadata, upsert sổ tua;
(4) tên trùng KTV nhà → trả lỗi từ `externalKtvNameProblem`. UI: chọn B ngoài ở bản nháp rồi lưu; đổi B trong popup bàn giao;
ca đêm (A qua 0h) giữ `business_date` của A. Đối chiếu Kanban hiện tên B ngoài kèm badge C.
