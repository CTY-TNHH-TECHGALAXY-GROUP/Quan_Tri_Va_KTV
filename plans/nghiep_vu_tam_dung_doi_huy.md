# Luật nghiệp vụ: Tạm dừng · Kết thúc sớm · Huỷ · Đổi KTV

**Lập:** 2026-09-11 · **Nhánh:** `feat/bit-lo-hong-phase1`
**Vai trò:** bảng tra CHUẨN cho mọi thay đổi chạm vào các sự kiện này — xem `CLAUDE.md` mục 13.
**Plan triển khai gốc:** `plans/plan_tam_dung_huy_ket_thuc_som.md`.

---

## 0. Vì sao cần file này

Luồng đổi KTV bị sửa đi sửa lại **hơn 15 lần** trong một phiên, gần như mỗi lần đều cùng một kiểu: sửa đúng màn hình được chỉ ra, bỏ sót các chỗ khác cùng đọc một dữ liệu. Ví dụ đã gặp thật:

| Lần | Sửa ở | Bỏ sót — lòi ra sau |
|---|---|---|
| Tước tiền người bị đổi | 3 hàm tính tiền | fallback `itemDuration <= 0 → 60` ở ví, lịch sử, sổ cái ngày, báo cáo → trả nguyên 1 giờ |
| Hiện dải "Đã đổi" ở lịch sử | dải đỏ | "Chờ FB", "Tạm tính", "Chưa bàn giao", "Xuất sắc" vẫn hiện bên dưới |
| Người bị đổi không dọn phòng | màn KTV | ô Nợ bàn giao + **chặn tan ca** vẫn tính họ |
| Thưởng | (chưa ai nghĩ tới) | người bị đổi ăn nửa suất Xuất sắc của người vào thay |

**Gốc rễ chung:** `BookingItems.technicianCodes` CỐ Ý giữ cả người bị tước quyền lợi (để truy vết ai từng làm cho khách). Nên **mọi chỗ dùng `technicianCodes` để suy ra quyền lợi hay nghĩa vụ đều sai** với người bị đổi/huỷ không công — và có rất nhiều chỗ như vậy.

---

## 1. Nguyên tắc gốc (không được phá)

1. **Mốc chốt tiền là `pauseStart`**, không phải lúc quầy bấm nút. `counterLog[].at` chỉ để truy vết.
2. **`actualStartTime` bất biến.** Thời gian dừng nằm trong `seg.pauses[]`, giờ làm thực = `workedMsOf()` ở `lib/segment-time.ts`.
3. **KTV là thực thể độc lập** (`CLAUDE.md` 9.4): không đóng dấu giờ cho KTV khác.
4. **Người bị tước vẫn nằm trong đơn** (`technicianCodes` + chặng `voided: true`). Hệ quả: **quyền lợi và nghĩa vụ phải đọc từ chặng, không đọc từ `technicianCodes`**. Hàm chuẩn:
   - `KtvCommissionService.isKtvVoidedOnItem(item, code)` — bị tước trên một dịch vụ.
   - `laNguoiBiDoiRaKhoiDon(items, code, ktvMatchesSeg)` (`lib/segment-time.ts`) — bị đổi ra khỏi CẢ bill.
5. **Kết quả của người bị tước là ĐÃ CHỐT** từ lúc quầy bấm: 0đ, 0 giờ. Không có trạng thái "chờ" nào (chờ FB, tạm tính, chờ duyệt phòng) áp cho họ.
6. **Giờ đồng hồ `seg.startTime` / `seg.endTime` là giờ VN** "HH:mm". Máy chủ chạy UTC → phía server phải dùng `gioDongHoVN()`, cấm `new Date().getHours()`.
7. **Một nguồn công thức** (`CLAUDE.md` 4.2): tiền, giờ, tua, thưởng chỉ tính ở `lib/services/*`.

---

## 2. Bảng hệ quả — sự kiện × khía cạnh

