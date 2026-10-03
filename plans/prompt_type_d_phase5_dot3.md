# Prompt — Phase 5, đợt 3 (khép lại)

> Copy toàn bộ phần dưới gửi cho anti.

---

Đã kiểm tra lại, **đợt vừa rồi làm tốt**. Tôi xác minh độc lập:

- Bảng khấu trừ sao sửa đủ **cả 3 nơi** (DB, component dòng 31, seed script) — đúng dạng phân số `{"0":0,"1":0.75,"2":0.5,"3":0.25,"4":0}` ✅
- Toàn bộ config khác về đúng chuẩn: rate 180000/100000, bonus 20, bonus_rate 1000, cọc 1tr, quỹ 250k, phí kích hoạt 1tr ✅
- Hai case test mới cho đúng số: `Case 6 (Rating 3) = 75000`, `Case 7 (Rating 0) = 100000` ✅ — đây là hai case chặn được đúng lỗi từng lọt hai lần
- Nhãn rate và nhãn kỷ luật sửa đúng, suffix `VNĐ/giờ` và `x giờ tua` đã có ✅
- `tsc --noEmit` sạch, 4 bộ test xanh, đã commit ✅

Còn **3 việc** để khép lại Phase 5.

---

## 1. Sót một chữ: "trễ" → "trừ"

```
dòng 178   {/* 5. Kỷ luật trễ giờ */}
dòng 185   <h2 ...>Kỷ luật trễ giờ tích lũy</h2>
```

Phải là **"trừ giờ"** — trừ vào giờ tích lũy. Bạn đã thêm được chữ "tích lũy" nhưng giữ nguyên lỗi gõ, nên câu "Kỷ luật trễ giờ tích lũy" đọc ra vô nghĩa.

Sửa cả hai dòng thành **"Kỷ luật trừ giờ tích lũy"**.

---

## 2. Nghiệm thu qua giao diện — vẫn chưa làm

Đây là việc còn lại quan trọng nhất. Lần trước bạn chạy script ghi thẳng vào DB; lần này **phải làm qua màn hình thật**.

Lý do: trang Admin có cơ chế tự ghép hậu tố `_${activeTab}` vào tên key (`page.tsx` dòng 88, 130, 136, 142). Script bỏ qua giao diện nên không chạm tới cơ chế đó. Đọc code thì `KtvTypeDSettingsBlock` có vẻ đi đường riêng — nhưng **đó là suy luận, chưa phải kiểm chứng**.

Cách làm:

1. Mở Admin → tab D
2. Sửa **từng ô một** trên màn hình, bấm Lưu của ô đó
3. Sau mỗi lần lưu, `SELECT` từ `SystemConfigs` xác nhận **đúng tên key** và **đúng giá trị**
4. Tải lại trang, xác nhận ô hiện đúng số vừa lưu
5. **Khôi phục giá trị chuẩn**, rồi `SELECT` lại lần cuối để chứng minh đã sạch

Nộp kết quả dạng bảng:

| Ô trên màn hình | Key ghi vào DB | Giá trị thử | Đọc lại |
|---|---|---|---|
| Rate VIP | `ktv_type_d_vip_rate_per_60m` | … | … |
| … | … | … | … |

Làm đủ mọi ô, không làm mẫu vài ô.

**Kiểm luôn tab A/B/C:** mở từng tab, sửa một ô, lưu, xác nhận key ghi ra vẫn đúng khuôn cũ (có hậu tố `_TYPE_A`…) và giá trị không đổi so với trước.

---

## 3. Trả lời hai câu hỏi §14 (17 và 18)

Hai câu này chưa thấy bạn báo lại. Chúng **chặn việc code `KtvTypeDDisciplineService`**, nên cần xử lý trước khi sang phase sau.

### Câu 17 — `LATE_NO_UPDATE` (−5h) còn dùng hay bỏ?

Ô `Đi trễ không cập nhật` ở dòng 193 vẫn còn. Nhưng luật đã chốt 02/09 xếp mọi tình huống "trễ" vào hai mốc:

```
trước 06:59  →  −5 giờ
từ 07:00     →  −10 giờ
```

Nên KTV đến trễ lúc 07:30 sẽ dính cả `ABSENT_NO_NOTICE` (−10h) lẫn `LATE_NO_UPDATE` (−5h) — **phạt hai lần cho một hành vi**.

Đây là câu hỏi cho chủ dự án, **đừng tự quyết**. Việc của bạn: nêu rõ tình huống chồng lấn này và hỏi. Trong lúc chờ, **đừng code phần trừ giờ cho trường hợp đi trễ**.

### Câu 18 — Luồng đăng ký lịch làm việc: đã có hay phải xây?

Luật phạt dựa trên khái niệm **"lịch đã đăng ký"** (KTV đăng ký ngày làm hôm sau trước 00:00). Không có đăng ký thì **không xác định được thế nào là "bỏ lịch"**, và `ABSENT_NO_NOTICE` không có căn cứ kích hoạt.

Plan hiện chưa có phần này: chưa có màn hình đăng ký, chưa có bảng lưu, chưa có mốc khoá 00:00.

**Việc của bạn — điều tra rồi báo lại, chưa code gì:**

1. Đọc `app/api/ktv/shift` và `app/api/ktv/leave`, xác định hai luồng này đang làm gì.
2. Có luồng nào cho KTV **đăng ký trước** ngày sẽ đi làm không, hay chỉ có xin nghỉ / đăng ký ca cố định?
3. Nếu tái dùng được thì cần sửa gì? Nếu phải xây mới thì cần bảng và API nào?
4. Nêu câu hỏi cho chủ dự án: **KTV không đăng ký gì cả thì tính là nghỉ có phép hay bỏ lịch?**

Báo cáo bằng phát hiện thật từ code, đừng suy đoán từ tên thư mục.

---

## Báo cáo cần có

1. Xác nhận đã sửa "trễ" → "trừ" ở cả dòng 178 và 185.
2. Bảng nghiệm thu UI ↔ key ↔ giá trị (mục 2), làm qua giao diện thật.
3. Kết quả kiểm tab A/B/C không đổi.
4. `SELECT key, value FROM "SystemConfigs" WHERE key ILIKE '%type_d%' ORDER BY key;` sau khi khôi phục.
5. Kết quả điều tra câu 18, và câu hỏi bạn đặt cho chủ dự án ở câu 17.
6. `npm run test:type-d` và `tsc --noEmit`.
7. Commit.

**Không làm Phase 6.** Xong 3 việc này thì Phase 5 khép lại.
