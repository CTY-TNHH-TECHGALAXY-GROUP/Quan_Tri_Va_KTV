# Plan: KTV loại C thành tài khoản thật + dọn 138 mã placeholder

> Mức 2 — chạm xoá dữ liệu, tạo tài khoản (auth), dispatch. Chờ duyệt trước khi code.
> Ngày lập: 12/09/2026. Nhánh: `feat/bit-lo-hong-phase1`.

## 0. Hiện trạng (đã kiểm tra trực tiếp Supabase 12/09)

| Chỉ số | Giá trị |
|---|---|
| `Staff.work_type = TYPE_C` | **138** dòng, 100% `ĐANG LÀM`, `feature_flags = {}`, không `position`/`join_date` |
| Mã | 80 `EXT_xxxxxx`, 28 `C_xxxxxx`, ~30 dạng khác — đều do `app/reception/dispatch/actions.ts:657` tự sinh khi quầy gõ tên lạ |
| `Users.code` khớp | **0 / 138** — không ai đăng nhập được |
| Tên | 47/138 là tên ghép (`'LISA - LUNA - MỸ HIỆP - THƯ'`), nhiều tên trùng mã nội bộ (`'NH25'`, `'NH07 - NGUYÊN ANH'`) |

**Bảng đang tham chiếu 138 mã này** (không thể `DELETE Staff` thẳng):

| Bảng.cột | Số dòng | FK → Staff? | Ý nghĩa nếu mất |
|---|---|---|---|
| `BookingItems.technicianCodes` (text[]) | 562 | Không | Lịch sử đơn hiện mã `EXT_…` không tên |
| `KtvAssignments.employee_id` | 595 | Không | Lịch sử phân công |
| `TurnLedger.employee_id` | 550 | Không | Sổ tua — **báo cáo tài chính tháng 8 đọc từ đây** |
| `TurnQueue.employee_id` | 391 | **Có** | Chặn `DELETE` nếu không xoá trước |
| `KTVMonthlyLedger.staff_id` | 203 | Không | Cuốn tháng — báo cáo lương/hoa hồng |
| Ví/thưởng/rút/giờ loại D/điểm danh/push | 0 | — | Không ảnh hưởng |

## 1. Phần A — Dọn 138 mã placeholder

**Khuyến nghị: soft-delete, không xoá hàng.** Lý do: 550 dòng `TurnLedger` + 203 `KTVMonthlyLedger` là số liệu tài chính tháng 8–9 đã chốt; xoá `Staff` sẽ làm `FinanceReportService` mất tên KTV, còn `DELETE` thật phải xoá cả 4 bảng ledger theo → mất tiền đã ghi.

Script một lần (`scripts/cleanup_type_c_placeholders.ts`, chạy tay, có `--dry-run`):
1. `TurnQueue`: xoá 391 dòng của 138 mã (họ không còn trong hàng đợi nữa).
2. `KtvAssignments` status `ACTIVE` của 138 mã (nếu còn) → `CANCELLED`.
3. `Staff` 138 dòng → `status = 'ĐÃ NGHỈ'`, `is_active_vip_menu/is_home_spa/is_active_therapy_menu = false`. Giữ `work_type = TYPE_C` và tên để lịch sử vẫn đọc được.
4. Giữ nguyên `BookingItems`, `TurnLedger`, `KTVMonthlyLedger`.

**Nếu bạn vẫn muốn xoá hàng thật** (mất lịch sử): thứ tự `TurnQueue → KtvAssignments → TurnLedger → KTVMonthlyLedger → Staff`; `BookingItems.technicianCodes` để nguyên mã mồ côi. Tôi không khuyến nghị.

**Chặn tái phát** (bắt buộc dù chọn cách nào): bỏ đoạn tự `INSERT Staff TYPE_C` ở `app/reception/dispatch/actions.ts:640–670` (EXT-MAP). Tên lạ không có trong `Staff` → trả lỗi "KTV chưa có tài khoản, vào Admin → Nhân viên tạo trước".

## 2. Phần B — Loại C là tài khoản thật

### B1. Admin → Nhân viên: tạo/sửa loại C như A/B/D
- Bỏ 3 chỗ đang ẩn TYPE_C: `app/api/staff/list/route.ts:20`, `app/admin/employees/Employees.logic.ts:38`, `app/admin/employees/actions.ts:43`. Thay bằng lọc mã placeholder `^(EXT|C_)` (regex đã có ở `app/api/admin/staff-features/route.ts`) → gom về `lib/constants/staff.constants.ts` một chỗ.
- Form tạo: cho chọn `work_type = TYPE_C` (nhãn "Nhập tay" → đổi thành "Cộng tác ngoài"? — **cần bạn chốt tên**). Mã do admin nhập (đề xuất tiền tố `C001`, `C002`…; **không** trùng regex placeholder `C_`).
- `actions.ts:137`: `feature_flags` cho TYPE_C đang rơi về `DEFAULT_FEATURE_FLAGS_TYPE_A` → dùng `DEFAULT_FEATURE_FLAGS_TYPE_C` (đã có sẵn, chưa ai gọi).
- Tạo `Users` + auth như các loại khác (`createAuthUser`, actions.ts:97–107). Không đổi luồng auth.