**Cập nhật 21/09/2026 — hoàn tất bình thường:** tiền tua loại D dùng đủ phút gán của từng chặng/KTV. Kết thúc sớm do quầy vẫn dùng phút duyệt (`customCommissionDuration`) hoặc thời gian thực khi có dấu quầy chốt; chặng bị tước và người thay chưa xong không được cộng tiền. Giờ tích luỹ, lượt tua, thưởng/sao, dọn phòng, bàn giao, nợ phòng, hàng đợi, đồng hồ, tự chốt, Kanban, cùng làm, lịch sử sự kiện và nhật ký quầy giữ nguyên quy tắc hiện hành. Ví/lịch sử/báo cáo nhận tiền từ cùng sổ cái sau tính lại; thuế vẫn áp dụng sau tiền tua.


Ký hiệu cột: **TD** Tạm dừng → Tiếp tục · **KS** Kết thúc sớm (khách xuống sớm) · **HK** Huỷ không công · **HC** Huỷ có công · **ĐR** Đổi KTV — người bị đổi ra · **VT** Đổi KTV — người vào thay.

**Sự kiện ngoài đơn (03/10/2026) — CG: Admin/DEV cộng giờ tích luỹ thủ công** (`plans/plan_cong_gio_tich_luy_thu_cong.md`). Không gắn BookingItem nên các khía cạnh 3–14 **không áp dụng**; bảng riêng:

| Khía cạnh | CG |
|---|---|
| Tiền tua / thưởng / ví | **không đổi** (`money_penalty = 0`) |
| Giờ tích luỹ (D) | +X vào tháng của `work_date` admin chọn (lùi ≤ 60 ngày); `KTVDPenaltyLedger.HOURS_GRANT`, `hours_penalty` âm |
| Thứ tự nhận tua / quỹ giờ xét khoá | tự đổi theo giờ ròng mới (cùng `netHoursByStaff`) |
| Màn app KTV | sổ giờ hiện dòng "Cộng giờ (admin)" + lý do; ô "Cộng thêm" |
| Lịch sử / nhật ký | sổ giờ admin hiện "Bù giờ"; `SecurityAuditLogs.HOURS_GRANT`; thông báo KTV loại `HOURS_GRANT` |
| Lý do | **bắt buộc** (≥ 5 ký tự) |
| Quyền | chỉ ADMIN / DEV (`requireRole`), UI ẩn nút với vai khác |

