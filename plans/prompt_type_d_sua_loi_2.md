# Prompt sửa lỗi Phase 2 — đợt 2

> Copy toàn bộ phần dưới gửi cho anti.

---

Đã kiểm tra lại Phase 2 sau khi bạn sửa. **P2 và P4b đạt** — 4 script giờ có assertion thật và đều exit 0, `KTVServiceHoursLedger` đã dọn sạch còn 0 dòng. Tốt.

Còn 4 việc. Làm xong báo lại, **vẫn chưa sang Phase 3**.

---

## P3 — ĐÃ CHỐT, thực thi theo hướng này

Chủ dự án chọn **lưu rate theo giờ rồi chia 60** — đúng như code bạn đang viết. Không dùng `1667 đ/phút` nữa.

Plan đã được cập nhật cho khớp: §5.1, §1, bảng config §4, và checklist §15. **Đọc lại §5.1 trước khi làm tiếp.**

Việc cần làm:

1. **Xoá 2 key rate cũ khỏi `SystemConfigs`**:
   ```sql
   DELETE FROM "SystemConfigs"
   WHERE key IN ('ktv_type_d_vip_rate_per_min', 'ktv_type_d_pt_rate_per_min');
   ```
   Hiện cả 2 bộ key cùng tồn tại (`_per_min` = 3000/1667 và `_per_60m` = 180000/100000). Để cả hai là bom hẹn giờ: sang Phase 3 nếu lấy nhầm `_per_min` truyền vào tham số `ratePer60m` thì `1667/60 ≈ 27,8đ/phút` — **trả sai gấp 60 lần**, và không có gì báo lỗi.

2. Bỏ luôn 2 key này khỏi `scripts/insert_type_d_configs.js` để lần chạy sau không seed lại.

3. Giữ nguyên `ktv_type_d_vip_rate_per_60m = 180000` và `ktv_type_d_pt_rate_per_60m = 100000`.

---

## P5 — Config seed bị hỏng, mất dữ liệu ⚠️

Truy vấn `SystemConfigs` cho thấy:

```
ktv_type_d_rating_deduction  = [object Object]
ktv_type_d_discipline_rules  = [object Object]
```

Script seed truyền thẳng object JavaScript vào chỗ cần chuỗi → JS ép kiểu thành `"[object Object]"`. **Giá trị thật đã mất hoàn toàn.** Bảng khấu trừ theo sao và bảng mức phạt giờ hiện không đọc lại được.

**Yêu cầu:** sửa `scripts/insert_type_d_configs.js` dùng `JSON.stringify()` cho 2 key này, chạy lại, rồi `SELECT` ra dán kết quả chứng minh đã đúng dạng JSON.

Kiểm tra luôn các key khác trong script xem còn chỗ nào cùng lỗi không.

---

## P1 — Còn hỏng trên 57% dữ liệu production

Phần bạn sửa đã đúng hướng: đọc `segments`, lọc `ktvId`, xử lý `customCommissionDuration`, `min(thực, gán)`, fallback về `gan` khi thiếu timestamp. Giữ nguyên.

**Nhưng thiếu bước `JSON.parse`.** Thống kê thật trên production:

```
BookingItems.segments kiểu string : 3.373 dòng  (57%)
BookingItems.segments kiểu array  : 2.577 dòng  (43%)
```

Mẫu dòng kiểu string:
```
"[{\"id\":\"seg-txrbiq\",\"bedId\":\"V1-2\",\"ktvId\":\"NH079\",\"roomId\":\"V1\",\"endTime\":\"06:39\",\"duration\":90,\"startTime\":\"05:09\",...}]"
```

Code hiện tại `(item.segments || []).filter(...)` — chuỗi không có `.filter` → **ném `TypeError`**, không phải trả 0đ. Code cũ xử lý đúng, xem `KtvCommissionService.calculateItemDuration()`:
```js
segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []);
```

Thêm chi tiết đáng lưu ý: các dòng kiểu **array** tôi lấy mẫu đều có `ktvId = ""` (rỗng). Nghĩa là dữ liệu có gán KTV thật nằm ở nhóm string — nhóm sẽ crash. Nhóm chạy được thì phần lớn không khớp KTV nào.

**Yêu cầu:**
1. Thêm `JSON.parse` có `try/catch` cho trường hợp `segments` là chuỗi.
2. **Fixture test phải lấy hình dạng từ dữ liệu thật.** Query một bản ghi `BookingItems` thật có `segments` kiểu string ra xem rồi mô phỏng theo. Đây là yêu cầu từ đợt trước chưa được làm — và chính là lý do lỗi này lọt lưới lần hai.
3. Thêm case test cho **cả hai** kiểu: `segments` là chuỗi JSON, và `segments` là mảng.
4. Cân nhắc so khớp `ktvId` không phân biệt hoa thường (code cũ dùng `.toLowerCase()`) — kiểm tra dữ liệu thật rồi quyết định, báo lại lựa chọn.

---

## P4a — Số thập phân

`calculateGuestCommission` đang trả `83333.33333333334` (14 chữ số thập phân), comment ghi "làm tròn ở lớp ngoài" — nhưng lớp ngoài chưa tồn tại, nên rác này sẽ đi thẳng vào ví KTV khi nối dây ở Phase 3.

Plan §5.1 đã chốt: **`Math.round` đến đơn vị đồng ngay tại bước cuối** của hàm tính. "Không làm tròn" trong quy chế nghĩa là không làm tròn theo mốc/milestone, không phải giữ nguyên số dấu phẩy động.

**Yêu cầu:** `return Math.round(finalPay);` và cập nhật assertion trong `simulate_type_d_commission.mjs` (Case 1 sẽ thành `83333` thay vì `83333.33333333334`).

---

## Báo cáo cần có

1. Output 4 script sau khi sửa, kèm mã thoát.
2. `SELECT key, value FROM "SystemConfigs" WHERE key ILIKE '%type_d%' ORDER BY key;` — chứng minh đã xoá 2 key cũ và 2 key JSON đã đúng dạng.
3. Nêu rõ lựa chọn ở P1 mục 4 (so khớp `ktvId` có phân biệt hoa thường hay không) và lý do.

**Không làm Phase 3.** Nếu thấy chỗ nào tôi nhận định sai, cứ nói — kèm bằng chứng từ code hoặc DB.

---

## Một việc nữa: commit lại

Toàn bộ công việc từ đầu tới giờ **chưa commit lần nào**, đang nằm hết ở trạng thái untracked/modified trên nhánh `feature/type-d-regime`. Có sự cố là mất sạch.

Commit Phase 0 và Phase 1 lại thành mốc riêng trước (hai phase đó đã đạt), rồi commit Phase 2 sau khi sửa xong. Message tiếng Việt không dấu, prefix `feat(type-d):`.