### B2. Ba công tắc trên form nhân viên
| Công tắc | Cột `Staff` | Hiện trạng |
|---|---|---|
| Hiển thị Menu VIP | `is_active_vip_menu` | Đã có UI + `updateEmployee` (actions.ts:227) |
| Hiển thị Home Spa | `is_home_spa` | Đã có |
| Hiển thị Menu Điều trị | `is_active_therapy_menu` | **Cột có, UI/logic chưa có** → thêm vào `Employees.logic.ts` map + `actions.ts` update + `page.tsx` badge + form |

Ba công tắc áp dụng cho **mọi loại** KTV (không riêng C) — đây là hành vi sẵn có, chỉ bổ sung cái thứ 3.

### B3. Đăng ký tay nghề
- `Staff.skills` jsonb + form `DEFAULT_SKILLS` (shampoo/oilBody/facial/bodyMix/foot…) đã có ở form admin. Loại C dùng chung, không cần cột mới.
- **Câu hỏi**: "đăng ký" là admin tick trên form, hay KTV tự tick trong app KTV? Plan này giả định **admin tick**. Nếu KTV tự đăng ký → thêm màn `app/ktv/profile` (Mức 1, làm sau).

### B4. Dispatch — "chọn lại KTV"
Tôi hiểu là: ô nhập tay ở bảng điều phối **đổi từ gõ tên tự do sang chọn từ danh sách** KTV loại C có tài khoản (và lễ tân có thể chọn lại nếu chọn nhầm). Nếu ý bạn khác, sửa tôi.
- `DispatchStaffRow.tsx:241/288/321`, `QuickDispatchTable.tsx:1442`, `DispatchServiceBlock.tsx:104`, `useDispatchBoard.logic.ts:432`, `PauseSwapKtvModal.tsx:104`: đang phân biệt "KTV ngoài" bằng `startsWith('EXT'|'C_')` → đổi sang `work_type === 'TYPE_C'` lấy từ Staff.
- `ktvDisplayLabel` (staff.constants.ts:158): loại C hiện TÊN — giữ, vì mã `C001` vẫn ít quen hơn tên.
- **Cần chốt**: loại C có phải điểm danh (`TurnQueue`) mới được phân đơn không? Hiện `actions.ts:700` bỏ qua kiểm tra chấm công cho EXT/C_. Khuyến nghị: **giống TYPE_B** — không bắt buộc, `allow_on_call: true` (đã đúng trong `DEFAULT_FEATURE_FLAGS_TYPE_C`).

### B5. Hàng đợi tua
`app/api/turns/route.ts:58`: "Tất cả" đang loại C. Giữ (loại C không xếp tua chung), chỉ hiện khi lọc `workType=TYPE_C`. Không đổi.

### B6. Tiền — không đổi công thức
`KtvCommissionService.getCommissionConfig('TYPE_C')`, `sync-daily-ledger`, `finance/reports` đã có nhánh TYPE_C riêng (`ktv_bonus_rate_TYPE_C`, `ktv_shift_*_bonus_TYPE_C`…). Plan này **không** chạm.

### B7. App KTV khi loại C đăng nhập — cần rà, chưa sửa
`KTVDashboard.logic.ts`, `app/ktv/wallet`, `app/ktv/attendance` rẽ nhánh theo `work_type` cho B/D. Loại C chưa từng đăng nhập nên chưa biết vỡ ở đâu. Bước cuối của plan: đăng nhập thử 1 tài khoản C, đi luồng nhận đơn → hoàn tất → ví; ghi lỗi thành plan riêng.

## 3. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `app/ktv/*` — loại C lần đầu đăng nhập (B7) | `admin/employees`, `api/staff/list`, `reception/dispatch` (actions + 6 component), `api/admin/staff-features` | `Staff`, `Users`, `staff.constants.ts` | Sửa quản lý; KTV chỉ rà |
| Số liệu tiền/tua | Ví loại C đọc `TurnLedger` (đã có nhánh TYPE_C) | `finance/reports` nhánh TYPE_C | `KtvCommissionService` | Không đổi công thức — Khớp |
| Realtime / refresh | Không đổi | Dispatch subscribe `Staff`/`TurnQueue` — xoá 391 TurnQueue sẽ đẩy event, chạy ngoài giờ | `TurnQueue` | Đồng bộ |
| Quyền xem | Loại C thấy đúng ví/đơn của mình (auth chuẩn) | Admin thấy loại C trong danh sách, ẩn 138 placeholder | — | Không lộ |
| Dữ liệu cũ | — | 138 dòng → `ĐÃ NGHỈ`, ẩn khỏi danh sách | `TurnLedger`/`KTVMonthlyLedger` giữ nguyên | Báo cáo tháng 8 không đổi số |