| # | Khía cạnh | TD | KS | HK | HC | ĐR | VT |
|---|---|---|---|---|---|---|---|
| 1 | **Tiền tua** | theo giờ gán | theo giờ làm thực | 0đ | theo giờ làm thực | **0đ** | số phút quầy chốt (`customCommissionDuration`) |
| 2 | **Giờ tích luỹ (D)** | theo giờ gán | theo giờ làm thực | 0 | theo giờ làm thực | **0** | số phút quầy chốt |
| 3 | **Lượt tua (A/B/C)** | giữ | giữ | mất (`is_punished`) | giữ | **mất** | +1 (`TurnLedger` source `SWAP_KTV`) |
| 3b | Lượt tua (D) | — | — | không đụng `TurnLedger` | — | **không đụng** (giờ đã mất ở dòng 2) | **không ghi** `TurnLedger` |
| 4 | **Thưởng Xuất sắc** | bình thường | 0 (khách về sớm, không có sao) | 0 | **0** — đã huỷ là không có gì | **0, không tính vào số người chia** | **trọn suất** — đơn tính như 1 người |
| 5 | **Đánh giá khách tính cho ai** | KTV đó | KTV đó | — | KTV đó | **không** | người vào thay |
| 6 | **Dọn phòng / bàn giao** | có | có | **có** (đang làm dở, phòng vẫn bẩn) | có | **KHÔNG** | có |
| 7 | **Nợ phòng / chặn tan ca** | tính | tính | tính | tính | **KHÔNG tính** | tính |
| 8 | **Hạn mức bỏ qua bàn giao** | tính | tính | tính | tính | **KHÔNG tính** ⚠️ | tính |
| 9 | **Hàng đợi** (TurnQueue / KtvAssignments) | giữ | giữ tới khi bàn giao | giữ tới khi bàn giao | giữ tới khi bàn giao | về `waiting` (chỉ khi đang ôm đơn này), phiếu `CANCELLED`, kéo đơn kế tiếp, giữ `queue_position` | `working`, phiếu `ACTIVE` |
| 10 | **Màn app KTV sau sự kiện** | tiếp đồng hồ | Đánh giá → Dọn phòng → Thưởng | Đánh giá → Dọn phòng | Đánh giá → Dọn phòng | **Đánh giá khách → về trang chủ** | Nhận đơn (dòng *"Phòng đã mở, khách đang nằm trên phòng"*) → chụp ảnh xác nhận → bắt đầu; không quy trình chuẩn bị, không thời gian chuẩn bị |
| 11 | **Đồng hồ** | trừ khoảng dừng | dừng tại mốc | dừng tại mốc | dừng tại mốc | dừng tại `pauseStart` | chạy **từ lúc họ bấm Bắt đầu**, không mang khoảng dừng của người cũ |
| 12 | **Tự chốt khi hết giờ** (Kanban) | không khi đang dừng | — | — | — | — | **KHÔNG** khi chưa bấm bắt đầu |
| 13 | **Thẻ Kanban** | "Tạm dừng" | nhãn RA SỚM | cột Đã Huỷ | cột Đã Huỷ | 1 dòng + nhãn **ĐÃ ĐỔI** + khoảng giờ, cùng thẻ với người thay | dòng bình thường |
| 14 | **"Cùng làm với"** | — | — | — | — | — | **không** hiện người bị đổi (`lib/co-workers.ts`) |
| 15 | **Lịch sử KTV** | bình thường | bình thường | nhãn Huỷ không công + lý do, 0đ | bình thường | nhãn **Đã đổi**, *Lý do đổi: "…"*, Tiền tua 0đ; **ẩn** đánh giá, bàn giao, thưởng, bảng thu nhập | bình thường |
| 16 | **Nhật ký quầy** | PAUSE / RESUME | FINISH_EARLY | CANCEL + lý do | CANCEL + lý do | SWAP_KTV `"cũ → mới · lý do"` | SWAP_SEND `"mới"` |
| 17 | **Lý do bắt buộc** | không | không | có | có | **có** — hiện ở lịch sử người bị đổi | — |


### 2.1. Sự kiện "Áp khuyến mãi +phút" (Promotion Engine, 02/10/2026)

Quầy áp voucher `FREE_MINUTES` → engine thêm 1 dịch vụ `KM####` giá 0đ, trạng thái `WAITING`, **không gán KTV**. Từ đó nó là một dịch vụ nối tiếp bình thường (user chốt 02/10/2026: KTV **được** tính tua cho phút KM). Voucher giảm giá (`PERCENT_DISCOUNT` / `FIXED_DISCOUNT`) là dòng tiện ích giá âm, không có KTV → mọi khía cạnh KTV "không áp dụng".

| # | Khía cạnh | KTV làm dịch vụ KM | KTV đang làm dịch vụ đã trả tiền |
|---|---|---|---|
| 1 | Tiền tua | theo phút gán của item KM (luồng add-on) | không đổi — item đã trả tiền không bị sửa |
| 2 | Giờ tích luỹ (D) | theo phút gán | không đổi |
| 3 | Lượt tua | theo luồng điều phối add-on hiện có | không đổi |
| 4 | Thưởng Xuất sắc | như dịch vụ thường | không đổi |
| 5 | Đánh giá khách | item KM đi qua FEEDBACK như dịch vụ thường | không đổi |
| 6–8 | Dọn phòng / nợ phòng / hạn mức bỏ qua | như dịch vụ thường | không đổi |
| 9 | Hàng đợi | chỉ vào hàng khi quầy điều phối item KM | không đổi |
| 10–12 | Màn app / đồng hồ / tự chốt | như add-on | không đổi |
| 13 | Kanban | thẻ dịch vụ "Khuyến mãi +30 phút" | không đổi |
| 14–15 | Cùng làm / lịch sử | như dịch vụ thường | không đổi |
| 16 | Nhật ký | `PromotionUsages` (staff_id, applied_at, cancel_reason) | — |
| 17 | Huỷ KM | `promo_cancel_usage` chỉ khi item KM chưa điều phối; đã điều phối → huỷ dịch vụ ở màn Điều phối, trigger tự huỷ usage | — |

