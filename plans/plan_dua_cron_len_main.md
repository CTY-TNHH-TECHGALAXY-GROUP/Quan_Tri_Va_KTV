# Plan: Đưa cron `ktvd-recompute` lên main + gỡ cron heo đất

> Mức 2 (chạm `KtvDLedger*`, `KTVPiggyBank*`, cron ghi DB). Chờ duyệt trước khi làm.
> Bối cảnh: production và preview **dùng chung DB**. Vercel chỉ chạy cron trên bản
> production (= `main`), nên hiện **không ai rút** `KTVDRecomputeQueue` dù trigger đã sống trên DB.

## Cách làm

Nhánh mới `cron-to-main` tạo từ `origin/main` (41ced16) trong **git worktree riêng** ở scratchpad —
không đụng working tree của `feat/bit-lo-hong-phase1` (đang có file sửa dở). Làm giống đợt `email-to-main`.
Chép **nguyên file** từ nhánh, không cherry-pick commit (commit trên nhánh trộn nhiều việc).

### Việc A — Gỡ cron heo đất (Ví Tích Lũy)

1. Xoá `app/api/cron/piggy-bank-deduct/route.ts` và `PiggyBank.service.ts`.
2. Bỏ mục `/api/cron/piggy-bank-deduct` (`0 19 * * 0`) khỏi `vercel.json`.
3. **Không** đụng dữ liệu: bảng `KTVPiggyBank`, `KTVPiggyBankLedger` giữ nguyên (đúng như đã chốt khi gỡ tính năng trên nhánh).

- ⏰ Lần chạy kế tiếp: **02:00 sáng thứ Hai 14/09 (giờ VN)** → cần deploy main trước mốc này, không thì trừ thêm 1 tuần.
- 🔓 Route này hiện **không kiểm tra CRON_SECRET** (đoạn check bị comment) — ai biết URL cũng POST được để trừ tiền. Xoá đi là bịt luôn lỗ này.

### Việc B — Đưa `ktvd-recompute` lên main

1. Chép 5 file từ `feat/bit-lo-hong-phase1` (bản đã commit, HEAD 4bbbe26):
   - `app/api/cron/ktvd-recompute/route.ts`
   - `lib/services/KtvDLedgerWriter.ts`
   - `lib/services/KtvDLedgerEngine.ts`
   - `lib/business-date.ts`
   - `lib/segment-time.ts`
2. Thêm vào `vercel.json`: `{ "path": "/api/cron/ktvd-recompute", "schedule": "*/5 * * * *" }`.
3. Không thêm gói npm nào (5 file trên chỉ dùng `@supabase/supabase-js`, đã có).

### Việc C — Cron `sync-daily-ledger` cũ trên main bỏ qua Loại D

1. Thêm `.neq('work_type', 'TYPE_D')` vào truy vấn `Staff` của `app/api/cron/sync-daily-ledger/route.ts` trên main
   (giống hệt dòng 55 bản trên nhánh).
2. Lý do: bản cũ tính TYPE_D theo bảng giá TYPE_A rồi upsert `KTVDailyLedger` lúc 02:00 → ghi đè số Loại D
   đang test trên preview (DB chung). Loại D hiện chỉ có tài khoản test.
3. **Không xoá** cron: nó vẫn là nguồn sổ ngày của KTV A/B/C (ví, tài chính, KPI, chốt tháng, phí bảo trì).

## Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API bị ảnh hưởng | Main: không màn nào đọc `KTVDTurnLedger` (reader chỉ có trên nhánh). Ví Tích Lũy trên main sẽ đứng số dư, không trừ thêm | Main: không màn nào đọc `KTVDTurnLedger` | `KTVDTurnLedger`, `KTVDRecomputeQueue`, `KTVPiggyBank*` | Không ảnh hưởng hiển thị trên production |
| Số liệu hiển thị | **Preview** (nhánh) đọc `KTVDTurnLedger` → sẽ **cập nhật đúng** thay vì trễ/không đổi | Preview: `admin/ktv-office/hours` đọc cùng sổ → cập nhật đúng | Công thức duy nhất ở `KtvDLedgerEngine` | Khớp — 2 phía cùng một sổ |
| Realtime / refresh | Không đổi | Không đổi | Worker chỉ ghi `KTVDTurnLedger` + xoá dòng khỏi queue | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | Route check `CRON_SECRET` | Không lộ dữ liệu |

## Rủi ro & cách chặn

1. **Tồn đọng hàng đợi** từ lúc bật trigger (~04/09) — lần đầu có thể nhiều. Worker lấy 200 item/lượt, 5 phút/lượt → vài lượt là hết. Trước khi deploy: đếm số dòng `KTVDRecomputeQueue` (chỉ đọc) để ước lượng.
2. **Engine trên main phải khớp engine của nhánh** — chép đúng bản HEAD, sau này merge nhánh vào main thì 5 file này trùng nội dung, không conflict. `vercel.json` có thể conflict nhẹ khi merge → giữ bản hợp nhất.
3. Cột `bonus_amount`, `total_tax`, mixed-team của `KTVDTurnLedger` đã có trên DB (DB dùng chung, migration đã chạy) → không cần migration mới.
4. Không có cron nào khác ghi `KTVDTurnLedger` trên main → không tranh ghi.

## Kiểm tra sau khi làm

1. `npx tsc --noEmit` + `npm run build` trong worktree (bắt lỗi import thiếu).
2. Gọi thử `ktvd-recompute` bằng local dev trỏ DB thật với `?batch=5` → xem log `lấy / ghi / VOID / lỗi`, `failed = 0`.
3. Chạy `scripts/simulate_ktvd_ledger_engine.ts` trong worktree để chắc engine trên main cho cùng kết quả.
4. Sau deploy: xem Vercel Cron log 2–3 lượt đầu, `queueRemaining` giảm dần về 0.

## Kết quả thực hiện (11/09/2026)

- Làm trên nhánh `cron-to-main` (worktree ở scratchpad, tạo từ `origin/main` 41ced16). Đã `git add`, **chưa commit**.
- Việc C đổi cách làm so với plan: `continue` trong vòng lặp thay vì `.neq` ở truy vấn — `staffWorkTypeMap`
  phải giữ TYPE_D để `calculateBookingBonus` xét thưởng làm chung đơn không đổi cho KTV thật.
- `tsc --noEmit`: 0 lỗi.
- So sánh cron cũ ↔ mới trên dữ liệu thật ngày 10/09 (chặn mọi lệnh ghi): 155/155 dòng KTV A/B/C **giống hệt**,
  13 dòng TYPE_D không còn bị cron cũ ghi (T007 165.000đ, T069 510.000đ, còn lại 0đ). PASS.
- `simulate_ktvd_ledger_engine.ts` chạy trên engine chép sang main: 61/61 PASS.
- Đính chính: `KTVDRecomputeQueue` lúc kiểm chỉ có 1 dòng → hàng đợi **không** tồn đọng; Việc B là lưới an toàn, không gấp.
- Đính chính: `KTVPiggyBank` không còn heo đất nào `ACTIVE` (duy nhất NH079 đã `COMPLETED` 72 tuần) → cron heo đất
  hiện chạy không trừ ai; Việc A là dọn dẹp + bịt route không xác thực, **không có hạn chót 14/09**.

## Commit gợi ý (user tự commit/push)

- `chore(cron): go cron heo dat khoi main — vi tich luy da ngung dung`
- `feat(cron): dua worker ktvd-recompute len main de rut hang doi so tua`
