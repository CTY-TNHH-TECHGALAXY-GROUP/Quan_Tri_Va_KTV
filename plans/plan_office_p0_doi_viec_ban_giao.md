# Plan — Office P0.5: Dời việc / bàn giao, quá hạn, quyền duyệt, nhắc giờ, danh sách chung

> Mức 2 (migration + cổng chặn tan ca + sinh việc + phân quyền). Ngày viết: 10/10/2026.
> Nhánh: `feat/office-p0-checklist-v1`. Chạy trên **DB TEST + Vercel Hobby** trước; prod theo checklist go-live riêng.
> Nối tiếp `plans/plan_office_p0_nen_tang_checklist.md` (mục 1–18).

---

## 0. Kiểm tra lại "luồng việc tồn phải làm trước"

- **Bản cũ (`main`, commit `739a4749` 05/08/2026)**: màn NV có khối **"Việc tồn đọng — Cần xử lý trước 9h"** ở đầu trang (việc hôm qua chưa xong, tối đa 1 ngày). Đó **chỉ là nhãn + xếp lên đầu**: không khoá việc hôm nay, không có hạn 9h thật, không nhắc, không chặn tan ca.
- **Bản P0 hiện tại**: việc tồn (chỉ việc có `allow_carry_over`) nằm ở "Cần chú ý" với nhãn "Tồn từ dd/mm" và **chặn tan ca**. Không có hạn 9h, không có thứ tự "làm tồn trước".
- **Việc ngày NH01 seed `allow_carry_over=false`** → hiện tại việc ngày không tồn, nên luồng cũ thực tế **không còn chạy** với NH01.

→ Plan này đưa luồng đó trở lại **có thật**: việc bàn giao có hạn (mặc định 09:00), có nhắc, có cảnh báo giám sát, có tuỳ chọn khoá (mục 2.3).

## 1. Quyết định đã chốt (10/10/2026)

| # | Nội dung | Chốt |
|---|---|---|
| A | Dời / bàn giao việc vướng sang ngày khác | Đồng ý — **chỉ giám sát dời** |
| A' | Nút "Miễn hôm nay" | Bỏ, thay bằng "Dời sang…" (nút cũ tắt chặn vĩnh viễn — sai nghĩa) |
| B | Việc chưa xong không được biến mất | Màn giám sát giữ **7 ngày**, nhãn "Quá hạn N ngày" |
| C | Một vị trí nhiều người | **Dùng chung 1 danh sách** (hướng tới team chia việc) |
| D | Giám sát vắng | Nút **"Cho tan ca"** làm trước + **quyền duyệt Office** tách riêng trong Phân quyền |
| E | Hạn chót / khung giờ | **Có nhắc**. Ảnh offline + việc theo phòng: để sau |

## 2. Thiết kế

### 2.1. Dời / bàn giao (A)

Giám sát ở tab **Báo vướng** (và ở việc Quá hạn — mục 2.2) bấm **"Dời sang…"**:
- Ngày đích (mặc định ngày mai, tối đa +7), người làm (mặc định người cũ; danh sách = cùng vị trí trước, rồi nhân viên khác), ghi chú bàn giao (điền sẵn lý do vướng, sửa được, bắt buộc), **hạn hoàn thành** (mặc định 09:00 ngày đích).

Server `deferTask(sb, taskId, { toDate, assigneeId, note, dueTime }, actorId)` — **một hàm, một chỗ**:
1. Việc gốc: `cancelled_at=now`, `cancel_reason='DEFERRED'`, `deferred_to_date=toDate` → `deriveTaskState` = **DEFERRED** (không chặn tan ca). Không xoá ảnh/nhật ký.
2. Việc đích:
   - Việc lặp, **cùng người, cùng việc mẫu** → dùng đúng `dedupe_key` của bản ngày đích: có rồi thì **cập nhật** bản đó, chưa có thì **tạo trước** với khoá đó (cron 00:05 / ensure sau đó thấy trùng khoá → bỏ qua). **Không bao giờ ra 2 bản.**
   - Đổi người / việc đột xuất / việc tuần → tạo bản mới, khoá `D|<id việc gốc>` (dời lại lần nữa thì khoá theo id bản mới → không trùng).
   - Gán: `carried_from_id`, `handover_note`, `due_at` (hạn), `priority='HIGH'`, `blocks_checkout=true`, `task_type` giữ nguyên.
3. Nhật ký `TaskEvents`: `DEFERRED` trên việc gốc (từ ngày → ngày, cho ai, ghi chú), `HANDOVER_RECEIVED` trên việc đích.
4. Thông báo cho người nhận (TaskNotifications): "Việc bàn giao từ dd/mm: <tên> — <ghi chú>".