Điều kiện phát voucher đọc **phút đã trả của dịch vụ VIP** (`promo_order_minutes`) và loại item KM → 60 trả + 30 KM không thành 90.

---

### 2.2. Sự kiện "Hủy gộp khi đang làm" — HG (07/10/2026)

Dịch vụ ghép ("Gộp chung KTV", 60p + 70p = 130p) đã bắt đầu, quầy hủy gộp qua popup + **lý do bắt buộc**. Action riêng `unmergeRunningService` (gọi lại luồng "đổi thời lượng dịch vụ đã bắt đầu"). Đã xong (dọn phòng / chờ đánh giá / hoàn tất) → **chặn**. Chi tiết: `plans/plan_sua_gop_chung_ktv_dispatch.md` mục 9.

| Khía cạnh | A — KTV đang làm dịch vụ trước | Dịch vụ sau (S) |
|---|---|---|
| Tiền tua / giờ tích luỹ | phút gán mới = **max(phút gốc dịch vụ trước, phút đã làm thật — làm tròn lên, trừ thời gian dừng)** | chưa ai hưởng; KTV mới như đơn thường |
| Lượt tua | giữ, không phạt, không ghi thêm `TurnLedger` | KTV mới: lượt thường |
| Thưởng / đánh giá / dọn phòng / nợ phòng / hạn mức bỏ qua | như thường trên dịch vụ trước | KTV mới như thường |
| Hàng đợi | `KtvAssignments` giữ ACTIVE, `planned_end_time` = giờ bắt đầu thật + phút mới | về `WAITING` (chờ điều phối), không KTV |
| App KTV / đồng hồ | giữ `actualStartTime`, tổng mới; thông báo `KTV_ORDER_CHANGED` (đổi thời gian + tách dịch vụ) | — |
| Kanban / tên | tên gốc dịch vụ trước | hiện thành dịch vụ chờ điều phối trong cùng đơn |
| Nhật ký quầy | `UNMERGE_RUNNING` "A 130p → 60p (đã làm 40p) · tách S · lý do" | cùng dòng |
| Đã kiểm | `npm run test:huy-gop-dang-lam-db` (DB TEST, chặng dạng chuỗi như prod, phân công ACTIVE): 40p / 80p / đang tạm dừng / đã xong (chặn) / lý do ngắn / chưa bắt đầu / đường lưu thường bị chặn; 9 bảng sổ KTV không đổi | |

### 2.3. Sự kiện "Báo off đột xuất" — Loại D (07/10/2026)

KTV Loại D đã đăng ký đi làm, **từ 07:00** bấm "Báo off đột xuất" ở màn chấm công. Không cần quầy duyệt. Quy chế mục 06: bỏ lịch đã đăng ký mà báo trễ → trừ 10 giờ. Quyết định 07/10: **chỉ trừ giờ, không bao giờ khoá**. Plan: `plans/plan_bao_off_dot_xuat_loai_d.md`.

