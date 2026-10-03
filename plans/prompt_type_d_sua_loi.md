# Prompt yêu cầu anti sửa lỗi Phase 2

> Copy toàn bộ phần dưới gửi cho anti.

---

Tôi đã kiểm tra kết quả Phase 0–2 bằng cách chạy code thật và truy vấn DB production. **Phase 0 và Phase 1 đạt** — migration apply đúng, constraint đã mở, 2 bảng mới đã tạo, 11 tài khoản test đủ, 13 config đã seed, `tsc --noEmit` sạch. Làm tốt.

**Phase 2 thì chưa dùng được.** Có 4 vấn đề, xếp theo mức nghiêm trọng. Sửa xong báo lại, đừng làm tiếp Phase 3.

Lưu ý: prompt trước yêu cầu dừng sau Phase 1 và hỏi 3 câu trước khi vào Phase 2. Bạn đã làm tiếp và tự quyết một trong ba câu đó (xem P3). Lần này làm đúng phạm vi được giao.

---

## P1 — Tiền tua sẽ ra 0đ trên dữ liệu thật ⚠️ NGHIÊM TRỌNG NHẤT

`lib/services/KtvTypeDCommissionService.ts` dòng 23–31 đang đọc:

```js
item.actualStartTime
item.actualEndTime
item.duration
```

**Ba field này không tồn tại trên `BookingItems`.** Kiểm tra `TableInSupabase.md` và `supabase_types.ts`: bảng `BookingItems` có `guest_id` và `segments` (jsonb), **không** có `actualStartTime`/`actualEndTime`/`duration` ở cấp top-level. Thời gian thực nằm **bên trong từng phần tử của `segments`**.

Xem cách code hiện có làm đúng: `KtvCommissionService.calculateItemDuration()` (`lib/services/KtvCommissionService.ts:265`) — nó parse `item.segments`, lọc theo `seg.ktvId` khớp `techCode`, rồi mới đọc `seg.actualStartTime` / `seg.actualEndTime` / `seg.duration`.

Hệ quả hiện tại: `thuc` luôn = 0 → cả hai nhánh `if/else if` đều cho `phut` = 0 → `basePay` = 0 → **mọi tua TYPE_D trả 0đ**.

**Yêu cầu:**
1. Đọc thời lượng từ `segments`, lọc theo `ktvId` của KTV đang tính (tham khảo `calculateItemDuration`, đừng gọi lại nó — logic `min(thực, gán)` của TYPE_D khác).
2. Xử lý rõ ràng trường hợp **segment không có thời gian thực**: hiện code cho `phut = 0` (KTV mất trắng tiền). Đây gần như chắc chắn sai. Đề xuất fallback về thời lượng gán (`seg.duration`), nhưng **hỏi tôi trước khi chọn**, đừng tự quyết.
3. Kiểm tra luôn `seg.customCommissionDuration` — code cũ có ưu tiên field này, cần xác định TYPE_D có tôn trọng nó không.

---

## P2 — 4 script mô phỏng không có assertion (đây là gốc rễ)

`simulate_type_d_commission.mjs` có **0** chỗ `assert` / `throw` / `process.exit(1)`. Cả 4 script chỉ `console.log(giá_trị, "(Expected: X)")` rồi luôn thoát với mã 0.

Bằng chứng — chạy `simulate_type_d_turn_order.js`:

```
thực tế :  T002=20h,  T011=10h,  T001=-8h
Expected:  T002=10h,  T001=5h,   T011=5h      ← lệch hoàn toàn
[exit=0]                                       ← vẫn báo thành công
```

Script in ra kết quả sai lệch rõ ràng mà vẫn "xanh". Nghĩa là "4 script đều pass" không chứng minh được gì.

Và chính P1 lọt lưới vì lý do này: fixture trong `simulate_type_d_commission.mjs` dòng 40–50 tự chế object có `actualStartTime` ở **top-level** — đúng hình dạng code mong đợi, sai hình dạng dữ liệu thật. `tsc` cũng không bắt được vì tham số khai báo `any[]`.

