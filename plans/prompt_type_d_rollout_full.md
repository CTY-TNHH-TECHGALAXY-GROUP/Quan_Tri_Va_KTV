# Prompt — Kế hoạch triển khai TYPE_D, Phase 1 → 8 (soạn lại 01/09/2026)

> Copy toàn bộ phần dưới gửi cho anti.
> Nguồn quyết định nghiệp vụ: `plans/plan_che_do_type_d.md` (§14 là nơi chốt các câu hỏi nghiệp vụ).
> Nguồn quy trình gốc: `plans/huong_dan_thi_cong_type_d.md`. File này **soạn lại** theo đúng hiện trạng code đã kiểm tra trực tiếp ngày 01/09/2026 — không suy đoán từ plan, mà đối chiếu từng file thật.

---

## 0. Vì sao soạn lại

Bản `huong_dan_thi_cong_type_d.md` cũ viết Phase 0-8 theo dự kiến, chưa phản ánh việc nhiều phase đã code xong một phần. Bản này thay bằng: **mỗi phase ghi rõ ĐÃ XONG / DỞ DANG / CHƯA LÀM kèm bằng chứng file:dòng cụ thể**, để không làm lại việc đã có, và không bỏ sót phần dở dang tưởng nhầm là xong.

**Nguyên tắc chung giữ nguyên từ bản gốc:**
1. Làm tuần tự theo phase — phase sau phụ thuộc phase trước đã qua nghiệm thu.
2. Commit theo phase, message tiếng Việt không dấu, prefix `feat(type-d):`.
3. Không báo hoàn thành khi chưa chạy thử. Test fail thì dán output thật.
4. Với mỗi config/flag mới: tự hỏi *đoạn code nào thực sự đọc cái này?* rồi mở ra xác nhận.
5. Không đụng logic A/B/C trừ Phase 4 (đã nêu rõ). Sửa file dùng chung phải báo trước.

---

## 1. Ba câu hỏi phải chốt trước khi động vào Phase 4-8

Đây là các điểm mở còn treo từ bản gốc, **chưa có câu trả lời trong code hiện tại** — cần chủ dự án chốt trước, vì chốt sai phải sửa lại cả service lẫn dữ liệu đã sinh:

1. **Mốc 01/09/2026**: là ngày áp dụng chính sách với nhân viên (giai đoạn đầu tính tay, hệ thống chạy theo sau), hay ngày hệ thống bắt buộc phải chạy đầy đủ 8 phase? Câu trả lời quyết định Phase 6-8 làm gấp hay làm theo nhịp bình thường.
2. **Lỗi "nghỉ không đăng ký OFF"**: hiện đang bị 3 tầng phạt cộng dồn — trừ 10 giờ tích lũy (§5.3) + khóa tài khoản + phí kích hoạt lại 1.000.000đ (§2.3, §3.1 tài liệu quy chế). §2.3 và §5.3 của plan đang mô tả **cùng một lỗi hay hai lỗi khác nhau**? Nếu là một lỗi, có phạt cả 3 tầng cùng lúc hay chỉ chọn 1?
3. **Rate phổ thông đã chốt là 100.000đ/giờ chia 60** (không phải 1667đ/phút) — xác nhận lại vì đây là điểm dễ bị làm ngược nếu người viết code sau không đọc kỹ §5.1 mà chỉ đọc bảng cũ trong `bao_cao_bang_gia_type_d.md` (file đã hết hiệu lực).

Nếu chưa có câu trả lời, báo lại trước khi làm Phase 4/6/7/8 — các phase này đụng tới đúng chỗ đang mơ hồ.

---

## 2. Bảng trạng thái Phase 0 → 8 (đã kiểm tra code thật)