| Khía cạnh | KTV báo off |
|---|---|
| Giờ tích luỹ | −10h **ngay khi bấm** (case `SUDDEN_OFF_REPORTED`, sổ `KTVDPenaltyLedger` loại `ABSENT_NO_NOTICE`), chốt luôn |
| Khoá tài khoản | Không, kể cả quỹ giờ âm; cấu hình LOCK bị ép về trừ giờ |
| Tiền tua / lượt tua / thưởng / đánh giá | không áp dụng — chưa vào ca, không có đơn |
| Dọn phòng / nợ phòng / chặn tan ca / hạn mức bỏ qua | không áp dụng — chưa điểm danh |
| Hàng đợi | `goOffline`, không vào TurnQueue |
| App KTV | thẻ "Đã báo off đột xuất"; ẩn Báo đi muộn; trạng thái = đã rời ca (không còn "ĐÃ TỚI TIỆM") |
| Đồng hồ / tự chốt / Kanban / cùng làm với / lịch sử đơn | không áp dụng — không có đơn |
| Nhật ký quầy | KTV Hub "NGHỈ ĐỘT XUẤT" + Lịch OFF (`KTVLeaveRequests.is_sudden_off`) — có sẵn |
| Lý do | tự do, không bắt buộc |
| Báo off rồi vẫn đến | cho điểm danh, giữ −10h, **không** xét trễ thêm |
| Cron 00:00 | `penalty_applied = SUDDEN_OFF_REPORTED` → chỉ đóng sổ; có SUDDEN_OFF mà chưa đánh dấu → xử dự phòng, không khoá |
| Đã kiểm | `scripts/qa/qa_23_bao_off_dot_xuat.ts` — 19/19, cả `TZ=UTC` |

### 2.4. Huỷ khi KTV CHƯA BẮT ĐẦU + mã chặng người vào thay (08/10/2026)

Plan: `plans/plan_sua_doi_ktv_giua_ca_va_huy_dv_dang_cho.md`. User chốt 08/10: **chưa bắt đầu mà huỷ thì không nhận gì**.

| Khía cạnh | Người chưa bắt đầu (đang chờ QUEUED / đã nhận chưa bấm Bắt đầu) — HK **và** HC, huỷ 1 dịch vụ **và** huỷ cả đơn |
|---|---|
| Tiền / giờ | 0 — chặng void `UNASSIGNED`, `customCommissionDuration = 0`; công tắc "có công" không áp dụng |
| Lượt tua | gỡ dòng `TurnLedger` của bill (không còn `is_punished`), trừ khi KTV còn phân công khác trong bill |
| Hàng đợi | `KtvAssignments` → CANCELLED, `promote_next_assignment`; **không bao giờ** bị kéo sang dịch vụ đã huỷ |
| App KTV / lịch sử | không còn đơn; không hiện dịch vụ này (giống quầy bỏ phân công) |
| Cách làm | `BookingModificationService.releaseUnstartedStaffBeforeCancel` gọi RPC `dispatch_unassign_unstarted_staff` (p_reject=false) cho từng KTV **trước** khi huỷ; tìm theo chặng, không theo TurnQueue. Đơn nối tiếp A/B giữ đường huỷ riêng |
| Người đã bắt đầu | không đổi (cột HK / HC ở bảng trên) |

**VT — mã chặng:** chặng TAKEOVER có `id = <mã chặng người bị thay>-takeover-<ms>` (duy nhất trong item) + `replacesSegmentId`; `KtvAssignments.segment_id` của người vào thay = mã đó. Không dùng lại mã người bị thay (chặng void vẫn trong item; bàn giao / guard nối tiếp / phân công khớp theo mã).

## 3. Trạng thái triển khai (11/09/2026 · cập nhật 21/09/2026)

- Hoàn tất bình thường nhận đủ tiền theo phút gán: đã sửa engine và calculator legacy trong mã nguồn; chưa deploy/backfill dữ liệu thật. Plan: `plan_fix_type_d_subsecond_commission.md`.


### ✅ Đúng và đã kiểm bằng dữ liệu / mô phỏng