Màn NV ngày đích: khối **"Việc bàn giao — làm trước"** trên cùng (trên cả "Cần chú ý"), thẻ có nhãn **"Dời từ dd/mm"**, ghi chú bàn giao + ảnh/ lý do vướng cũ ở đầu thẻ, hạn "trước 09:00".

Người nhận **nghỉ** ngày đích (lọc nghỉ có sẵn trong ensure): việc vẫn tạo nhưng màn giám sát hiện **"Người nhận nghỉ — giao lại"** (dùng `reassignTask` có sẵn).

### 2.2. Quá hạn giữ 7 ngày (B)

- Màn giám sát (`getReviewQueue`): đọc việc **7 ngày gần nhất** còn ở trạng thái chặn (chờ duyệt / bị từ chối / vướng / chưa làm của việc có `blocks_checkout`), tab **"Quá hạn"**, nhãn "Quá hạn N ngày", hành động: Duyệt / Trả về / **Dời sang…** / Huỷ có lý do.
- Màn NV và cổng tan ca **không đổi**: vẫn chỉ hôm nay + hôm qua (việc cho tồn). Việc cũ hơn chỉ giám sát xử lý → NV không bị kẹt tan ca vì việc 5 ngày trước.

### 2.3. Thứ tự "bàn giao làm trước" — cần chốt 1 điểm

| Cách | Hành vi | Rủi ro |
|---|---|---|
| **Mềm (khuyên dùng)** | Khối bàn giao trên cùng + hạn 09:00 + nhắc NV + quá hạn → báo đỏ ở màn giám sát. Việc hôm nay vẫn làm được. Tan ca bị chặn tới khi việc bàn giao được duyệt / dời tiếp. | NV có thể làm việc khác trước — nhưng giám sát thấy ngay khi quá 09:00 |
| Cứng | Không **gửi duyệt** việc hôm nay được cho tới khi việc bàn giao đã **gửi duyệt hoặc báo vướng** | Việc "Trước 09:00" (mở sân, bật đèn) bị kẹt nếu việc bàn giao mất 30 phút; vướng lại thì phải báo vướng mới mở khoá |

Khuyên **Mềm**, vì các việc mở ca NH01 có giờ cứng (trước 09:00) — khoá cứng làm trễ mở cửa. Có thể thêm cờ theo vị trí sau nếu cần cứng.

### 2.4. Nhắc giờ (E)

**Vấn đề phát hiện**: seed NH01 đang để **mọi việc FREE** (không giờ) → nhắc không có gì để nhắc. Cần gán giờ theo artifact:

| Nhóm | Chế độ | Giờ |
|---|---|---|
| 1. Chuẩn bị sân ngoài (Trước 09:00) | DUE | 09:00 |
| 2. Mở sảnh & phòng gội (Đúng 09:00) | DUE | 09:15 |
| 3. Hoàn thiện set up (09:00 – 09:30) | WINDOW | 09:00–09:30 |
| 4. Duy trì xuyên suốt ca | FREE (khăn tay: MULTI 09:00/13:00/17:00 có sẵn) | — |
| 5. Chăm sóc & bổ sung linh hoạt (Trong ca) | FREE | — |
| 6. Chuẩn bị cuối ngày (Đúng 15:00) | DUE | 15:15 |
| 7. Đóng ca (Từ 17:00) | WINDOW | 17:00–kết ca |
| 8. Việc tuần | FREE | — |

Admin sửa được ở "Cấu hình" việc mẫu (đã có). Nhắc **trong app, không cần cron** (Hobby không có cron):
- NV: thẻ **"Sắp đến hạn"** (≤ 15 phút) vàng, **"Quá giờ"** đỏ; banner đầu trang "N việc quá giờ"; khối bàn giao quá 09:00 → đỏ.
- Giám sát: tab Quá hạn + đếm "quá giờ hôm nay" theo từng người.
- Quá giờ **không** chặn gì thêm, không phạt — chỉ hiển thị. (Push/Zalo: để sau, cần cron prod.)

### 2.5. Quyền duyệt Office (D)