**Yêu cầu:**
1. Mỗi case phải `assert` giá trị thực tế bằng giá trị mong đợi; sai thì `process.exit(1)`.
2. **Fixture phải giống hình dạng dữ liệu thật**: `BookingItem` có `segments` là mảng, mỗi segment có `ktvId`, `duration`, `actualStartTime`, `actualEndTime`. Lấy một bản ghi `BookingItems` thật từ DB ra xem cấu trúc rồi mô phỏng theo, đừng tự bịa.
3. Thêm case: segment **không có** `actualStartTime` (dữ liệu thật rất hay thiếu) — phải ra kết quả đúng theo quyết định ở P1 mục 2.
4. Chạy lại cả 4 và dán output thật, gồm cả mã thoát.

---

## P3 — Code lệch plan §5.1, và tự quyết thay vì hỏi

Plan §5.1 ghi công thức Cách B là `phút × 1667`. Code implement `phút × (ratePer60m / 60)`, cho ra `83333.33` thay vì `83350`.

Đây đúng là câu hỏi số 1 mà prompt trước yêu cầu **hỏi trước khi vào Phase 2**. Bạn đã tự chọn.

Về số học tôi thấy lựa chọn của bạn hợp lý hơn (60p phổ thông ra đúng 100.000đ thay vì 100.020đ). Nhưng **không được để code và tài liệu lệch nhau**.

**Yêu cầu:** dừng lại, nêu rõ đề xuất của bạn kèm lý do, chờ tôi chốt. Sau khi chốt: nếu giữ code thì phải sửa §5.1 của plan cho khớp; nếu giữ plan thì sửa code. Không tự làm.

---

## P4 — Số thập phân rác và ghi bẩn DB production

**(a)** Case 1 trả `83333.33333333334` — 14 chữ số thập phân. Plan ghi "không làm tròn", nhưng đó là nói về *không dùng floor/round theo mốc*, không có nghĩa để rác dấu phẩy động ghi vào ví KTV. Đề xuất cách xử lý (làm tròn đến đơn vị đồng?) rồi hỏi tôi, đừng tự chọn.

**(b)** `simulate_type_d_discipline.js` chạy thẳng vào **DB production** và để lại rác trong `KTVServiceHoursLedger`:

```
T001 | penalty_type=null        | hours_penalty=null
T011 | penalty_type=null        | hours_penalty=3
T002 | penalty_type=null        | hours_penalty=null
T001 | ORDER_REJECT             | 3
T001 | ABSENT_NO_NOTICE         | 10
```

Hai vấn đề:
- Script test không được ghi vào production. Hoặc dùng dữ liệu giả trong bộ nhớ, hoặc tự dọn sạch sau khi chạy.
- **3 dòng có `penalty_type = null`** — unique index chống trùng chỉ áp dụng `WHERE booking_id IS NULL AND penalty_type IS NOT NULL`, nên mấy dòng đó **không được bảo vệ**. Tính idempotent chưa thật sự đảm bảo. Tìm xem chỗ nào ghi ra dòng `penalty_type` rỗng và sửa.

**Yêu cầu:** dọn sạch các bản ghi rác đã tạo, sửa script để không ghi production, và vá chỗ sinh ra `penalty_type = null`.

---

## Phạm vi lần này

Chỉ sửa P1, P2, P4. P3 thì **hỏi rồi chờ**. **Không làm Phase 3.**

Báo cáo kèm: output thật của 4 script sau khi có assertion (gồm mã thoát), và câu truy vấn xác nhận đã dọn rác trong `KTVServiceHoursLedger`.

Nếu thấy chỗ nào tôi nhận định sai, cứ nói — nhưng kèm bằng chứng từ code hoặc DB, đừng chỉ khẳng định.