| Ô | Kiểm bằng |
|---|---|
| ĐR/VT dòng 1, 2, 3, 3b, 9, 11, 16, 17 | `scripts/qa/qa_swap_ktv_e2e.ts` — 50/50, cả dưới `TZ=UTC` |
| ĐR dòng 1 ở ví, lịch sử, sổ cái ngày, báo cáo, giờ D | đối chiếu 6 cặp KTV-dịch vụ thật (600.000đ tính sai → 0) |
| ĐR/VT dòng 4 | mô phỏng: trước 10/10 → sau 0/20; đơn 4 tay thường giữ 10/10 |
| HK/HC dòng 4 | mô phỏng: huỷ có công và không công, khách 4 sao → thưởng 0 (bản vá 08/09) |
| ĐR dòng 10 | điều kiện `laNguoiBiDoiRaKhoiDon` trên đơn thật `WB-11092026-002` |
| ĐR dòng 15 | route lịch sử trên đơn thật `WB-11092026-003` |
| VT dòng 14 | `coWorkersOf` trên đơn thật trả `[]` |
| VT dòng 3, 9 — người vào thay **loại C không có dòng TurnQueue** (14/09) | `scripts/qa/qa_swap_ktv_e2e.ts` — 121/121, cả dưới `TZ=UTC`: tạo dòng `working` (không `assigned`), 2KTV-1DV không bị đụng, 3 bộ lọc huỷ đơn / huỷ dịch vụ / Hoàn tất đều tìm thấy C, huỷ không công → C mất tua như A/B, C bị đổi ra lại → về `waiting` + phiếu CANCELLED, D on-call không bị tạo dòng, race 2 lệnh → 1 dòng |
| CG (03/10) — cộng giờ âm vào sổ phạt | `scripts/qa/qa_hours_grant.ts`: netHoursByStaff với giờ âm; đối chiếu 13 KTV D: xếp hạng == thứ tự tua == earned−penalty+granted, cả `TZ=UTC` |
| Tự Hoàn tất khi khách không chấm (14/09) — item `FEEDBACK` quá 5 phút → `DONE`, `itemRating` giữ NULL, không đụng CLEANING/CANCELLED, không lùi booking DONE | chỉ item vào chờ từ 01/09 (VN) | `scripts/qa/qa_auto_complete_feedback.cjs` — 73/73 trên DB thật trong transaction ROLLBACK (biên 31/08 23:30 ↔ 01/09 00:10 VN, số phút chờ 20 / 8 / 0 / hỏng / âm, và **chờ cả đơn con xong** sau sự cố 14/09: người sau trong chuỗi đang làm / chưa bắt đầu / bị tước, 2 KTV **song song** (một người còn làm / vừa xong / cả hai xong), dịch vụ khác còn CLEANING / IN_PROGRESS / PAUSED; **đổi KTV / kết thúc sớm / huỷ có công – không công** × nối tiếp / song song). Kanban giữ dịch vụ "Đang làm" khi một người xong: `scripts/qa/qa_kanban_sequential_hold.ts` 36/36 (nối tiếp, song song, đổi KTV, kết thúc sớm, huỷ — dựng chặng bằng `voidSegment` / `closeOpenPause` thật) + đối chiếu mọi item thật không phải FEEDBACK giữ nguyên). Migration `20260914120000` đã áp 14/09 16:24, lần chạy đầu chốt 13 dịch vụ |

- **Báo off đột xuất Loại D (07/10/2026)**: nút từ 07:00, −10h, không khoá; cron đóng sổ. Kiểm bằng `scripts/qa/qa_23_bao_off_dot_xuat.ts` (cả `TZ=UTC`). Chưa deploy.
- **Đổi KTV giữa ca + huỷ khi chưa bắt đầu (08/10/2026)** — mục 2.4: `scripts/qa/qa_28_e2e_van_hanh_test_db.ts` 301/301 trên DB TEST, cả `TZ=UTC` (đổi A→B, A→B→C, đổi 1 người trong 2 KTV, đổi sang Loại D; huỷ dịch vụ / cả đơn khi KTV đang chờ; huỷ khi đã nhận chưa bắt đầu; 2 dịch vụ cùng bill; đổi rồi huỷ trước khi người vào thay bắt đầu; dữ liệu cũ dạng chuỗi; trigger bật/tắt; ca đêm) — lượt cuối 378/378. Nhánh `fix/doi-ktv-va-huy-dv-dang-cho-20261008`, chưa deploy. Lỗi gốc: chặng TAKEOVER không có `id` nên người vào thay không bấm Bắt đầu được từ 27/09; huỷ chỉ tìm KTV qua TurnQueue nên bỏ sót KTV đang chờ.
- **Khuyến mãi +phút (02/10/2026)**: item KM đi theo luồng add-on, không sửa item đã trả tiền; kiểm bằng `scripts/qa/qa_promotion_engine.ts` (local + Supabase test, cả `TZ=UTC`). Chưa deploy production. Plan: `plan_promotion_engine_backend.md`.

