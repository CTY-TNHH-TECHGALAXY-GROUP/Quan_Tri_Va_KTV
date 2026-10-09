# Plan — Giờ tích luỹ KTV loại D bị hụt 1 phút (1h30 → 1h29)

> Mức 2 — chạm `lib/services/KtvDLedgerEngine.ts` (giờ tích luỹ → thứ tự tua, xếp hạng giờ, quỹ giờ xét khoá).
> Trạng thái: **ĐÃ SỬA CODE 10/10/2026** theo quyết định user: hoàn tất bình thường → đủ giờ gán (không dùng dung sai 60s). Dữ liệu cũ: **chưa ghi**, chờ user chọn (mục 9).

## 1. Hiện tượng (đã probe DB thật, chỉ đọc)

| KTV | Bill | Ngày | Gán | Giờ làm thực (mốc) | `actual_minutes` | `paid_minutes` |
|---|---|---|---|---|---|---|
| T007 | NDK-002-09102026-B | 09/10 | 90 | 09:13:57 → 10:43:14 = **89,29p** | **89** | 90 |
| T007 | 010-05102026-A | 05/10 | 70 | 14:57:39 → 16:07:09 = **69,50p** | **69** | 70 |
| T025 | 004-02102026 | 02/10 | 180 | 08:08:48 → 11:08:07 = **179,30p** | **179** | 180 |

Tiền vẫn đủ (paid = gán). Chỉ **giờ tích luỹ** hụt 1 phút. Màn Lịch sử KTV (`app/api/ktv/history/route.ts:566`) và màn Quản lý giờ (`KtvDLedgerReader`) cùng đọc `KTVDTurnLedger.actual_minutes` → **hai phía khớp nhau, cùng sai**.

Quét toàn bộ 108 chặng loại D (không tạm dừng, không custom) từ 20/09: **17 chặng kết thúc sớm hơn giờ gán < 90 giây** (T027: 7, T007: 5, T016: 2, T025: 2, T021: 1). Chặng nào sớm ≥ 30 giây thì mất 1 phút.

## 2. Nguyên nhân gốc

`computeMinutes` (`lib/services/KtvDLedgerEngine.ts:280-284`) dùng **hai luật khác nhau** cho cùng một chặng hoàn tất bình thường:

```ts
paid   += completedNormally ? gan : ...                         // tiền: đủ giờ gán
actual += Math.min(Math.round(workedMs / 60000), gan)           // giờ: phút thực, làm tròn
```

Mốc kết thúc được ghi khi đồng hồ app KTV về 0 (auto-finish). Đồng hồ chạy theo giờ máy điện thoại + `timeOffsetRef` (đo một lần, không trừ độ trễ mạng), nên có lúc về 0 sớm hơn mốc server 30–45 giây. 89,29p → `round` = 89 → 1h29.

> Lý do chính xác của 30–45 giây (lệch đồng hồ máy / offset) **chưa chứng minh được** từ dữ liệu. Không nên sửa ở phía đồng hồ: đó là `KTVDashboard.logic.ts` (mục 8, rủi ro cao) và vẫn còn sai số mạng. Sửa ở chỗ tính giờ là đủ và an toàn.

## 3. Đề xuất sửa (một khuyến nghị)

**Dung sai 60 giây cho chặng hoàn tất bình thường**: nếu `completedNormally` và giờ làm thực hụt so với giờ gán **dưới 60 giây** → tính đủ giờ gán. Ngoài dung sai giữ nguyên luật cũ (round, chặn trần).

```ts
// 🔧 top of file
const FULL_CREDIT_GRACE_MS = 60_000;

const shortfallMs = gan * 60000 - (workedMs ?? 0);
actual += completedNormally && shortfallMs < FULL_CREDIT_GRACE_MS
    ? gan
    : (hasMarks && workedMs > 0) ? Math.min(Math.round(workedMs / 60000), gan) : gan;
```

Vì sao không lấy luôn `gan` cho mọi chặng hoàn tất bình thường (như tiền)? Giờ tích luỹ quyết định thứ tự tua; giữ "giờ = thời gian thật" cho trường hợp hụt nhiều phút, chỉ bỏ nhiễu đồng hồ dưới 1 phút.

Không đổi: quầy bấm kết thúc (`endedByCounter`), kết thúc sớm khi tạm dừng, chặng TAKEOVER/custom, chặng `voided`.

Dọn kèm: `KtvTypeDTurnService.calculateActualMinutes` **không còn nơi gọi** (grep `app` + `lib`) → chỉ sửa comment trong `lib/segment-time.ts:28`, không đụng hàm (ngoài phạm vi).

