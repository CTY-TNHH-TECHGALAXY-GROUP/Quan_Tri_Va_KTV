# Plan: Mở lại KTV ngoài không tài khoản ở ô chọn KTV

**Mức:** 2 — `app/reception/dispatch/actions.ts` (`processDispatch`), tự tạo dòng `Staff`, cổng điểm danh.
**Lập:** 2026-09-15 · **Trạng thái:** ĐÃ CHỐT 15/09 — đang code.

> **User chốt 15/09:**
> - Câu 1, 2: theo khuyến nghị (tên mới → tạo KTV ngoài; gõ trùng KTV nhà → chọn KTV nhà).
> - Câu 3: **CHO PHÉP tên ghép** (`LISA - LUNA`) "để nhanh hơn" → bỏ luật chặn tên ghép ở 3.1. Một dòng ghép nhận trọn tiền/tua/đánh giá như một người.
> - Câu 4: KTV ngoài **không tài khoản** (mã `EXT_`/`C_`) → không hỏi điểm danh. KTV **có mã tài khoản thật** (kể cả loại C) → **vẫn hỏi** như 14/09, vì họ đăng nhập được app để bấm Oria xin chào.
> - Câu 5: có gợi ý nhóm "KTV ngoài".
**Đảo một phần:** `plan_ktv_loai_c_tai_khoan_that.md` (12/09, "tắt tự sinh mã EXT_") và `plan_dieu_phoi_ktv_chua_diem_danh.md` (14/09, gõ đúng tên chỉ tra người không phải placeholder).

---

## 1. Hiện trạng

**Tiệm vẫn dùng KTV ngoài hằng ngày** (đọc DB 15/09, 10 ngày gần nhất): 4–13 dịch vụ/ngày gán mã `C_…`/`EXT_…` — `C_50LQFT` NGUYÊN ANH, `C_3ML9PY` HIỆP, `EXT_I40MIU` NGUYÊN NGỌC, `EXT_DY95EP` LISA - LUNA… Bản đang chạy ở quầy (main) vẫn tự sinh mã; nhánh này thì chặn.

`Staff` loại C: **132 placeholder ĐÃ NGHỈ**, **6 placeholder ĐANG LÀM** (được code cũ bật lại khi quầy gõ tên), **5 tài khoản thật**.

Trên nhánh này, gõ tên người ngoài bị chặn ở 3 lớp:

| Lớp | Chỗ | Hành vi |
|---|---|---|
| Ô chọn (dropdown) | `useDispatchBoard.logic.ts:115` `mergeTurnsWithStaff` | lọc bỏ mọi mã `EXT_`/`C_` |
| Enter gõ đúng tên | `QuickDispatchTable.tsx:82-88` `pickKtvByExactInput` | tra `staffs` nhưng **bỏ qua placeholder** → "Không thấy trong danh sách đã điểm danh…" (ảnh 15/09 gõ "nguyên anh" dù `C_50LQFT` NGUYÊN ANH đang có) |
| Máy chủ | `actions.ts:673-683` `processDispatch` | mã không có trong `Staff` → lỗi "chưa có tài khoản" |

Lý do tắt ngày 12/09 vẫn đúng: tự sinh không kiểm soát đẻ 138 dòng rác, 47 tên ghép (`LISA - LUNA - MỸ HIỆP - THƯ`), tên trùng mã nội bộ (`NH07`, `NH09`, `NH25` — quầy gõ mã KTV nhà vì người đó không có trong danh sách).

## 2. Cần chốt

1. **Gõ tên chưa từng có** → tự tạo KTV ngoài (mã `EXT_xxxxxx`, loại C, không đăng nhập) như trước 12/09? **Khuyến nghị: có**, kèm chặn rác ở câu 2–3.
2. **Tên trùng mã / tên KTV nhà** (gõ `NH07`): **khuyến nghị** chọn luôn KTV nhà đó (đi popup "chưa điểm danh" như 14/09), **không** tạo KTV ngoài tên `NH07`.
3. **Tên ghép nhiều người** (`LISA - LUNA`): **khuyến nghị chặn**, báo "mỗi ô một KTV — thêm từng người". Lý do: một dòng cho 2 người thì tiền, tua, đánh giá không chia được.
4. **KTV ngoài có hỏi "chưa điểm danh" không?** Họ không có app để bấm Oria xin chào → **khuyến nghị không hỏi** (như trước 14/09).
5. **Gợi ý lại người ngoài đã dùng**: gõ vài chữ là dropdown hiện nhóm **"KTV ngoài"** (placeholder `ĐANG LÀM` hoặc từng dùng trong 30 ngày), xếp **dưới** KTV nhà. **Khuyến nghị: có** — đỡ gõ sai chính tả sinh dòng trùng (`NGUYÊN ANH` / `NGUYEN ANH`).

