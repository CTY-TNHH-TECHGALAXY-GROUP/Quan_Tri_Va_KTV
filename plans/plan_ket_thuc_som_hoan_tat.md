# Plan: Kết thúc sớm (khách xuống sớm) đi thẳng Hoàn tất

**Mức:** 2 — chạm `app/api/ktv/booking/_handlers/handleFinishService.ts` (Dispatch, `CLAUDE.md` mục 9) và luật 9.6.
**Lập:** 2026-09-11 · **Trạng thái:** CHỜ DUYỆT — cần chốt câu hỏi ở mục 1.
**Bảng tra:** `plans/nghiep_vu_tam_dung_doi_huy.md`, cột **KS**.

---

## 1. Câu hỏi phải chốt trước

**Khách xuống sớm thì KTV có còn phải dọn phòng + bàn giao ảnh không?**

- **(A) Có — khuyến nghị.** Chỉ bỏ bước *chờ khách đánh giá*. Hoàn tất ngay khi KTV bàn giao xong.
  Lý do: khách về sớm thì phòng vẫn bẩn; đầu phiên 06/09 kết thúc sớm từng làm KTV mất bước Dọn phòng → Bàn giao và bạn gọi đó là lỗi *rất nghiêm trọng* (chú thích ở `finish-early-paused/route.ts:163`). Phía quầy hiện đã chạy đúng kiểu này.
- **(B) Không.** Hoàn tất ngay lúc quầy bấm Kết thúc, nhả KTV luôn. Đảo ngược quyết định 06/09; kéo theo phải nhả `TurnQueue`/`KtvAssignments` ở route kết thúc sớm và bỏ màn Bàn giao bên app KTV.

Phần dưới viết cho **(A)**.

---

## 2. Hiện trạng

| Chỗ | Đang làm | Đúng chưa |
|---|---|---|
| `finish-early-paused/route.ts` | item → `CLEANING`, `options.earlyLeave = true`, chốt giờ tại `pauseStart`, không nhả KTV | ✅ |
| Kanban — nút tiếp theo ở cột Dọn phòng | `✅ Hoàn tất (ra sớm)` → `DONE`, bỏ `FEEDBACK` | ✅ |
| Kanban — ô đánh giá | "Khách xuống sớm — không chờ đánh giá" | ✅ |
| `handleFinishService.ts:199` — KTV bàn giao xong | `DONE` chỉ khi `alreadyRated`; ra sớm không ai chấm → rơi `FEEDBACK` | ❌ kẹt Chờ đánh giá tới khi tự bỏ qua 24h |
| `app/api/ktv/history/route.ts:618` | `isFeedbackDone = trạng thái đã chốt` → trước `DONE` hiện "Chờ FB", "Tạm tính" | ❌ tiền đã chốt theo giờ làm thực |

## 3. Thay đổi

1. **`handleFinishService.ts`** — coi `options.earlyLeave === true` là đã thoả điều kiện "khách đã chấm": `alreadyRated = … || item.options?.earlyLeave === true`. Bàn giao xong → `DONE` thẳng.
2. **`CLAUDE.md` luật 9.6** — thêm ngoại lệ: *"Đơn khách xuống sớm (`earlyLeave`) không chờ đánh giá: chỉ cần `allSegsDone` + đã bàn giao."* Chép sang `.gemini/rules.md`.
3. **`app/api/ktv/history/route.ts`** — `isFeedbackDone = isFinalStatus || earlyLeave`; `isProvisional = false` với đơn ra sớm. Không trừ sao (rating 0 → mức trừ `0`, đã chốt ở plan gốc Q2).
4. **Bảng tra** — cập nhật cột KS dòng 5, 10, 15.

## 4. Bảng Ảnh hưởng chéo (`CLAUDE.md` 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | app KTV: Đánh giá hồ sơ khách → Bàn giao → Thưởng (không đổi); `/api/ktv/history` | Kanban: thẻ ra sớm tự vào cột Hoàn tất khi KTV bàn giao, không cần quầy bấm | `handleFinishService` | Sửa |
| Số liệu | tiền tua theo giờ làm thực, không trừ sao, hiện "Thực nhận" thay "Tạm tính" | báo cáo đọc cùng sổ cái | `KtvDLedgerEngine` (rating 0 → trừ 0), `KtvCommissionService` | Khớp — không đổi công thức |
| Thưởng Xuất sắc | 0 (không có sao) | 0 | `calculateBookingBonus` (sao < 4 → 0) | Không ảnh hưởng — vì không có đánh giá |
| Realtime | ScreenEngine nhận `DONE` → màn Thưởng như đơn thường | Kanban nghe `BookingItems` | bảng `BookingItems` | Đồng bộ |
| Quyền xem | không đổi | không đổi | | Không lộ dữ liệu |

## 5. Kiểm (`CLAUDE.md` 9.8 + 13.6)

Mô phỏng `handleFinishService` với item `earlyLeave` và các ca: 1KTV-1DV, 1KTV-2DV gộp (một DV ra sớm, một DV thường), 2KTV-1DV, ca qua nửa đêm. Kỳ vọng: ra sớm + đã bàn giao → `DONE`; ra sớm chưa bàn giao → `CLEANING`; DV thường không đổi hành vi. Thêm một ca đơn ra sớm trong `/api/ktv/history` → `isFeedbackDone=true`, `isProvisional=false`.
