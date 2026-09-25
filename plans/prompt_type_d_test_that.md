# Prompt — Bộ test phải gọi service thật (trước khi mở Phase 3)

> Copy toàn bộ phần dưới gửi cho anti.

---

Đã kiểm tra lại. **Cả 4 việc đợt trước đều đạt**, tôi xác minh bằng cách chạy thật chứ không đọc code:

- `JSON.parse` cho `segments` kiểu chuỗi — có, kèm `try/catch`, và bạn còn chủ động thêm so khớp `ktvId` không phân biệt hoa thường. Tốt.
- 2 key `_rate_per_min` đã xoá khỏi `SystemConfigs`, chỉ còn `_per_60m` = 100000/180000.
- `Math.round(finalPay)` đã có.
- 2 config JSON đã đúng dạng: `{"0":0,"1":0.75,"2":0.5,"3":0.25,"4":0}` và `{"ABSENT_NO_NOTICE":10,...}`.
- Fixture đã có case `segments` kiểu chuỗi JSON bên cạnh case kiểu mảng.
- `tsc --noEmit` sạch, 4 script đều exit 0, và đã commit thành 3 mốc.

**Còn một việc cấu trúc phải làm trước khi sang Phase 3.**

---

## Vấn đề: 4 script mô phỏng không kiểm code thật

`scripts/simulate_type_d_commission.mjs` dòng 3 **tự khai báo lại** `class KtvTypeDCommissionService` ngay trong script. Đó là một **bản sao** của thuật toán, không phải `import` từ `lib/services/KtvTypeDCommissionService.ts`. Ba script còn lại cũng không nạp service nào — chỉ `require('assert')`.

Nghĩa là bộ test đang kiểm bản sao, không kiểm code sẽ chạy thật. Hai bên trôi lệch nhau lúc nào cũng được mà test vẫn xanh.

**Đây chính là cơ chế đã khiến lỗi `segments` lọt lưới hai lần liên tiếp.** Không phải do bất cẩn — mà do bộ test không có khả năng phát hiện. Lần đầu fixture sai hình dạng, lần hai thiếu `JSON.parse`; cả hai lần script đều báo xanh.

Lần này chữ ký hàm hai bên vẫn khớp (5 tham số: `bookingItems, techCode, guestRating, ratePer60m, ratingDeductions`) vì bạn đã cập nhật cả hai. Nhưng đó là nhờ nhớ tay, không có gì bắt buộc.

**Vì sao phải xử lý ngay trước Phase 3:** Phase 3 là lúc tiền thật ghi vào `KTVDailyLedger`. Nếu chỉ sửa service mà quên sửa bản sao, test vẫn xanh trong khi ví KTV sai — và lúc đó phải truy ngược rồi sửa dữ liệu đã ghi, tốn hơn nhiều so với sửa code ở Phase 2.

---

## Yêu cầu

1. **Chuyển 4 script sang `.ts` và `import` service thật.** Bỏ hoàn toàn các class/hàm sao chép trong script — mỗi thuật toán chỉ được tồn tại đúng một bản, ở `lib/services/`.

2. **Dùng `ts-node`** — đã có sẵn trong `node_modules`, không cần cài thêm:
   ```bash
   npx ts-node scripts/simulate_type_d_commission.ts
   ```
   Dự án đã có tiền lệ chạy script `.ts` (xem `scripts/check.ts`, `scripts/check_ledger.ts`).

3. **Giữ nguyên toàn bộ case và assertion hiện có.** Không được giảm độ phủ. Nếu sau khi import service thật mà có case fail, **đừng sửa test cho khớp code** — báo tôi biết case nào fail và giá trị lệch bao nhiêu. Test fail lúc này là tín hiệu tốt: nó chứng minh bản sao đã che giấu sai lệch.

4. **Xoá các file `.mjs`/`.js` cũ** sau khi bản `.ts` chạy được, để không còn hai bộ test song song.

5. Thêm script chạy gộp vào `package.json`, ví dụ:
   ```json
   "test:type-d": "ts-node scripts/simulate_type_d_commission.ts && ts-node scripts/simulate_type_d_bonus.ts && ts-node scripts/simulate_type_d_discipline.ts && ts-node scripts/simulate_type_d_turn_order.ts"
   ```

---

## Báo cáo cần có

- Output `npm run test:type-d`, kèm mã thoát.
- Xác nhận không còn class/hàm nào bị sao chép trong `scripts/` — nêu rõ mỗi script giờ import gì từ đâu.
- Nếu có case fail sau khi đổi sang service thật: liệt kê case, giá trị mong đợi, giá trị thực tế. **Đừng tự sửa**, báo tôi.

Xong việc này thì mở Phase 3. **Chưa làm Phase 3 trong lượt này.**