## 3. Thay đổi (theo khuyến nghị)

### 3.1. Một nguồn luật tên KTV ngoài — `lib/constants/staff.constants.ts`
- `normalizeExternalKtvName(raw)`: trim, gộp khoảng trắng, **IN HOA** (dữ liệu cũ đều in hoa).
- `externalKtvNameProblem(name, staffs)` → `null` hoặc lý do: rỗng · chứa `-`, `,`, `/`, `+`, ` và ` (tên ghép) · trùng **mã** hoặc **tên** KTV không phải placeholder (→ phải chọn người đó).

### 3.2. Ô chọn — `QuickDispatchTable.tsx`
- `pickKtvByExactInput`: thứ tự tra — (1) sổ tua như cũ; (2) KTV nhà khớp mã/tên (như 14/09); (3) **KTV ngoài có sẵn** khớp tên (bỏ lọc placeholder, kể cả ĐÃ NGHỈ); (4) không khớp ai → dòng **"➕ Thêm KTV ngoài: NGUYÊN ANH"** (bấm hoặc Enter lần hai) nếu `externalKtvNameProblem` = null, không thì hiện lý do.
- Người ngoài mới giữ tạm dạng `NEW_EXT:<tên>` trong `selectedKtvIds` (nhãn hiện tên) tới lúc gửi đơn.
- Dropdown thêm nhóm "KTV ngoài" (câu 5), đặt cuối.

### 3.3. Danh sách — `useDispatchBoard.logic.ts`
- `mergeTurnsWithStaff` giữ lọc placeholder khỏi **sổ tua** (không cho dòng TurnQueue cũ dựng lại lọt lên), nhưng xuất riêng `externalKtvs` (placeholder `ĐANG LÀM` + dùng trong 30 ngày) cho nhóm gợi ý. `getDispatchData` trả thêm `lastUsedAt` cho placeholder.

### 3.4. Máy chủ — `processDispatch` (`actions.ts`)
- Trước bước "mã không có trong Staff": gom mọi `NEW_EXT:<tên>` → chạy lại `externalKtvNameProblem` (không tin client) → tìm placeholder trùng tên (không phân biệt hoa thường) → có thì dùng lại + `status = 'ĐANG LÀM'`; chưa có thì `INSERT Staff {id: EXT_xxxxxx, full_name, work_type: TYPE_C, status: ĐANG LÀM}` → thay mã trong `technicianCodes`, `staffAssignments`, `segments` (khôi phục đoạn EXT-MAP cũ, có kiểm tra).
- Mã lạ **không** có tiền tố `NEW_EXT:` vẫn lỗi như 12/09 (không nhận chữ tự do ngầm).
- Cổng điểm danh (`findKtvsNeedingCheckinConfirm`): **miễn** placeholder (câu 4).
- Chống 2 máy quầy tạo trùng cùng lúc: sau `INSERT` đọc lại theo tên, lấy dòng cũ nhất.

### 3.5. Không đổi
- Tiền: loại C dùng nhánh `_TYPE_C` sẵn có (`KtvCommissionService`), không đổi công thức.
- Xong việc: placeholder về `off` ở sổ tua (`actions.ts:1841`) — không vào hàng đợi chung.
- Kanban / đánh giá / khách hàng: `ktvDisplayLabel` đã hiện tên cho placeholder.
- **Huỷ ghi chú "chạy lại `scripts/cleanup_type_c_placeholders.ts --apply`"** ở `plan_ktv_loai_c_tai_khoan_that.md` mục 7 — chạy lại sẽ tắt mất KTV ngoài đang dùng.

## 4. Bảng hệ quả (mục 13) — sự kiện "quầy gán KTV ngoài không tài khoản"

| Khía cạnh | KTV ngoài |
|---|---|
| Tiền tua | theo cấu hình loại C (không đổi) — không có ví/app để xem |
| Giờ tích luỹ | không áp dụng — không phải loại D |
| Lượt tua | có dòng `TurnLedger` như trước 12/09; không xếp tua chung (về `off` sau đơn) |
| Thưởng | theo cờ loại C (mặc định tắt) |
| Đánh giá khách | ghi vào `ktvRatings` theo mã `EXT_` như KTV thường |
| Dọn phòng / bàn giao | không có app → quầy chuyển trạng thái tay trên Kanban (như trước 12/09) |
| Nợ phòng / chặn tan ca | không áp dụng — không tan ca trên app |
| Hàng đợi (TurnQueue/KtvAssignments) | RPC tạo dòng như trước; xong đơn về `off` |
| Màn app KTV / đồng hồ | không áp dụng |
| Tự chốt | job tự hoàn tất coi như KTV thường (chặng cần `actualEndTime` — quầy bấm) |
| Thẻ Kanban | hiện TÊN (`ktvDisplayLabel`) |
| Lịch sử KTV | không áp dụng — không đăng nhập |
| Nhật ký / lý do | không đổi |