## 4. Câu hỏi cần chốt trước khi code
1. Phần A: **soft-delete** (khuyến nghị) hay xoá hàng thật?
2. B1: nhãn mới cho TYPE_C và quy ước mã (`C001`…)?
3. B3: admin tick tay nghề, hay KTV tự đăng ký trong app?
4. B4: "chọn lại KTV" đúng nghĩa như tôi hiểu không? Loại C có cần điểm danh trước khi được phân đơn?

## 5. Thứ tự làm & kiểm thử
1. A (script dọn, chạy `--dry-run` in số dòng trước) → chặn EXT-MAP.
2. B1 → B2 → B3 (admin form) → B4 (dispatch picker).
3. Test: tạo 1 KTV C, phân đơn 1KTV-1DV và 2KTV-1DV (C + A) ở dispatch, hoàn tất, so ví KTV vs `finance/ktv` cùng ngày (mục 4.3 CLAUDE.md).
4. Cập nhật `TableInSupabase.md` (ghi chú `is_active_therapy_menu` có UI; `work_type TYPE_C` = tài khoản thật).

## 6. Kết quả thực hiện (12/09/2026)

**Chốt với user:** soft-delete · loại C ưu tiên hiện TÊN · không bắt buộc điểm danh · tay nghề admin tick trên form.

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| A. Dọn 138 placeholder | ✅ Đã chạy `--apply` | Xoá 391 `TurnQueue`, huỷ 461 `KtvAssignments` dang dở (QUEUED/READY/ACTIVE → CANCELLED), 138 `Staff` → `ĐÃ NGHỈ` + tắt VIP/Home Spa. Ledger giữ nguyên. Script: `scripts/cleanup_type_c_placeholders.ts` (idempotent, có dry-run). |
| A. Chặn tái phát | ✅ | `app/reception/dispatch/actions.ts` — bỏ EXT-MAP; mã không có trong `Staff` → trả lỗi "chưa có tài khoản". Ô "Nhập tên ngoài" gỡ khỏi `DispatchStaffRow` và `QuickDispatchTable`, Enter không khớp thì không nhận. |
| B1. Admin thấy/tạo loại C | ✅ | Bỏ lọc TYPE_C ở `api/staff/list`, `Employees.logic`, `getStaffList`; thay bằng `isPlaceholderStaffId` (gom về `lib/constants/staff.constants.ts`, `staff-features/route.ts` dùng chung). `createStaffMember` dùng `DEFAULT_FEATURE_FLAGS_TYPE_C`. Nhãn `WORK_TYPE_LABELS.TYPE_C` = "Cộng tác viên". |
| B2. Ba công tắc | ✅ (migration đã chạy lên DB 12/09) | Phát hiện `is_active_therapy_menu` **chưa có trong DB** dù doc ghi có → migration `20260912150000_add_staff_is_active_therapy_menu.sql`. Thêm checkbox ở `AddEmployeeModal`, `EmployeeDetailModal`, badge ở `employees/page.tsx`, ghi ở `createStaffMember`/`updateStaffMember`. Sửa luôn bug cũ: tạo mới không ghi VIP/Home Spa. |
| B3. Tay nghề | ✅ | Dùng `Staff.skills` + form sẵn có, không đổi. |
| B4. Dispatch chọn loại C | ✅ | `useDispatchBoard.logic.ts`: `mergeTurnsWithStaff` thêm "tua ảo" cho loại C `ĐANG LÀM` (như on-call), dùng cho cả 2 chỗ set turns (chỗ thứ 2 trước đây làm rơi on-call). Hiển thị tên qua `ktvDisplayLabel` ở DispatchStaffRow / QuickDispatchTable / DispatchServiceBlock / KanbanBoard / feedback / customers API. Loại C xong việc → TurnQueue `off`. |
| B5. Hàng đợi tua | Không đổi | `api/turns` vẫn ẩn C khỏi "Tất cả". |
| B6. Tiền | Không đổi | |
| B7. App KTV loại C | ⏳ Chưa rà | Cần tạo 1 tài khoản C thật rồi đăng nhập thử. |

**Kiểm tra:** `npx tsc --noEmit` sạch (ngoài `scripts/`). Chưa test UI qua trình duyệt (trang cần đăng nhập).

**Việc user cần làm:**
1. Tạo 1 KTV loại C (mã tự đặt, VD `C001`) → vào Dispatch tìm theo tên → phân 1KTV-1DV và 2KTV-1DV (C + A) → hoàn tất → so ví KTV vs `finance/ktv`.
