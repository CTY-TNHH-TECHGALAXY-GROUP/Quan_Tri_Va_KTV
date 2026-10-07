# Plan — Chuẩn hoá cột `BookingItems.segments` (cách 3: trigger + chuyển dữ liệu)

- **Mức**: 2 (trigger + migration + ghi dữ liệu thật). **Ngày**: 2026-10-07. **Trạng thái**: user duyệt "làm trên test" 07/10 → ĐÃ CHẠY TRÊN DB TEST, tất cả ĐẠT (mục 6). Trigger đang bật trên DB TEST. **ĐÃ CHẠY PRODUCTION 08/10/2026 04:29–05:xx**: trigger áp bằng script (5/5 ghi thử trong ROLLBACK), dữ liệu cũ do user chạy trên SQL Editor (backup `backup.booking_items_segments_20261008`). Đối chiếu 15/15 ĐẠT (mục 7).
- **Nhánh**: `feat/chuan-hoa-segments-20261007` (worktree `.worktrees/chuan-hoa-segments`, tách từ `28bb198b`).
- **Báo cáo đi kèm**: Doc "Chuẩn hoá cột chặng segments — ảnh hưởng và phạm vi".

## 1. Vấn đề
4.043/7.107 `BookingItems` (57%) lưu `segments` là CHUỖI JSON thay vì mảng (8 chỗ code ghi `JSON.stringify`). RPC lưu điều phối (nhánh dịch vụ chưa bắt đầu) không đọc được chuỗi → **quầy không gán KTV được cho dịch vụ phát sinh** (tái hiện DB TEST; prod 22 addon kẹt). Đã vá `jsonb_unwrap_string` vào 36 migration — vẫn sót.

## 2. Thay đổi
1. **Hàm + trigger chuẩn hoá** (migration mới):
   ```sql
   CREATE OR REPLACE FUNCTION normalize_booking_item_segments() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NEW.segments IS NOT NULL AND jsonb_typeof(NEW.segments) = 'string' THEN
       BEGIN
         NEW.segments := COALESCE(jsonb_unwrap_string(NEW.segments), NEW.segments);  -- hỏng → giữ nguyên, KHÔNG chặn ghi
       EXCEPTION WHEN OTHERS THEN NULL;
       END;
     END IF;
     RETURN NEW;
   END $$;
   CREATE TRIGGER aa_normalize_segments BEFORE INSERT OR UPDATE OF segments ON "BookingItems"
     FOR EACH ROW EXECUTE FUNCTION normalize_booking_item_segments();
   ```
   - Tên `aa_` → chạy TRƯỚC `guard_sequential_item_update` / `zz_dispatch_edit_history` (Postgres chạy BEFORE trigger theo tên).
   - Không phát sinh lần ghi mới: chỉ sửa NEW của lần ghi app vốn đã làm → `trg_ktvd_enqueue_item` không chạy thêm lần nào.
2. **Chuyển dữ liệu cũ** (script, không phải migration tự chạy):
   - Mỗi lô 500 dòng, trong transaction `SET LOCAL session_replication_role = replica` → **tắt mọi trigger** của lần chuyển: không đẩy `KTVDRecomputeQueue` (tiền/giờ Loại D), không tăng `dispatchRevision`, không ghi lịch sử.
   - `UPDATE "BookingItems" SET segments = jsonb_unwrap_string(segments) WHERE id = ANY($lô) AND jsonb_typeof(segments)='string' AND status NOT IN ('IN_PROGRESS','PAUSED')`.
   - Bỏ qua dòng đang làm (trigger chuẩn hoá chúng ở lần ghi kế tiếp).
   - Lưu file `before` (id + segments gốc) để lùi.
3. **Không** sửa RPC, **không** sửa 8 chỗ ghi chuỗi trong code ở đợt này (dọn sau).

