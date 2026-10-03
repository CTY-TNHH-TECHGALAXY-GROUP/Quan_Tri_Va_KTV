# Prompt — Sửa Phase 5

> Copy toàn bộ phần dưới gửi cho anti.

---

Phần giao diện làm tốt: tab D đã thêm, tách hẳn thành `KtvTypeDSettingsBlock` (đúng hướng b), `MilestonesEditor` nằm trong nhánh else nên tab D không hiện nó, tên key giữ nguyên `ktv_type_d_*` không bị chèn hậu tố. Đúng yêu cầu.

Nhưng có **3 việc phải sửa**, trong đó việc số 1 là gấp.

---

## V1 — GẤP: Giá trị thử còn nằm nguyên trên production ⛔

Script kiểm thử ghi giá trị giả vào `SystemConfigs` thật và **không khôi phục**. Tôi vừa truy vấn, đây là hiện trạng:

| Key | Đang là (sai) | Phải trả về |
|---|---|---|
| `ktv_type_d_vip_rate_per_60m` | 185000 | **180000** |
| `ktv_type_d_pt_rate_per_60m` | 105000 | **100000** |
| `ktv_type_d_bonus_points` | 25 | **20** |
| `ktv_bonus_rate_TYPE_D` | 1500 | **1000** |
| `ktv_deposit_amount_TYPE_D` | 1200000 | **1000000** |
| `ktv_type_d_internal_fund` | 260000 | **250000** |
| `ktv_type_d_reactivation_fee` | 1100000 | **1000000** |
| `ktv_type_d_rating_deduction` | `{"0":90,"1":90,"2":90,"3":90,"4":0}` | xem V2 |
| `ktv_type_d_discipline_rules` | `[{"lateMinutes":10,"deduction":40000}]` | **`{"ABSENT_NO_NOTICE":10,"ABSENT_EARLY_NOTICE":5,"LATE_NO_UPDATE":5,"ORDER_REJECT_MULTIPLIER":3}`** |

Riêng `ktv_type_d_discipline_rules` bị **sai cả cấu trúc**, không chỉ sai số. `KtvTypeDDisciplineService` đọc theo dạng đối tượng có 4 khoá tên loại vi phạm; giá trị hiện tại là mảng với hai trường `lateMinutes`/`deduction` — hoàn toàn khác. Bảng phạt giờ thật đã bị ghi đè mất.

**Yêu cầu:** khôi phục đủ bảng trên, rồi `SELECT` ra dán lại để xác nhận.

**Quy tắc từ giờ:** không ghi giá trị thử vào `SystemConfigs` production. Nếu buộc phải, thì đọc giá trị cũ ra trước, và khôi phục ngay trong cùng script bằng `try/finally` — không để phụ thuộc vào việc nhớ chạy tay.

---

## V2 — Giao diện và code tính tiền hiểu đơn vị khác nhau ⛔

Đây là lỗi nặng nhất, và nó không lộ ra khi nhìn màn hình.

```
KtvTypeDSettingsBlock.tsx:31   mặc định { "0":100, "1":100, "2":100, "3":100, "4":0 }
                               → giao diện nhập theo PHẦN TRĂM (0–100)

KtvTypeDCommissionService.ts:68   finalPay = totalPay * (1 - d)
                                  → code hiểu d là PHÂN SỐ (0–1)
```

Hệ quả với giá trị đang có trong DB (`"3": 90`): KTV 3★ nhận `basePay × (1 − 90)` = **âm 89 lần tiền gốc**. Một tua 105.000đ thành **âm 9.345.000đ**.

Chưa có KTV loại D nào chạy thật nên chưa thiệt hại, nhưng phải sửa trước khi bật.

**Chọn một, và chỉ một chỗ làm quy đổi:**

- **(a) Lưu phân số** `{"0":0,"1":0.75,"2":0.5,"3":0.25,"4":0}` — giao diện hiển thị phần trăm cho admin dễ nhập, nhưng chia 100 trước khi lưu và nhân 100 khi hiển thị. Service và bộ test giữ nguyên.
- **(b) Lưu phần trăm** — service phải chia 100 khi đọc, và phải sửa lại các assertion trong `simulate_type_d_commission.ts`.

Tôi nghiêng về **(a)**: plan §4 đã ghi định dạng lưu là phân số, service và 4 bộ test đã xây quanh đó. Đổi sang (b) là kéo theo sửa test.

Dù chọn hướng nào, **bắt buộc thêm một case test** cho tình huống này: rating 3★ phải cho ra đúng 75% tiền gốc. Hiện chưa có case nào bắt được lỗi lệch đơn vị.

---

## V3 — Nghiệm thu chạy sai cách, cần làm lại

Script đã chạy ghi thẳng vào DB rồi đọc ngược ra. Nó chứng minh Postgres lưu được chữ — nhưng **không chứng minh được nút Lưu trên giao diện hoạt động đúng**.