- Thêm quyền **`office_task_review` — "Duyệt việc Office"** (nhóm Office) vào `lib/constants.ts` + `lib/types.ts` → hiện trong màn Phân quyền, gán cho vai/người nào cũng được.
- Các route **duyệt / trả về / gỡ vướng / dời / cho tan ca / đổi người / đặt ảnh mẫu** đổi từ `requirePermission('support_tasks_admin')` sang `requirePermissionAny(['support_tasks_admin','office_task_review'])` → **ai đang có quyền vẫn giữ quyền**.
- Cấu hình việc mẫu / vị trí / bộ việc vẫn chỉ `support_tasks_admin`.
- Nút **"Cho tan ca"** (đã có ở tab Người) đưa lên đầu thẻ người + thêm vào thẻ người ở tab Quá hạn; lý do bắt buộc (giữ nguyên).
- Sau (không làm trong plan này): chọn người duyệt theo vị trí.

### 2.6. Danh sách chung theo vị trí (C) — bước riêng, cuối plan

- Vị trí có cờ `shared_list=true`: việc sinh **1 bản / vị trí / ngày**, khoá `P|<vị trí>|<việc mẫu>|<ngày>|<mốc giờ>`, `assignee_id=NULL` tới khi có người **nhận** (bấm làm / chụp ảnh đầu tiên = nhận). Ai trong vị trí cũng thấy và làm được; ai nhận thì người khác thấy "Đang do X làm".
- Cổng tan ca cho vị trí chung: chặn **người đã nhận** việc đó; việc chưa ai nhận chặn **người tan ca cuối cùng** của vị trí (người cuối phải lo hết hoặc nhờ giám sát).
- NH01 hiện 1 người → bật cờ không đổi gì với NH001; làm sau A/B/D/E, có QA riêng (2 người cùng nhận 1 việc, người đầu tan ca, người cuối tan ca).
- Chạm đường nóng ensure + cổng tan ca → **sẽ trình lại chi tiết trước khi code bước này**.

## 3. DB — bước 1 KHÔNG cần migration (đổi lúc làm, 10/10/2026)

- Việc gốc: huỷ mềm bằng cột có sẵn `cancelled_at` + `cancel_reason = "Dời sang dd/mm[ cho NHxxx]"` → `deriveTaskState` = CANCELLED, **không đổi** hàm trạng thái lẫn cổng tan ca.
- Bàn giao (từ ngày, từ ai, ghi chú, lý do vướng cũ, giờ nhắc): sự kiện `HANDOVER` trong `TaskEvents` (màn NV vốn đã đọc bảng này); việc gốc có `DEFERRED` (sang ngày, việc đích, người nhận).
- Việc đích: cùng người + cùng việc mẫu → đúng `dedupe_key` `F|…` của ngày đích (có thì cập nhật, chưa có thì tạo trước; bản cùng khoá đã huỷ → tạo bản riêng). Còn lại → khoá `D|<id việc gốc>`.
- Không cột mới → không có rủi ro "select cột chưa có trên prod" (bài học 06/10). Prod chỉ cần 2 migration P0 đã có.
- Cờ `shared_list` (bước C) sẽ cần migration riêng — trình sau.

## 4. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía NV (KTV/Office) | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `app/support/tasks` (khối bàn giao, nhắc giờ) | `admin/support/reviews` (Dời, Quá hạn, Cho tan ca), Phân quyền | `employeeTasks.service.ts`, `officeTaskActions.service.ts`, `/api/support/*` | Sửa |
| Chặn tan ca | chấm công + 3 màn tan ca gọi `getCheckoutBlockers` | tab Người | `getCheckoutBlockers`, `deriveTaskState` (+ DEFERRED) | Sửa — DEFERRED không chặn; việc bàn giao chặn ngày đích |
| Số liệu | đếm 4 trạng thái, x/y đã duyệt | đếm hàng chờ | `deriveTaskState` | Khớp — một hàm |
| Realtime | Tasks / TaskNotifications | Tasks | bảng Tasks | Đồng bộ — không thêm kênh |
| Quyền xem | NV chỉ thấy việc của mình + ghi chú bàn giao của việc mình nhận | giám sát thấy 7 ngày | RLS chỉ đọc giữ nguyên | Không lộ thêm |
| KTV dispatch / tiền / tua | — | — | — | Không ảnh hưởng — không chạm Bookings, ledger, TurnQueue |

## 5. Vùng nổ (mục 4.5)