## 3. Ảnh hưởng chéo (4.1) + Vùng nổ (4.5)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | app KTV đọc chặng qua `parseKtvSegments` (đọc cả 2 dạng) | điều phối, Kanban, CRM, báo cáo — đọc cả 2 dạng | ~40 hàm DB qua `jsonb_unwrap_string` | Không đổi hành vi; addon gán KTV được |
| Tiền / tua / giờ / ví | Không ghi | Không ghi | `KTVDRecomputeQueue` | Chuyển dữ liệu tắt trigger → không tính lại tiền Loại D. Trigger mới không thêm lần ghi |
| Realtime | `replica` vẫn phát sự kiện thay đổi dòng | idem | `BookingItems` | Chạy ngoài giờ, lô 500, nghỉ giữa lô |
| Quyền | — | — | — | Không đổi |
| **4.5-1 dùng chung** | Mọi lần ghi `BookingItems` của 3 app đi qua trigger mới | | | đường nóng nhất hệ thống |
| **4.5-2 nếu sai** | Trigger ném lỗi → mọi lần ghi đơn hỏng | | | Hàm nuốt mọi lỗi, trả NEW; lùi = `DROP TRIGGER` 1 lệnh |
| **4.5-3 luồng khách** | WRB hành trình khách: phòng/giường theo KTV hiển thị đúng hơn; WebBooking không đọc cột | | | Thay đổi tốt |
| **4.5-4 cô lập** | Trigger chỉ đổi kiểu, không đổi nội dung | | | |

Trigger thật trên production (đọc catalog 07/10): `guard_sequential_item_update_trigger`, `sync_unstarted_dispatch_plan_trigger`, `tr_notify_ktv_on_item_rating`, `tr_promo_on_item_cancel`, `tr_promo_on_item_delete`, **`trg_ktvd_enqueue_item`** (không có trong migration repo), `zz_dispatch_edit_history`. DB TEST có 11 trigger (thêm 4 trigger ABC/D) → test trên TEST là tập rộng hơn prod.

## 4. CAM KẾT TEST (bắt buộc trước khi xin chạy production)

Trên DB TEST, theo thứ tự, mọi bước phải ĐẠT; hỏng bước nào dừng lại báo user:
1. **Chụp trước**: số dòng 9 bảng sổ/hàng đợi KTV + `KTVDRecomputeQueue` + tổng `dispatchRevision` + số mục `dispatchHistory` + checksum nội dung chặng (sau unwrap) của mọi dòng.
2. Tạo trigger; ghi thử chuỗi, mảng, null, chuỗi hỏng → kiểm: chuỗi thành mảng, chuỗi hỏng vẫn ghi được (không chặn).
3. Chuyển dữ liệu theo lô với `replica`.
4. **Chụp sau** và đối chiếu: 0 dòng chuỗi (ngoài đang làm); checksum nội dung **giống hệt**; `dispatchRevision`, `dispatchHistory`, 9 bảng sổ, `KTVDRecomputeQueue` **không đổi**.
5. Chạy lại toàn bộ bộ test hiện có: `test:ghep`, `test:ghep-db`, `test:flow-db`, `test:huy-gop-db`, `test:huy-gop-dang-lam-db`, QA #20, #21, `npm run test:qa` (bộ cũ chạm DB đã có cơ chế dọn).
6. Ca mới: thêm phát sinh → gán KTV → lưu (trước đây lỗi `cannot extract elements from a scalar`) phải ĐẠT; KTV bắt đầu / kết thúc dịch vụ (app ghi chuỗi) → DB lưu mảng.
7. **Kiểm trên giao diện web thật**: chạy app local (`next dev`) trỏ DB TEST, dùng trình duyệt tự động bấm: tạo đơn nhanh → điều phối → ghép → hủy gộp → thêm phát sinh → gán KTV → bắt đầu/kết thúc trên app KTV → CRM / báo cáo; ghi lại ảnh màn hình và lỗi console.
8. Báo cáo kết quả bằng bảng ĐẠT/HỎNG trước khi xin chạy production. Production: chạy ngoài giờ, chụp trước–sau như bước 1 & 4, chạy lại bộ test chỉ đọc + kiểm UI sau khi chạy.