### ⚠️ Còn lỗ — chưa sửa

| Ô | Lỗ | Cần |
|---|---|---|
| ĐR dòng 8 | Hàm SQL `skip_handover_with_quota` (migration `20260908120000`) và `HandoverService.getSkipQuota` đếm theo `technicianCodes` → người thay bấm bỏ qua là trừ lượt người bị đổi | migration sửa hàm SQL + TS cùng lúc (Mức 2) |
| Toàn hệ thống | `/api/finance/reports/ktv-ranking` đếm `TurnLedger` KHÔNG lọc `is_punished` → người mất tua vẫn hiện đủ tua trong báo cáo | lọc `is_punished` (Mức 2) |
| Toàn hệ thống | 3 báo cáo tài chính + `TurnQueue.estimated_end_time` dựng giờ bằng `getHours()` phía server → lệch 7 tiếng trên Vercel | dùng `gioDongHoVN` (Mức 2) |
| KS dòng 5, 10, 15 | Chốt 11/09: đi thẳng Hoàn tất, không chờ đánh giá. Quầy đã đúng; còn `handleFinishService` rơi `FEEDBACK` và lịch sử hiện "Chờ FB" | `plans/plan_ket_thuc_som_hoan_tat.md` — chờ chốt: KTV còn dọn phòng không |
| Triển khai | Mọi bản sửa hôm nay chỉ ở máy local — nhánh chưa push, bản Vercel vẫn chạy code cũ | user quyết push |
| Chuẩn code | Một phần code viết hôm nay đặt tên biến tiếng Việt và chữ cứng trong `.tsx` — trái `CLAUDE.md` mục 1, 6 | dọn khi đụng lại các file đó |
| VT dòng 3 — **A/B** vào thay, chưa bấm Bắt đầu (có sẵn, thấy 14/09) | `swapKtvOnPausedItem` update dòng A/B thành `working` nhưng KHÔNG set `booking_item_ids` → `cancelBookingItem` (lọc `contains booking_item_ids`) không tìm thấy họ → huỷ 1 dịch vụ không công mà A/B vẫn giữ tua; quầy Hoàn tất cũng không nhả được dòng. Loại C không dính (dòng tạo mới có `booking_item_ids`) | set `booking_item_ids: [item.id]` trong lệnh update của `pullIncomingKtvToWorking` (Mức 2). ✅ **ĐÃ SỬA 09/10** (nhánh `fix/doi-ktv-va-huy-dv-dang-cho-20261008`): `pullIncomingKtvToWorking` ghi `booking_item_ids` (gộp dịch vụ đang giữ trên cùng đơn); `cancelBookingItem` xét "đã bắt đầu" theo TỪNG KTV (trước: theo cả dịch vụ → người vào thay chưa bắt đầu bị giữ "để dọn phòng"). Kiểm: `qa_28` F07e, F07f |
| ĐR × huỷ dịch vụ (thấy 09/10, có sẵn) — ✅ **ĐÃ SỬA 09/10** (user chốt: người bị đổi ra KHÔNG phải bàn giao) | Trước: đổi A → B rồi huỷ dịch vụ → chặng đã bắt đầu của A không ai bàn giao → `submitCustomerRating` giữ đơn `FEEDBACK`. Sửa: (1) điều kiện bàn giao bỏ qua chặng `voided` + `note CHANGED`; huỷ không công đã bắt đầu (`CANCELLED_NO_CREDIT`) vẫn phải bàn giao; (2) hai hàm huỷ không tước lại chặng đã tước (giữ `CHANGED`); (3) khách chấm không đổi dịch vụ CANCELLED thành DONE. Kiểm: `qa_28` F07f, F09f | — |
| VT loại C khi D/B on-call không dòng | Cố ý KHÔNG tạo dòng cho D / B on-call vào thay (lệch hàng giờ D, luật kỷ luật D) → với họ các lỗ "quầy thấy Sẵn sàng", "huỷ không công vẫn giữ tua" vẫn còn như trước | cần chốt nghiệp vụ riêng cho D on-call |
| KS × nối tiếp / song song (thấy 14/09) — ✅ **ĐÃ SỬA CODE 14/09** (`plan_ket_thuc_som_nguoi_chua_bat_dau.md`: tước + nhả + trừ tua A/B/C), chờ deploy + sửa đơn cũ | Trước sửa: `finish-early-paused/route.ts` chỉ đóng chặng **đã bắt đầu**. Người sau trong chuỗi / người song song **chưa bắt đầu** bị bỏ ngỏ → `handleFinishService` thấy chặng chưa bắt đầu nên lùi dịch vụ về `IN_PROGRESS`, Kanban giữ "Đang làm", job tự hoàn tất không bao giờ chốt. Đơn thật: `aa79c2d1-…` (TEST-260908-DS5E) kẹt `IN_PROGRESS` + `earlyLeave` từ 08/09. Test đã khoá hành vi an toàn (không chốt) — đánh dấu ⚠️ | chốt nghiệp vụ người chưa bắt đầu khi khách về sớm (tước chặng? nhả tua? giữ lượt?) rồi sửa route (Mức 2) |
| Huỷ 1 dịch vụ khi KTV ĐÃ BẮT ĐẦU → bàn giao xong vẫn kẹt "đang làm" (có sẵn, thấy 10/10 ở `qa_29` T02) — ✅ **ĐÃ SỬA 10/10** | `cancelBookingItem` giữ TurnQueue `working` để KTV bàn giao (đúng) nhưng lại đóng phiếu `KtvAssignments` → `ktv_release_work_atomic` chỉ nhả tua theo phiếu nó chuyển `COMPLETED` nên không nhả. Áp dụng cả huỷ không công và có công; huỷ cả đơn không dính. Sửa: KTV đã bắt đầu giữ phiếu `ACTIVE` đến lúc bàn giao (plan `plan_huy_da_bat_dau_nha_tua_sau_ban_giao.md`). Kiểm: `qa_29` T02, T11–T15 | — |