| Phase | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|
| 0 | Migration + seed test | ✅ XONG | `supabase/migrations/20260901000000_add_type_d_support.sql`, `scripts/seed_type_d_test_accounts.js`, `scripts/cleanup_type_d_test_accounts.js`, `scripts/update_type_d_test_accounts.js` đều tồn tại |
| 1 | Types & Constants | ✅ XONG | Phase 2 build được và `tsc` sạch (theo báo cáo phase 5 prompt cũ) → suy ra union type + constants đã có `TYPE_D` |
| 2 | 4 Service class lõi | ✅ XONG | `lib/services/KtvTypeDCommissionService.ts`, `KtvTypeDBonusService.ts`, `KtvTypeDDisciplineService.ts`, `KtvTypeDTurnService.ts` đều tồn tại. Kèm `KtvTypeDWalletService.ts` tách riêng (commit `729d97c`). 4 script simulate có đủ: `scripts/simulate_type_d_{commission,bonus,discipline,turn_order}.ts` |
| 3 | API Routes | ✅ PHẦN LỚN XONG | `app/api/ktv/type-d/service-hours/route.ts` có. `app/api/turns/route.ts:44-68` đã có nhánh TYPE_D sort DESC theo `monthly_hours` |
| 4 | Sửa phí dùng chung (giặt đồ/bảo trì per-type) | ⚠️ DỞ DANG | `app/api/ktv/attendance/route.ts:488` đã rẽ nhánh `workType === 'TYPE_D'` cho phí giặt đồ. Nhưng `lib/services/KtvLedgerSyncService.ts:136,156` phí bảo trì **vẫn `.eq()` cứng vào key global** `enable_maintenance_fee` / `maintenance_fee_amount`, chưa resolve theo `work_type` |
| 5 | Admin UI tab "Loại D" | ❌ CHƯA LÀM | `app/admin/settings/system/page.tsx:56` — `activeTab` chỉ khai báo `'TYPE_A' \| 'TYPE_B' \| 'TYPE_C'`, không có nhánh D nào trong file |
| 6 | Reception/Dispatch tách sort | ❌ CHƯA LÀM | `grep TYPE_D` trong `app/reception/dispatch/_components/QuickDispatchTable.tsx` ra 0 kết quả — vẫn sort trộn chung mọi loại KTV theo `turns_completed` ASC |
| 7 | KTV App (ví, ẩn Heo đất, giờ tích lũy) | ❌ CHƯA LÀM | `grep -rl TYPE_D app/ktv/` ra 0 file |
| 8 | Cron (`sync-daily-ledger` + `reset-type-d-hours`) | ⚠️ DỞ DANG | `app/api/cron/reset-type-d-hours/route.ts` đã có, có bảo vệ `CRON_SECRET`, đã đăng ký trong `vercel.json`. Nhưng `app/api/cron/sync-daily-ledger/route.ts` **0 kết quả grep `TYPE_D`** — cron đêm chưa chốt sổ ví TYPE_D, chưa stamp `work_type_snapshot`, chưa trừ quỹ nội bộ hàng đêm |

**Rủi ro cao nhất hiện tại**: Phase 8 dở dang ở `sync-daily-ledger` nghĩa là ví TYPE_D **không bao giờ được chốt sổ đêm**. `KtvWalletService.getBalance()` tính theo mô hình lai (quá khứ đọc ledger, phần gần đây tính trực tiếp từ Bookings) — thiếu chốt sổ thì toàn bộ số dư TYPE_D vĩnh viễn nằm ở nhánh "tính lại từ Bookings", không có snapshot lịch sử, và quỹ nội bộ hàng tháng không bị trừ tự động.

---

## 3. Kế hoạch làm tiếp — thứ tự theo phụ thuộc thực tế, không theo số phase

Lý do đổi thứ tự so với bản gốc: bản gốc giả định làm tuần tự 4→5→6→7→8, nhưng thực tế Phase 5 đã có prompt soạn sẵn và không phụ thuộc Phase 4/8, nên tách ra làm song song được.

### Bước A — Gửi ngay: Phase 5 (Admin UI tab D)

Đã có sẵn `plans/prompt_type_d_phase5.md`, soạn xong, không phụ thuộc Phase 4/6/7/8. Gửi trước, không cần chờ.

### Bước B — Hoàn tất Phase 4 (phí bảo trì per-type)

**Việc còn thiếu**: sửa `lib/services/KtvLedgerSyncService.ts:136-156` (`processMonthlyMaintenanceFee` hoặc hàm tương đương) từ `.eq('key', 'maintenance_fee_amount')` cứng sang resolve theo `work_type`, dùng lại pattern `typeSuffix` đã có trong `KtvCommissionService.getCommissionConfig()`: thử key `_TYPE_D` trước, không có thì rơi về key global.