## 5. Lùi
- `DROP TRIGGER aa_normalize_segments ON "BookingItems"` — tức thì.
- Dữ liệu đã chuyển không cần lùi (mọi nơi đọc được cả 2 dạng); nếu cần: file `before` khôi phục từng dòng.


## 6. Kết quả trên DB TEST (07/10/2026)

Dữ liệu: nạp 551 dịch vụ mẫu với chặng lấy đúng hình dạng từ 551 dòng chuỗi trên production (500 đã xong/huỷ, 21 chưa bắt đầu, 30 đang làm; prod không có dòng nối tiếp dạng chuỗi). Đã dọn sau test.

| Bước | Kiểm tra | Kết quả |
|---|---|---|
| 2 | Cổng kiểm: ghi chuỗi, mảng, null, chuỗi hỏng, `'[]'`, UPDATE kiểu KTV bắt đầu, UPDATE cột khác | 7/7 ĐẠT — chuỗi hỏng vẫn ghi được |
| 3 | Đổi 522 dòng (2 lô, replica) — bỏ 30 dòng đang làm | ĐẠT |
| 3 | Đối chiếu trước–sau: 10 bảng sổ/hàng đợi (gồm KTVDRecomputeQueue 377→377), tổng dispatchRevision 306→306, lịch sử 295→295, checksum nội dung toàn bảng, nội dung từng dòng (633 dòng, khác 0) | ĐẠT (1 thông báo thừa là của đơn thử bước 2, đã xoá) |
| 4 | `qa_27` mới: phát sinh → gán KTV → lưu (lỗi gốc); bắt đầu → hoàn tất; huỷ đơn; app KTV ghi chuỗi | 4/4 ĐẠT |
| 4 | Chạy lại: test:ghep, test:ghep-db, test:flow-db, test:huy-gop-db, test:huy-gop-dang-lam-db, QA #20, #21 | Tất cả ĐẠT |
| 5 | Giao diện thật (app nhánh này, Chrome headless, DB TEST): admin đăng nhập, mở điều phối / CRM / báo cáo / Web Booking, tạo đơn nhanh trên UI, nhãn CRM = thẻ, bấm "Hồ sơ", KTV đăng nhập + dashboard | 12/12 ĐẠT, không lỗi trang/server/console |

Không chạy `npm run test:qa` cũ: bộ đó ghi rồi xoá trên DB của `.env.local` gốc = PRODUCTION.

**Phát hiện phụ khi test UI:** nhãn CRM lệch thẻ điều phối với đơn ca đêm (trước 07:00) — `startOfTodayVN` dùng nửa đêm lịch thay vì ngày làm việc. Đã sửa (dùng `toBusinessDate`) trên phase1 (chưa commit) và áp vào nhánh này; QA #21 thêm ca 04:22.


## 7. Kết quả PRODUCTION (08/10/2026, ngoài giờ)

| Bước | Kết quả |
|---|---|
| Chụp trước 04:29 | 7.124 dịch vụ, 4.054 chuỗi (63 đang làm), `KTVDRecomputeQueue` = 0 |
| Áp trigger `aa_normalize_segments` + ghi thử 5 ca trong transaction ROLLBACK | 5/5 ĐẠT, 0 dữ liệu thử còn lại; đối chiếu sau khi chỉ áp trigger: không đổi gì |
| Đổi dữ liệu cũ (user chạy SQL Editor, `session_replication_role = replica`, backup `backup.booking_items_segments_20261008`) | `noi_dung_khac` 0, `con_chuoi` 63, `hang_doi_loai_d` 0 |
| Đối chiếu từng dòng với ảnh chụp 04:29 | 15/15 ĐẠT: 10 bảng sổ/hàng đợi không đổi, dispatchRevision 278→278, lịch sử 278→278, nội dung 7.124 dòng khác 0, chuỗi 4.054 → 63 (chỉ dòng đang làm) |
| Dịch vụ phát sinh đang chờ (25) | 0 dòng còn chuỗi — gán KTV được |

Lần đổi bị hệ thống quyền của phiên Claude chặn (ghi production) → user tự chạy SQL theo khối 0–3.