---

## 4. Checklist khi thêm/sửa một sự kiện trong bảng này

Trước khi code, điền đủ 17 dòng ở mục 2 cho sự kiện đó. Rồi tìm theo từng dòng:

- **Dòng 1–4** (tiền, giờ, tua, thưởng): grep `technicianCodes` trong `lib/services/*`, `app/api/ktv/*`, `app/api/finance/*`, `app/api/cron/*`. Mỗi chỗ dùng nó để cộng tiền/điểm/lượt → phải loại chặng bị tước. Dò cả các nhánh dự phòng (`<= 0 → 60`, `commission === 0 → 60`).
- **Dòng 6–8** (dọn phòng, nợ, hạn mức): `app/api/ktv/attendance/status`, `lib/services/HandoverService.ts`, RPC `skip_handover_with_quota`.
- **Dòng 9** (hàng đợi): `TurnQueue`, `KtvAssignments`, RPC `promote_next_assignment`.
- **Dòng 10–12** (app KTV, đồng hồ, tự chốt): `KTVDashboard.logic.ts` (ScreenEngine), `ScreenDashboard.tsx`, `KanbanBoard.tsx` → `checkAutoFinish`.
- **Dòng 13–15** (hiển thị): Kanban, `lib/co-workers.ts`, `app/api/ktv/history` + `app/ktv/history/page.tsx` — mọi dòng trên thẻ, không chỉ dải nhãn.
- **Giờ**: mọi chuỗi "HH:mm" dựng ở server → `gioDongHoVN`.
- **Kiểm**: mở rộng `scripts/qa/qa_swap_ktv_e2e.ts` (hoặc bài tương tự); fixture phải giống dữ liệu thật (`endTime` "HH:mm", có `resumeItem` sau đổi…), chạy thêm dưới `TZ=UTC`.