## 4. Ảnh hưởng chéo (4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Lịch sử (`/api/ktv/history`), Xếp hạng giờ (`app/ktv/hours-ranking`) | `app/admin/ktv-office/hours`, thứ tự tua, kỷ luật | `computeMinutes` → `KTVDTurnLedger.actual_minutes` | Sửa 1 chỗ |
| Số liệu | `actual_minutes` từ sổ | `actual_minutes` từ sổ (`KtvDLedgerReader`, `KtvOfficeScoreService`, `KtvTypeDDisciplineService`) | `KtvDLedgerEngine` | Khớp (trước & sau) |
| Tiền | Không đổi — `paid_minutes` đã = gán | Không đổi | | Không ảnh hưởng |
| Realtime | Không đổi | Không đổi | `KTVDTurnLedger` | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | | Không lộ dữ liệu |

## 5. Vùng nổ (4.5)

1. **Dùng chung gì?** `computeMinutes` chỉ gọi từ `computeRows` (writer/recompute queue + backfill). Mọi màn giờ loại D đọc kết quả qua sổ.
2. **Sai thì sập gì?** Hàm thuần, không query DB. Lỗi cú pháp/logic → giờ tính sai, không làm sập dispatch hay app KTV. Thứ tự tua có thể đổi nhẹ (+1 phút cho người bị hụt).
3. **Luồng khách?** Không — chỉ sổ nội bộ KTV loại D.
4. **Cô lập?** Có — một nhánh trong một hàm thuần.

## 6. Dữ liệu cũ

Sửa code chỉ áp cho dòng được tính lại. Cần chạy lại `scripts/backfill_ktvd_turn_ledger.ts <from> <to> --dry-run` (in diff `actual_minutes`), duyệt, rồi chạy thật. Script upsert theo `(staff_id, booking_item_id)`, **không đè dòng `LOCKED`**. Đề xuất khoảng: 01/10 → nay (hoặc từ ngày chốt kỳ gần nhất — user chọn).

⚠️ Backfill làm thứ tự tua hôm nay đổi nhẹ → nên chạy ngoài giờ cao điểm.

## 7. Kiểm thử (mục 10)

- Mock `computeMinutes`: 89,29p/90 → 90; 69,50/70 → 70; 179,30/180 → 180; 88,9/90 (hụt 66s) → 89; quầy kết thúc 30,6/45 → 31; tạm dừng + kết thúc sớm → như cũ; TAKEOVER/custom/voided → như cũ. Chạy thêm `TZ=UTC`.
- Dry-run backfill: in danh sách dòng đổi, so sánh 2 phía (Lịch sử KTV vs giờ phía Quản lý) cho T007, T025.

## 8. Ghi chú ngoài phạm vi (báo, không tự sửa)

- Bill 008-24092026-A (T007): tạm dừng 2p14s nhưng chỉ chạy thêm 25s → hụt 1p49s ⇒ đồng hồ có thể chưa bù đủ thời gian tạm dừng. Nên điều tra riêng.
- Đồng hồ KTV đo `timeOffsetRef` một lần, không trừ độ trễ — nguồn gốc khả dĩ của 30–45s.

## 9. Kết quả sau khi sửa (10/10/2026)

User chốt: **hoàn tất bình thường = đủ giờ gán**, giống luật tiền (`actual = completedNormally ? gan : …`). Mock 9 ca đạt, cả `TZ=UTC`.

So sánh sổ hiện tại với kết quả tính lại (01/09 → 10/10, chỉ đọc): 18 dòng đổi giờ (NH079 +1, T007 +7, T025 +1, T079 +2, T016 +401 phút).

⚠️ Không chạy nguyên `backfill_ktvd_turn_ledger.ts`: script ghi đè mọi cột, nên **15 dòng tháng 9 sẽ đổi cả tiền**. Các dòng này được tính trước khi có luật "hoàn tất bình thường = đủ tiền". VD: T016 WB-009-03092026 32.723đ → 150.000đ.

⚠️ 013-09102026-A (T016, 09/10): làm 2p35s / 45p, không có dấu quầy kết thúc, đã nhận đủ 45p tiền. Sau khi sửa, giờ cũng thành 45p. Cần điều tra vì sao đơn kết thúc sau 2 phút mà không có dấu quầy kết thúc.

## 10. Đã cập nhật dữ liệu (10/10/2026)

User chọn: chỉ cập nhật giờ tích luỹ, từ 01/10. Bill 013-09102026-A tính đủ giờ vì quầy kéo hoàn thành giùm (không phải bất thường).

Đi qua đường chính thức `recomputeTurnRows` → RPC `ktvd_commit_recompute`. Ghi thẳng vào bảng bị trigger `trg_ktvd_require_writer_v2` chặn. Trước khi ghi đã so sánh mọi cột: chỉ `actual_minutes` đổi.

| KTV | Bill | Cũ → Mới |
|---|---|---|
| T025 | 004-02102026 | 179 → 180 |
| T007 | 010-05102026-A | 69 → 70 |
| T007 | NDK-002-09102026-B | 89 → 90 |
| T016 | 013-09102026-A | 3 → 45 |

Kết quả: rowsWritten 4, voided 0, locked 0. Kiểm lại: cả 4 dòng khớp với công thức mới.