**Nghiệm thu bắt buộc — test hồi quy**: đây là code dùng chung cho mọi loại KTV. Trước và sau khi sửa, đối chiếu phí bảo trì của một KTV TYPE_A, một TYPE_B, một TYPE_C — số phải **giống hệt** trước khi sửa. Chỉ TYPE_D được phép ra số khác (nếu SystemConfigs có set riêng) hoặc giống global (nếu chưa set riêng — mặc định TYPE_D dùng chung 50k theo `plan_che_do_type_d.md` §1, trừ khi câu hỏi #1 ở mục 1 phía trên trả lời khác).

### Bước C — Vá Phase 8 phần `sync-daily-ledger`

**Việc cần làm**: thêm nhánh TYPE_D vào `app/api/cron/sync-daily-ledger/route.ts`:
- Ghi `rating_deduction` vào `KTVDailyLedger` cho các booking TYPE_D trong ngày (dùng `KtvTypeDCommissionService`).
- Stamp `work_type_snapshot = 'TYPE_D'` trên mọi bản ghi mới — dùng chung helper `getWorkTypeSnapshot(supabase, staffId)` nếu Phase 3 đã viết, nếu chưa thì viết helper này trước và áp dụng cho **mọi** nơi tạo bút toán TYPE_D (không chỉ chỗ này) — đây là rủi ro R4 đã nêu trong plan gốc.
- Trừ quỹ nội bộ nếu `ktv_type_d_internal_fund_enabled = true` (đọc theo config §4 của `plan_che_do_type_d.md`).
- Trừ phí bảo trì cuối tháng — chỉ làm **sau khi Bước B xong**, để dùng luôn logic resolve theo type mới sửa.

**Nghiệm thu**: chạy cron thủ công qua `curl` với `CRON_SECRET` thật, kiểm `KTVDailyLedger` sau khi chạy có dòng mới với `work_type_snapshot = 'TYPE_D'` và `rating_deduction` đúng số, đối chiếu với kết quả script `simulate_type_d_commission.ts` cho cùng dữ liệu.

### Bước D — Phase 6 (Reception/Dispatch) — phạm vi lớn nhất

**Việc cần làm**: `app/reception/dispatch/_components/QuickDispatchTable.tsx` (dòng sort quanh khu vực xử lý danh sách KTV, cần tìm lại vị trí thật vì file có thể đã đổi số dòng so với plan gốc ghi `:1142`) — tách 2 danh sách:
- A/B/C: giữ nguyên sort `turns_completed` ASC.
- D: sort `monthly_hours` DESC — gọi `KtvTypeDTurnService.getTurnOrder()`.

Thêm badge 🟣 **D**, đổi cột "Số tua" thành "Giờ tích lũy" cho hàng KTV TYPE_D. Rà thêm các file liên quan trong nhóm dispatch/turn-queue (plan gốc liệt kê ~23 file đụng `turns_completed`; ưu tiên các file UI hiển thị trực tiếp cho lễ tân trước, không cần sửa hết 23 file cùng lúc nếu không phải file hiển thị).

**Đây là bắt buộc, không phải tùy chọn**: hệ thống không có auto-assign, lễ tân chọn tay theo thứ tự hiển thị — nếu để lẫn 2 nhóm, toàn bộ luật xếp tua DESC của TYPE_D vô nghĩa trên thực tế dù backend đã đúng.

**Nghiệm thu**: mở dispatch board với 11 tài khoản test (`T001-T079`), kiểm nhóm D sắp DESC theo giờ, nhóm A/B/C sắp ASC theo tua, hai nhóm không lẫn vào nhau trên cùng một danh sách.

### Bước E — Phase 7 (KTV App) — làm sau cùng

Làm sau Bước C vì cần số dư ví đã được chốt sổ đúng để hiển thị không lệch.

**Việc cần làm**:
- Ví tua: hiển thị số dư sau khấu trừ rating.
- Ví bonus: tách riêng, không lẫn với bonus A/B/C.
- **Ẩn tab Heo đất** cho TYPE_D — không cần sửa cron `piggy-bank-deduct` (đã xác nhận trong plan gốc: cron chỉ quét `KTVPiggyBank status = 'ACTIVE'`, sổ này do Admin tạo tay, TYPE_D không tự sinh sổ). Chỉ cần: không tạo sổ Heo đất cho TYPE_D, đặt `savings_wallet: false` trong feature flags, ẩn tab trên UI.
- Hiển thị giờ tích lũy tháng hiện tại (gọi `KtvTypeDTurnService.getMonthlyHours()` hoặc route `type-d/service-hours` đã có sẵn từ Phase 3).

**Nghiệm thu**: đăng nhập bằng 1 tài khoản test TYPE_D, kiểm ví tua/ví bonus/giờ tích lũy hiển thị đúng số đã có trong DB qua Bước C, tab Heo đất không xuất hiện.

---

## 4. Trước khi merge (giữ nguyên từ bản gốc, bổ sung Bước B-E)

- [ ] Câu hỏi 1-3 ở mục 1 đã có câu trả lời từ chủ dự án
- [ ] Bước B: test hồi quy phí bảo trì A/B/C không đổi
- [ ] Bước C: `KTVDailyLedger` có dòng `work_type_snapshot = 'TYPE_D'` sau khi chạy cron thủ công
- [ ] Bước D: dispatch board tách đúng 2 nhóm sort, không lẫn
- [ ] Bước E: ví KTV app hiển thị đúng, không có tab Heo đất
- [ ] Chạy `scripts/cleanup_type_d_test_accounts.js` — xoá Staff `id LIKE 'T%'` và bản ghi liên quan
- [ ] `npx tsc --noEmit` sạch
- [ ] 4 script mô phỏng Phase 2 vẫn xanh (không bị các bước sau làm hỏng)
- [ ] Xác nhận không còn tài khoản `T%` nào trên production

---

## 5. Báo cáo cần có sau mỗi bước

- Nêu rõ đang làm bước nào (A/B/C/D/E), tương ứng phase nào.
- Với Bước B và D: bảng đối chiếu số liệu trước/sau cho A/B/C (test hồi quy).
- Với Bước C: log thực tế của lần chạy cron thủ công.
- Với Bước E: ảnh chụp hoặc mô tả màn hình ví KTV TYPE_D.
- Commit riêng theo từng bước, không gộp.

Gặp chỗ nào không khớp plan thì dừng hỏi, đừng tự quyết — đặc biệt là 3 câu hỏi ở mục 1, vì chốt sai phải sửa lại cả service lẫn dữ liệu đã sinh.

---

## 6. Bảng kế hoạch tổng hợp — toàn bộ Phase 0 → 8

| Bước | Phase | Công việc chính | File chính | Trạng thái | Phụ thuộc | Nghiệm thu | Ưu tiên |
|---|---|---|---|---|---|---|---|
| — | 0 | Migration + seed test | `supabase/migrations/20260901000000_add_type_d_support.sql`, `scripts/seed_type_d_test_accounts.js` | ✅ Xong | — | Đã qua | — |
| — | 1 | Types & Constants | `lib/types/staff.types.ts`, `lib/constants/staff.constants.ts` | ✅ Xong | Phase 0 | Đã qua | — |
| — | 2 | 4 service class lõi (commission, bonus, discipline, turn) | `lib/services/KtvTypeD*.ts` | ✅ Xong | Phase 1 | 4 script simulate xanh | — |
| — | 3 | API routes ví, giờ tích lũy, turns | `app/api/ktv/type-d/service-hours/route.ts`, `app/api/turns/route.ts` | ✅ Phần lớn xong | Phase 2 | curl đối chiếu với simulate | — |
| A | 5 | Admin UI tab "Loại D" | `app/admin/settings/system/page.tsx` | ❌ Chưa làm (prompt đã soạn sẵn) | Phase 2, 3 | Lưu → SELECT DB → reload đúng số | **1 — gửi ngay** |
| B | 4 | Phí bảo trì per-type (giặt đồ đã xong 1 nửa) | `lib/services/KtvLedgerSyncService.ts:136-156` | ⚠️ Dở dang | — | Test hồi quy A/B/C số không đổi | **2** |
| C | 8 | Vá `sync-daily-ledger` — chốt sổ đêm TYPE_D | `app/api/cron/sync-daily-ledger/route.ts` | ⚠️ Dở dang (`reset-type-d-hours` đã xong riêng) | Phase 2, 3; nên làm sau Bước B | Chạy cron thủ công, kiểm `work_type_snapshot` trong `KTVDailyLedger` | **3 — rủi ro cao nhất hiện tại** |
| D | 6 | Tách sort Dispatch/Reception (A/B/C ASC vs D DESC) | `app/reception/dispatch/_components/QuickDispatchTable.tsx` + liên đới ~23 file | ❌ Chưa làm | Phase 2 (`KtvTypeDTurnService`) | Board test 11 tài khoản, 2 nhóm không lẫn | **4 — phạm vi lớn nhất** |
| E | 7 | KTV App: ví, ẩn Heo đất, giờ tích lũy | `app/ktv/wallet/`, `app/ktv/dashboard/` | ❌ Chưa làm | Bước C (số dư phải đã chốt đúng) | Đăng nhập tài khoản test, kiểm số + không có tab Heo đất | **5 — làm sau cùng** |

**Đọc bảng theo cột "Ưu tiên"**: đây là thứ tự làm thực tế đề xuất (A→B→C→D→E), khác thứ tự số Phase gốc vì Phase 5 không phụ thuộc Phase 4/8 nên tách ra làm trước được, còn Phase 8 (Bước C) cần ưu tiên hơn Phase 6/7 vì đang là lỗ hổng ảnh hưởng trực tiếp số dư ví thật của KTV TYPE_D mỗi ngày.