Cái tôi cần kiểm chính là phần giao diện: trang này có cơ chế tự ghép hậu tố `_${activeTab}` vào tên key (`page.tsx` dòng 88, 130, 136, 142). Script bỏ qua giao diện nên không chạm tới cơ chế đó. Nhìn code thì `KtvTypeDSettingsBlock` có vẻ đi đường riêng và không bị ghép hậu tố, nhưng **đó mới là suy luận từ đọc code, chưa phải kiểm chứng**.

**Yêu cầu:** làm lại nghiệm thu **qua giao diện thật**:

1. Mở trang Admin, vào tab D.
2. Sửa **từng ô một** trên màn hình, bấm nút Lưu của ô đó.
3. Sau mỗi lần lưu, `SELECT` từ `SystemConfigs` xác nhận **đúng tên key** và **đúng giá trị**.
4. Tải lại trang, xác nhận ô hiện đúng số vừa lưu.
5. Khôi phục lại giá trị chuẩn.

Ghi lại thành bảng: **tên ô trên UI ↔ key ghi vào DB ↔ giá trị**. Đây là thứ chứng minh giao diện đúng, không phải script.

Đồng thời kiểm tab A/B/C: mở từng tab, sửa một ô, lưu, xác nhận key ghi ra vẫn đúng khuôn cũ (có hậu tố `_TYPE_A` v.v.) và không có gì đổi so với trước.

---

## V4 — Nhãn "Phòng VIP" gây hiểu nhầm, và thiếu đơn vị /giờ

`KtvTypeDSettingsBlock.tsx` dòng 94:

```tsx
<NumberInput label="Rate VIP (Phòng VIP/NHT/NHP)" ... />
```

**Chữ "Phòng VIP" là sai.** Rate không phụ thuộc phòng, mà phụ thuộc **mã dịch vụ**. Tôi đã tra DB để xác nhận:

```
Mã dịch vụ :  NHP0001 … NHP0014, NHS0000     ← NHP/NHT/NHS là tiền tố DỊCH VỤ
Mã phòng   :  V1, V2, V3, V4, PG, T, YUMI…   ← phòng đặt tên hoàn toàn khác
```

Và code đang làm đúng — `KtvTypeDWalletService.ts:118` chọn rate theo mã dịch vụ, không đụng tới phòng:

```ts
return svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP');
```

Nên đây thuần tuý là **lỗi chữ trên màn hình**, không phải lỗi logic.

**Vì sao phải sửa:** admin đọc "Phòng VIP" sẽ hiểu là cứ làm trong phòng riêng thì được tính 180.000đ/giờ. Thực tế khách nằm phòng `V2` nhưng dùng dịch vụ phổ thông `NHS` thì hệ thống vẫn trả 100.000đ/giờ. Đến lúc KTV thắc mắc sẽ không ai giải thích được vì sao lệch.

**Yêu cầu sửa:**

| Dòng | Hiện tại | Đổi thành |
|---|---|---|
| 94 | `label="Rate VIP (Phòng VIP/NHT/NHP)"` | `label="Rate VIP — dịch vụ mã NHP / NHT / VIP"` |
| 95 | `label="Rate Phổ thông"` | `label="Rate Phổ thông — các dịch vụ còn lại (NHS…)"` |

**Và bổ sung đơn vị `/giờ` cho hai ô rate.** `NumberInput` dòng 221 đang mặc định `suffix = 'VNĐ'`, nên ô hiện "180.000 VNĐ" — mất thông tin đây là đơn giá theo giờ. Truyền `suffix="VNĐ/giờ"` cho hai ô rate ở dòng 94 và 95.

Không đổi `suffix` mặc định của `NumberInput`, vì các ô khác (quỹ nội bộ, tiền cọc, phí kích hoạt lại) là số tiền trọn gói, không phải đơn giá theo giờ.

Đây là sửa chữ hiển thị, không đụng logic — nhưng vẫn kiểm lại bằng cách mở tab D xem nhãn hiển thị đúng.

---

## Báo cáo cần có

1. `SELECT key, value FROM "SystemConfigs" WHERE key ILIKE '%type_d%' ORDER BY key;` sau khi khôi phục — dán nguyên kết quả.
2. Nêu rõ chọn hướng (a) hay (b) ở V2, và đã sửa ở file nào.
3. Bảng đối chiếu UI ↔ key ↔ giá trị của V3, làm qua giao diện thật.
4. Kết quả kiểm A/B/C không đổi.
5. `npm run test:type-d` và `tsc --noEmit`.
6. Commit sau khi xong.

Không làm Phase 6 trong lượt này.

---

Một nhận xét: bốn lỗi nặng nhất từ đầu dự án tới giờ — `segments` kiểu chuỗi, config `[object Object]`, NULL snapshot, và lần này là lệch đơn vị phần trăm — đều **không phải lỗi thuật toán**. Đều là **hai đầu code hiểu cùng một dữ liệu theo hai cách khác nhau**. Khi viết chỗ đọc và chỗ ghi cho cùng một giá trị, hãy kiểm tra tận nơi xem đầu kia đang mong đợi định dạng gì, đừng suy đoán từ tên biến.
