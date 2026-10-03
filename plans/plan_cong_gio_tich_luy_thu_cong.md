# Plan — Admin/DEV cộng giờ tích luỹ cho KTV loại D

> Mức 2 (giờ tích luỹ → thứ tự nhận tua). Ngày 2026-10-03 · Nhánh mới từ `main`.
> Yêu cầu: màn admin có chỗ "gửi giờ tích luỹ" cho nhân viên, chỉ vai **ADMIN** và **DEV**.

## 1. Hiện trạng

- Giờ ròng (quyết định thứ tự nhận tua, bảng xếp hạng, quỹ giờ xét kỷ luật) chỉ có **một công thức**
  ở `lib/services/KtvDLedgerReader.ts:186` `netHoursByStaff`:
  `Σ KTVDTurnLedger.actual_minutes/60 − Σ KTVDPenaltyLedger.hours_penalty`.
- Hiện **chỉ có đường trừ** (kỷ luật tự động, từ chối tua). Không có đường cộng giờ thủ công.
  Ca thật cần: T007 bị trừ oan 40h, T069 10h (tháng 9) — user quyết không hoàn, nhưng tình huống sẽ lặp lại.
- `KTVDPenaltyLedger` (`20260904120000_ktvd_turn_ledger.sql:120`): `hours_penalty NUMERIC` **không có CHECK ≥ 0**;
  unique `(staff_id, work_date, penalty_type)`. Route mở khoá đã dùng mẫu "upsert cộng dồn cùng ngày" cho `REACTIVATION_FEE`.

## 2. Cách làm — một khuyến nghị

**Ghi vào `KTVDPenaltyLedger` một dòng `penalty_type = 'HOURS_GRANT'` với `hours_penalty` ÂM (= −X).**

Lý do chọn thay vì bảng mới: `netHoursByStaff` và **mọi** nơi đọc giờ ròng (xếp hạng admin, hours-ranking KTV,
thứ tự nhận tua `KtvTypeDTurnService`, quỹ giờ xét khoá `quyGioThang`) tự đúng ngay, không bỏ sót chỗ nào →
hai phía không thể lệch (CLAUDE.md §4.2). Không cần migration.

- Cùng KTV + cùng ngày cộng 2 lần → upsert **cộng dồn** (như `REACTIVATION_FEE`), note nối chuỗi.
- **Ngày áp dụng (`work_date`) do admin chọn**, mặc định ngày làm việc hôm nay. Bắt buộc có vì quỹ giờ tính **theo tháng**:
  bù giờ tháng 9 phải ghi vào tháng 9 mới đúng bảng xếp hạng/quỹ giờ tháng đó. Chỉ cho chọn trong 60 ngày gần nhất.
- Chỉ **cộng** (X > 0, bước 0,25h, tối đa 50h/lần). Trừ giờ đã có đường kỷ luật, không mở thêm cửa.
- Lý do **bắt buộc** (≥ 5 ký tự).

## 3. Thay đổi

| # | File | Việc |
|---|---|---|
| 1 | `app/api/admin/ktv-office/hours-grant/route.ts` (mới) | POST `{staffId, hours, workDate, reason}` · `requireRole(['ADMIN','DEV'])` · kiểm KTV `work_type = TYPE_D` · upsert `HOURS_GRANT` cộng dồn · `SecurityAuditLogs` event `HOURS_GRANT` (details: hours, workDate, reason, by) · `createNotification` cho KTV "Bạn được cộng X giờ tích luỹ ngày … Lý do: …" |
| 2 | `lib/services/KtvOfficeScoreService.ts` | `HOURS_PENALTY_VI.HOURS_GRANT = 'Cộng giờ (admin)'`. `hoursLedger`/`hoursBreakdown`: dòng âm → hiển thị là **cộng** (`earned`-like, `granted`), `penaltyTotal` chỉ cộng phần dương, thêm `grantTotal`. Số dư luỹ kế không đổi công thức. |
| 3 | `app/api/admin/ktv-office/hours-detail/route.ts`, `hours-ranking/route.ts`, `app/api/ktv/hours-ranking/route.ts` | Trả thêm `granted`; không đổi `net`. |
| 4 | `app/admin/ktv-office/hours/page.tsx` + `AdminKtvHours.logic.ts` | Trong modal chi tiết KTV: nút **"Cộng giờ"** (chỉ hiện khi `role` ∈ ADMIN/DEV; server vẫn chặn) → form: số giờ, ngày áp dụng, lý do → gọi API → reload chi tiết + bảng. Dòng xếp hạng: hiện "Cộng +Xh" cạnh "Phạt −Yh". |
| 5 | `app/ktv/hours-ranking/page.tsx` | Dòng sổ giờ của chính mình hiện "+Xh · Cộng giờ (admin) · lý do". |
| 6 | `TableInSupabase.md` | Ghi `penalty_type = 'HOURS_GRANT'`, `hours_penalty` âm = cộng giờ. |
| 7 | `plans/nghiep_vu_tam_dung_doi_huy.md` | Thêm sự kiện "Cộng giờ thủ công" vào bảng §2 và §3 (CLAUDE.md §13.7). |