## 5. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — KTV ngoài không có app | Ô chọn KTV (dropdown, Enter), `processDispatch`, popup điểm danh | `staff.constants.ts`, `Staff`, `TurnQueue`, `KtvAssignments` | Sửa |
| Số liệu | — | Báo cáo tài chính đọc `TurnLedger` loại C như trước 12/09 | `KtvCommissionService` | Không đổi công thức |
| Realtime | — | Điều phối nghe `Staff`/`TurnQueue` | `Staff` | Đồng bộ |
| Quyền | — | Chỉ quầy có `dispatch_board` tạo được (qua `processDispatch`) | | Không lộ |

## 5b. Kết quả thực hiện (15/09/2026)

| Phần | File | Ghi chú |
|---|---|---|
| Luật tên (một nguồn) | `lib/constants/staff.constants.ts` | `normalizeExternalKtvName`, `externalKtvNameKey` (không dấu, Đ→D), `findExternalKtvByName` (ưu tiên ĐANG LÀM, rồi mã nhỏ nhất), `externalKtvNameProblem` (**cho phép tên ghép**; chặn rỗng, > 60 ký tự, trùng mã/tên KTV nhà còn làm — gồm cả loại C có tài khoản), mã tạm `NEW_EXT:<TÊN>`; `ktvDisplayLabel` hiện tên cho mã tạm |
| Cổng điểm danh | `lib/attendance/dispatchCheckinGate.ts` | miễn hỏi mã placeholder; loại C có tài khoản vẫn hỏi |
| Ô chọn KTV | `QuickDispatchTable.tsx` | Enter: sổ tua → KTV nhà → **KTV ngoài có sẵn (không dấu)** → không khớp thì thêm KTV ngoài mới; nhóm gợi ý "KTV ngoài (không tài khoản)" (placeholder `ĐANG LÀM`, tối đa 8) dưới KTV nhà; dòng "➕ Thêm KTV ngoài: TÊN"; chữ ở `CheckinConfirm.i18n.ts` |
| Máy chủ | `actions.ts` `resolveNewExternalKtvIds` | gọi ở **cả** `processDispatch` **và** `saveDraftDispatch` (lưu nháp / tách đơn ghi thẳng `technicianCodes`); dùng lại dòng cùng tên + bật ĐANG LÀM; 2 máy cùng thêm → chốt 1 dòng, xoá dòng thừa vừa tạo |

**Khác plan:** nhóm gợi ý dùng placeholder `ĐANG LÀM` thay vì "dùng trong 30 ngày" — dùng lại một người là bật lại `ĐANG LÀM`, nên hai tiêu chí trùng nhau mà không cần quét `BookingItems`.

**Kiểm:** `scripts/qa/qa_external_ktv_names.ts` 27/27 (dữ liệu tên thật 15/09: gõ "nguyên anh" → `C_50LQFT`, không dấu, tên ghép, trùng KTV nhà, cổng điểm danh) · `qa_dispatch_unchecked_ktv.ts` vẫn 43/43 · `tsc` sạch các file đã sửa. **Chưa** kiểm trên trình duyệt và chưa chạy tạo dòng thật trong DB.

## 6. Kiểm

1. Mô phỏng luật tên (hàm thuần): `nguyên anh` → khớp `C_50LQFT`; `NH07` → chọn KTV nhà; `LISA - LUNA` → chặn; tên mới → tạo; khoảng trắng / hoa thường.
2. DB thật (tài khoản test, tự dọn): gửi đơn với tên mới → 1 dòng `EXT_`; gửi lần 2 cùng tên → dùng lại, không tạo thêm; 2 lệnh song song → không trùng; placeholder không bị hỏi điểm danh; KTV nhà chưa điểm danh vẫn bị hỏi.
3. Edge dispatch (mục 9.8): KTV ngoài 1KTV-1DV, KTV ngoài + KTV nhà song song / nối tiếp, ca qua nửa đêm.
4. `qa_dispatch_unchecked_ktv.ts` và `qa_swap_ktv_e2e.ts` vẫn đạt; `npx tsc --noEmit`.
