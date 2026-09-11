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

Ký hiệu cột: **TD** Tạm dừng → Tiếp tục · **KS** Kết thúc sớm (khách xuống sớm) · **HK** Huỷ không công · **HC** Huỷ có công · **ĐR** Đổi KTV — người bị đổi ra · **VT** Đổi KTV — người vào thay.

| # | Khía cạnh | TD | KS | HK | HC | ĐR | VT |
|---|---|---|---|---|---|---|---|
| 1 | **Tiền tua** | theo giờ gán | theo giờ làm thực | 0đ | theo giờ làm thực | **0đ** | số phút quầy chốt (`customCommissionDuration`) |
| 2 | **Giờ tích luỹ (D)** | theo giờ gán | theo giờ làm thực | 0 | theo giờ làm thực | **0** | số phút quầy chốt |
| 3 | **Lượt tua (A/B/C)** | giữ | giữ | mất (`is_punished`) | giữ | **mất** | +1 (`TurnLedger` source `SWAP_KTV`) |
| 3b | Lượt tua (D) | — | — | không đụng `TurnLedger` | — | **không đụng** (giờ đã mất ở dòng 2) | **không ghi** `TurnLedger` |
| 4 | **Thưởng Xuất sắc** | bình thường | bình thường | 0 | cần xác nhận | **0, không tính vào số người chia** | **trọn suất** — đơn tính như 1 người |
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

---

## 3. Trạng thái triển khai (11/09/2026)

### ✅ Đúng và đã kiểm bằng dữ liệu / mô phỏng

| Ô | Kiểm bằng |
|---|---|
| ĐR/VT dòng 1, 2, 3, 3b, 9, 11, 16, 17 | `scripts/qa/qa_swap_ktv_e2e.ts` — 50/50, cả dưới `TZ=UTC` |
| ĐR dòng 1 ở ví, lịch sử, sổ cái ngày, báo cáo, giờ D | đối chiếu 6 cặp KTV-dịch vụ thật (600.000đ tính sai → 0) |
| ĐR/VT dòng 4 | mô phỏng: trước 10/10 → sau 0/20; đơn 4 tay thường giữ 10/10 |
| ĐR dòng 10 | điều kiện `laNguoiBiDoiRaKhoiDon` trên đơn thật `WB-11092026-002` |
| ĐR dòng 15 | route lịch sử trên đơn thật `WB-11092026-003` |
| VT dòng 14 | `coWorkersOf` trên đơn thật trả `[]` |

### ⚠️ Còn lỗ — chưa sửa

| Ô | Lỗ | Cần |
|---|---|---|
| ĐR dòng 8 | Hàm SQL `skip_handover_with_quota` (migration `20260908120000`) và `HandoverService.getSkipQuota` đếm theo `technicianCodes` → người thay bấm bỏ qua là trừ lượt người bị đổi | migration sửa hàm SQL + TS cùng lúc (Mức 2) |
| Toàn hệ thống | `/api/finance/reports/ktv-ranking` đếm `TurnLedger` KHÔNG lọc `is_punished` → người mất tua vẫn hiện đủ tua trong báo cáo | lọc `is_punished` (Mức 2) |
| Toàn hệ thống | 3 báo cáo tài chính + `TurnQueue.estimated_end_time` dựng giờ bằng `getHours()` phía server → lệch 7 tiếng trên Vercel | dùng `gioDongHoVN` (Mức 2) |
| HC dòng 4 | Chưa rà thưởng của đơn huỷ có công | xác nhận nghiệp vụ trước |
| KS dòng 10 | Plan gốc (L5) muốn "hoàn tất, không qua đánh giá"; hiện đi CLEANING | xác nhận nghiệp vụ trước |
| Triển khai | Mọi bản sửa hôm nay chỉ ở máy local — nhánh chưa push, bản Vercel vẫn chạy code cũ | user quyết push |
| Chuẩn code | Một phần code viết hôm nay đặt tên biến tiếng Việt và chữ cứng trong `.tsx` — trái `CLAUDE.md` mục 1, 6 | dọn khi đụng lại các file đó |

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
