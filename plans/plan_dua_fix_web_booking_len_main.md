# Plan: Đưa các fix Web Booking (còn kẹt ở `main` trên máy) lên GitHub `main`

> **Mức 2** — chạm `app/reception/dispatch/actions.ts` (Dispatch). Chờ duyệt trước khi push.
> Ngày lập: 14/09/2026.

---

## 1. Bối cảnh

`main` trên máy có 3 commit (02–03/09) chưa từng push lên GitHub (chỉ nằm ở `main` local và nhánh local `claude/happy-mclaren-3b7eb5`):

| Commit | Nội dung | Quyết định |
|---|---|---|
| `21530638` | Dispatch bỏ nguồn `STANDARD_MENU`/`VIP_MENU`; xác nhận `WEB_BOOKING` tự xếp STANDARD/VIP/MIXED theo dịch vụ; panel chi tiết đơn web thêm số khách, giới tính, quốc tịch, thanh toán, vùng tập trung | ✅ Đưa lên |
| `abdf1654` | Xác nhận đơn web cho cả status `WAITING` | ❌ **BỎ** |
| `155c0fb3` | Dispatch giữ nhãn BOOKING cho đơn web đã xác nhận (billCode `WB-`) | ✅ Đưa lên |

**Vì sao bỏ `abdf1654`:** enum `BookingStatus` (TableInSupabase.md dòng 38) không có `WAITING`. Kiểm trên DB thật (select only): `.in('status', ['NEW','WAITING'])` → `22P02 invalid input value for enum "BookingStatus": "WAITING"`. Đưa lên = **mọi lần bấm Xác nhận đơn web đều lỗi**. `origin/main` (commit `12b59b48`) đã cố ý giữ `.eq('status','NEW')` kèm comment cảnh báo.

Nhánh `feat/bit-lo-hong-phase1` đã có sẵn đúng 2 thay đổi Dispatch này (bộ lọc nguồn + kiểm `WB-`) → đã chạy trên preview.

## 2. Cách làm (đã thử trên máy, CHƯA push)

- Worktree tạm từ `origin/main` (đã gồm `e21a9dbd` công tắc ví), nhánh `fix/web-booking-len-main`.
- `git cherry-pick 21530638 155c0fb3` → **sạch, không xung đột** (auto-merge `web-booking/actions.ts` với 2 commit email trên main).
- `npx tsc --noEmit` → **0 lỗi**.
- Sau duyệt: sửa message 2 commit (thêm dòng `Van hanh:` + `(cherry picked from ...)`) → push nhánh → fast-forward `main`.

### Trạng thái (14/09/2026) — ĐÃ DUYỆT & ĐÃ PUSH LÊN MAIN
- Dựng lại trên `origin/main` `c538db6d`; cherry-pick thành `0b9b96a5` (từ `21530638`) và `f8cb8717` (từ `155c0fb3`), message có `Van hanh:`. Cây file trùng bản đã `tsc` 0 lỗi (`0331b8b9`).
- Push fast-forward `main`: `c538db6d..f8cb8717`. `abdf1654` KHÔNG đưa lên.
- Việc còn lại: quầy kiểm các bước mục 5 ở lần xác nhận đơn web thật kế tiếp.

## 3. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — app KTV chỉ nhận đơn đã điều phối; `app/ktv/*`, `app/api/ktv/*` không đọc `Bookings.source` (đã grep) | `reception/dispatch` (bộ lọc nguồn, nhãn BOOKING), `reception/web-booking` (xác nhận + panel chi tiết) | Bảng `Bookings.source` | Sửa |
| Số liệu tiền / tua / hoa hồng | Không ảnh hưởng — `KtvCommissionService`, cron ledger, handler dispatch không đọc `source` (đã grep) | Báo cáo Tài chính: `PAID_SOURCES` gồm mọi `*_WALK_IN` → **doanh thu không đổi**; xếp nhóm VIP/Thường theo `source` (`finance/reports`, `ktv-ranking`) → đơn web có dịch vụ `NHP*`/`VIP_*` xác nhận SAU deploy sẽ vào nhóm VIP (đúng hơn) | `FinanceReportService.PAID_SOURCES` (không sửa) | Khớp |
| Realtime / refresh | Không đổi | Dispatch bỏ qua INSERT nguồn `*_MENU` (đơn chưa xác nhận) | Kênh `dispatch_board_realtime` | Đồng bộ |
| Quyền xem | Không đổi | Panel chi tiết đơn web hiện thêm thông tin khách (quầy vốn đã có quyền) | | Không lộ dữ liệu nội bộ |

## 4. Mô phỏng trên dữ liệu thật (chỉ đọc, 14/09)

- 90 đơn web/menu đang `NEW` chờ xác nhận: nguồn sau xác nhận **cũ = mới cho cả 90** (66 `WEB_BOOKING` đều là dịch vụ thường → `STANDARD_WALK_IN`).
- Không đơn chờ nào có dịch vụ `NHT*`. ⚠️ Lưu ý: luật mới chỉ coi `NHP*`/`VIP_*` là VIP (giống `DispatchServiceBlock`, `finance/reports`), còn cron Loại D coi thêm `NHT*` — lệch có sẵn, không do plan này tạo ra.
- Đơn `*_MENU` còn hiện trên Dispatch hôm nay (sẽ biến khỏi Dispatch, vẫn ở trang Web Booking): 6 đơn `NEW` treo từ 22/05, 27/07, 08/08 (dữ liệu cũ chưa xác nhận); các đơn `DONE` 22–23/05, 02/09 chỉ biến khỏi Dispatch khi xem lại ngày đó (Tài chính vẫn tính).

## 5. Test sau khi deploy (dữ liệu thật, quầy thao tác thường ngày)

1. Xác nhận 1 đơn `WEB_BOOKING` → không lỗi; đơn lên Dispatch với nhãn BOOKING.
2. Đơn web có dịch vụ VIP (`NHP*`) → sau xác nhận là `VIP_WALK_IN`; có cả VIP + thường → `MIXED_WALK_IN`.
3. Panel chi tiết đơn web hiện số khách / giới tính / quốc tịch / thanh toán / vùng tập trung (nếu có).
4. Đơn `*_MENU` chưa xác nhận không còn nằm trên Dispatch.

## 6. Ảnh hưởng vận hành

| Ai | Khác gì so với hôm nay | Cần báo / hướng dẫn gì |
|---|---|---|
| Quầy | Đơn web đã xác nhận giữ nhãn BOOKING trên Dispatch; đơn web có dịch vụ VIP tự thành đơn VIP/Mixed; panel chi tiết đơn web có thêm thông tin khách; đơn `*_MENU` chưa xác nhận không còn lẫn trên Dispatch | Báo: đơn menu/web phải xác nhận ở trang Web Booking mới lên Dispatch |
| KTV | Không đổi | — |
| Admin / Tài chính | Đơn web có dịch vụ VIP xác nhận sau deploy được xếp nhóm VIP trong báo cáo; doanh thu tổng không đổi | Không cần |

**Rủi ro & cách lùi:** revert 2 commit; không ghi dữ liệu, đơn đã xác nhận giữ nguyên `source` đã ghi.
**Sau khi merge:** `main` trên máy vẫn lệch (còn `abdf1654`) — nên đưa về theo `origin/main` (việc riêng, cần user đồng ý vì bỏ commit local).