1. **Dùng chung**: `deriveTaskState` / `isCheckoutBlocking` (cổng tan ca ở chấm công + 3 màn tan ca), `fetchTasks`, `getReviewQueue`, `ensureTasksForDate`. Grep đủ trước khi sửa.
2. **Nếu sai thì sập gì**: `deriveTaskState` và `getCheckoutBlockers` **không sửa**. Sai ở `deferTask` chỉ làm hỏng thao tác dời (báo lỗi cho giám sát), không chạm màn NV. Không thêm cột → không có rủi ro select cột thiếu.
3. **Luồng khách**: Không — không chạm booking, WebBooking, WRB, email, hoá đơn.
4. **Cô lập**: nhắc giờ tính phía client từ `due_at` đã có; khối bàn giao đọc từ `TaskEvents` đã được tải sẵn trong `fetchTasks` (không thêm query).

## 6. Hệ quả nghiệp vụ (mục 13, rút gọn — không chạm tiền/tua/giờ)

| Vai | Tan ca hôm nay | Tan ca ngày đích | Màn app | Nhật ký | Điểm/thưởng/phạt |
|---|---|---|---|---|---|
| Người báo vướng (ngày gốc) | Được tan ca sau khi dời | Không liên quan (nếu đổi người) | Việc hiện "Đã dời sang dd/mm" (mờ) | DEFERRED | Không áp dụng — P0 chưa tính điểm |
| Người nhận (ngày đích) | — | Bị chặn tới khi việc bàn giao duyệt / dời tiếp | Khối "Việc bàn giao — làm trước" | HANDOVER_RECEIVED | Không áp dụng |
| Giám sát | — | — | Tab Quá hạn, nhãn "Người nhận nghỉ" | ai dời, lý do | — |

## 7. QA (`scripts/qa/qa_30_office_defer_test_db.ts`, `npm run test:office-defer`, chỉ DB TEST)

1. Dời việc ngày cùng người sang mai, **trước** khi bản mai được sinh → ensure mai không tạo bản thứ 2.
2. Dời sang mai **sau** khi bản mai đã sinh → cập nhật đúng bản đó.
3. Dời + đổi người; người mới không có việc mẫu này.
4. Người nhận nghỉ ngày đích → giám sát thấy "giao lại", reassign được.
5. Dời 2 lần liên tiếp (dời tiếp từ bản đích) → chuỗi `carried_from_id` đúng, không trùng khoá.
6. Cổng tan ca: ngày gốc không chặn; ngày đích chặn tới khi duyệt.
7. Quá hạn 3 ngày (chờ duyệt) → giám sát thấy, NV không bị chặn.
8. Quyền: người chỉ có `office_task_review` duyệt / cho tan ca được, **không** sửa việc mẫu được; người không quyền → 403.
9. Chạy cả QA cũ `test:office-db`, `test:office-seed`, `test:office-rls` + `TZ=UTC`.

## 8. Thứ tự làm & cách lùi

1. Migration TEST → `deferTask` + DEFERRED + QA 1–7 → UI giám sát (Dời, Quá hạn, Cho tan ca) → UI NV (khối bàn giao) → Hobby.
2. Quyền `office_task_review` + QA 8 → Hobby.
3. Giờ cho NH01 (seed cập nhật time mode — dry-run trước) + nhắc trong app → Hobby.
4. Danh sách chung (C): trình chi tiết rồi mới làm.

**Lùi**: revert commit từng bước; cột mới nullable, để nguyên vô hại. Việc đã dời: gỡ `cancelled_at` của việc gốc nếu cần (có nhật ký).

## 9. Đã chốt thêm (10/10/2026)

1. Thứ tự bàn giao: **Mềm**. Hạn (09:00 của việc bàn giao, giờ của từng nhóm) **chỉ để nhắc** — không khoá, không phạt.
2. Bảng giờ NH01 mục 2.4 dùng làm mặc định; admin chỉnh ở "Cấu hình".
3. Bắt đầu bước 1 trên DB TEST.

## 10. Kết quả bước 1 (10/10/2026, DB TEST)

- `deferTask` + route `POST /api/support/tasks/defer`; bỏ "Miễn hôm nay" (`unblockTask` không còn tham số waive).
- `getReviewQueue`: đọc 7 ngày, thêm `overdue`; tab Người giữ đúng cửa sổ hôm nay + tồn hôm qua.
- Giám sát: nút "Dời sang…" (Báo vướng, Quá hạn), tab "Quá hạn" gom theo người × ngày, "Đóng cả N việc".
- NV: khối "Việc bàn giao — làm trước", nhãn "Dời từ dd/mm", ghi chú ở đầu thẻ, nhắc "Sắp đến hạn" (≤15') / "Quá hạn" (chỉ hiển thị).
- QA: `npm run test:office-defer` (qa_30) **ĐẠT**; `test:office-db` (qa_27, sửa ca "Miễn hôm nay") **ĐẠT**; `tsc` sạch.