## 4. Bảng hệ quả (CLAUDE.md §13) — sự kiện "Admin cộng giờ"

| Khía cạnh | Kết quả |
|---|---|
| Tiền tua / thưởng / ví | **Không đổi** — chỉ cột giờ, `money_penalty = 0` |
| Giờ tích luỹ | +X vào tháng của `work_date`, hiện ngay (không chờ chốt sổ) |
| Thứ tự nhận tua | Đổi theo giờ ròng mới ở lần xếp tiếp theo (`KtvTypeDTurnService.getMonthlyNetHours`) |
| Quỹ giờ xét khoá/trừ (`quyGioThang`) | Tăng theo → có thể đổi kết quả LOCK↔DEDUCT của cron đêm đó — đúng ý nghĩa bù giờ |
| Lượt tua, đánh giá, dọn phòng, nợ phòng, hạn mức bỏ qua, hàng đợi TurnQueue, đồng hồ, tự chốt, Kanban, "cùng làm với" | **Không áp dụng** — không gắn BookingItem |
| Màn app KTV | `hours-ranking`: dòng "+Xh Cộng giờ (admin)"; dashboard giờ ròng tăng |
| Lịch sử KTV / sổ giờ admin | Dòng mới, có `created_by`, `at` = lúc ghi |
| Nhật ký | `SecurityAuditLogs.HOURS_GRANT` (ai, bao nhiêu, ngày, lý do) |
| Lý do | Bắt buộc, lưu vào `note` |

## 5. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `app/ktv/hours-ranking`, `api/ktv/hours-ranking` (hiện dòng cộng) | `app/admin/ktv-office/hours` (nút + hiển thị), `api/admin/ktv-office/hours-*` | `KtvOfficeScoreService.hoursLedger/hoursBreakdown`, `netHoursByStaff` | Sửa cả 2 phía hiển thị; công thức 1 chỗ |
| Số liệu giờ | `netHoursByStaff` | `netHoursByStaff` | cùng hàm | Khớp |
| Thứ tự tua | `KtvTypeDTurnService` đọc cùng bảng | Điều phối đọc cùng | `KTVDPenaltyLedger` | Khớp |
| Realtime | Không có kênh giờ; KTV thấy khi mở lại màn | Admin reload sau khi cộng | — | Chấp nhận |
| Quyền | KTV không có đường gọi | Chỉ ADMIN/DEV (`requireRole`), người có `ktv_office_hours` chỉ xem | — | Không lộ |

## 6. Kiểm thử

1. Unit (thuần): `netHoursByStaff` với penalty −5 → net +5; `hoursLedger` mock: dòng HOURS_GRANT hiện là cộng, `penaltyTotal` không đổi, `grantTotal = 5`.
2. Cộng 2 lần cùng ngày → 1 dòng, tổng cộng dồn, note nối.
3. Vai RECEPTIONIST gọi API → 403; không đăng nhập → 401.
4. KTV loại A/B → từ chối ("chỉ KTV loại D có sổ giờ").
5. Đối chiếu 2 phía: cùng KTV + tháng, số `net` ở `/api/admin/ktv-office/hours-ranking` = `/api/ktv/hours-ranking`.
6. `TZ=UTC`: `work_date` chọn 30/09 không trượt sang 01/10.

## 7. Trạng thái (03/10/2026)

- Đã code đúng mục 3 (1→7). `tsc` 0 lỗi. `scripts/qa/qa_hours_grant.ts` ĐẠT (thuần + đối chiếu DB thật 13 KTV D, `TZ=UTC`).
- Thông báo KTV dùng type `HOURS_GRANT` → nhóm `reward` (`lib/notification-kind.ts`).
- Chưa bấm nút thật trên production — thử sau deploy với 0,25h cho một KTV test rồi kiểm sổ giờ 2 phía.
