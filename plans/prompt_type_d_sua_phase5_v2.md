# Prompt — Sửa Phase 5 (đợt 2)

> Copy toàn bộ phần dưới gửi cho anti. Thay thế `prompt_type_d_sua_phase5.md` trước đó.

---

Đã kiểm tra lại. **Phần khôi phục config làm được một nửa:**

```
ktv_type_d_vip_rate_per_60m  = 180000  ✅ đúng
ktv_type_d_pt_rate_per_60m   = 100000  ✅ đúng
ktv_type_d_discipline_rules  = {"ABSENT_NO_NOTICE":10,"ABSENT_EARLY_NOTICE":5,
                                "LATE_NO_UPDATE":5,"ORDER_REJECT_MULTIPLIER":3}  ✅ đúng cấu trúc
```

Còn 5 việc. **Đọc lại §5.3 và §4 của plan trước khi làm — luật kỷ luật đã được chốt lại ngày 02/09.**

---

## V1 — Bảng khấu trừ sao vẫn sai, KTV sẽ mất trắng tiền ⛔ GẤP NHẤT

```
Đang là :  {"0":1, "1":1, "2":1, "3":1, "4":0}
Phải là :  {"0":0, "1":0.75, "2":0.5, "3":0.25, "4":0}
```

Code tính `finalPay = basePay × (1 - d)`. Với giá trị hiện tại:

| Sao | d hiện tại | KTV nhận | Đúng phải là |
|---|---|---|---|
| 4★ | 0 | 100% ✅ | 100% |
| 3★ | 1 | **0đ** ❌ | 75% |
| 2★ | 1 | **0đ** ❌ | 50% |
| 1★ | 1 | **0đ** ❌ | 25% |
| **0★ chưa chấm** | 1 | **0đ** ❌ | **100%** |

Dòng cuối là chỗ nguy hiểm nhất. Rủi ro R2 trong plan đã ghi: khách chấm sao **sau** khi đơn hoàn tất, nên lúc vừa DONE thì `rating = 0`. Với cấu hình hiện tại, **gần như mọi tua vừa xong đều trả 0đ**.

Có vẻ bạn quy đổi phần trăm sang phân số bằng cách lấy giá trị mặc định của giao diện (`100`) thành `1`. Nhưng **bản thân giá trị mặc định đó đã sai** so với plan.

**Yêu cầu:** sửa cả 3 nơi cho khớp nhau —
1. Giá trị trong `SystemConfigs`
2. Giá trị mặc định trong `KtvTypeDSettingsBlock.tsx` dòng 31
3. Script seed `scripts/insert_type_d_configs.js`

---

## V2 — Thống nhất đơn vị: PHÂN SỐ, không phải phần trăm

Xem cảnh báo mới trong §4 của plan.

```
Giao diện  : KtvTypeDSettingsBlock.tsx:31   mặc định 100  → hiểu là phần trăm
Code tính  : KtvTypeDCommissionService.ts   1 - d         → hiểu là phân số
```

**Chốt: lưu dạng phân số 0–1.** Plan §4 đã ghi định dạng này, service và 4 bộ test đã xây quanh nó.

Giao diện có thể cho admin nhập theo phần trăm cho dễ đọc, nhưng **chia 100 trước khi lưu** và **nhân 100 khi hiển thị**. Chỉ quy đổi ở **một chỗ duy nhất**, đừng rải rác.

**Bắt buộc thêm 2 case test** vào `simulate_type_d_commission.ts`:
- rating 3★ → phải ra đúng **75%** tiền gốc
- rating 0★ (chưa chấm) → phải ra đúng **100%** tiền gốc

Hiện chưa có case nào bắt được lỗi lệch đơn vị, đó là lý do nó lọt hai lần.

---

## V3 — Nhãn khối kỷ luật sai so với luật mới

Luật đã chốt lại (§5.3, cập nhật 02/09) — **phân định theo mốc 07:00**, không theo "có báo hay không":

```
Trước 00:00        →  KTV đăng ký ngày đi làm hôm sau
Trước 06:59        →  báo vắng hoặc trễ   →  −5 giờ
Từ 07:00 trở đi    →  bỏ lịch hoặc trễ    →  −10 giờ
```

Báo lúc 07:30 **vẫn là có báo**, nhưng vẫn chịu −10 giờ. Nhãn hiện tại hiểu sai chỗ này.

`KtvTypeDSettingsBlock.tsx` sửa như sau:

| Dòng | Hiện tại | Đổi thành |
|---|---|---|
| 185 | `Kỷ luật trễ giờ` | `Kỷ luật trừ giờ tích lũy` |
| 191 | `Nghỉ không thông báo` | `Bỏ lịch / báo trễ (từ 07:00)` |
| 192 | `Nghỉ có thông báo (trễ)` | `Báo vắng hoặc trễ (trước 06:59)` |
| 194 | `Hệ số từ chối đơn` + `suffix="Lần"` | `Từ chối tua đã gán (hệ số × thời lượng)` + `suffix="× giờ tua"` |

Về dòng 194: con số 3 **không phải số lần**, mà là hệ số nhân với thời lượng tua (tua 60p → −3h, tua 90p → −4,5h). Ghi "3 Lần" khiến admin hiểu là "được phép từ chối 3 lần" — nghĩa ngược hẳn.

Tiêu đề "Kỷ luật **trễ** giờ" là lỗi gõ của "**trừ** giờ". Khối này gồm cả nghỉ và từ chối tua, không riêng đi muộn.

**Giữ nguyên tên hằng số** `ABSENT_NO_NOTICE` / `ABSENT_EARLY_NOTICE` để khỏi phải sửa dữ liệu đang chạy — chỉ đổi nhãn hiển thị.

---

## V4 — Nhãn rate gây hiểu nhầm, thiếu đơn vị /giờ

`KtvTypeDSettingsBlock.tsx` dòng 94: `label="Rate VIP (Phòng VIP/NHT/NHP)"`

**Chữ "Phòng VIP" sai.** Rate phụ thuộc **mã dịch vụ**, không phụ thuộc phòng. Tôi đã tra DB:

```
Mã dịch vụ :  NHP0001 … NHP0014, NHS0000      ← NHP/NHT/NHS là tiền tố DỊCH VỤ
Mã phòng   :  V1, V2, V3, V4, PG, T, YUMI…    ← phòng đặt tên khác hẳn
```

Code đang làm đúng (`KtvTypeDWalletService.ts:118` chọn theo `svcId.startsWith('NHP')`), chỉ chữ trên màn hình sai. Nhưng admin đọc "Phòng VIP" sẽ tưởng cứ làm phòng riêng là được 180.000đ/giờ — trong khi khách nằm phòng `V2` mà dùng dịch vụ `NHS` thì vẫn chỉ 100.000đ/giờ.

| Dòng | Hiện tại | Đổi thành |
|---|---|---|
| 94 | `Rate VIP (Phòng VIP/NHT/NHP)` | `Rate VIP — dịch vụ mã NHP / NHT / VIP` |
| 95 | `Rate Phổ thông` | `Rate Phổ thông — các dịch vụ còn lại (NHS…)` |

Và truyền `suffix="VNĐ/giờ"` cho **riêng hai ô này**. `NumberInput` dòng 221 mặc định `suffix='VNĐ'` nên ô hiện "180.000 VNĐ", mất thông tin đây là đơn giá theo giờ. **Đừng đổi mặc định của `NumberInput`** — các ô khác (quỹ nội bộ, tiền cọc, phí kích hoạt lại) là tiền trọn gói.

---

## V5 — Nghiệm thu phải làm qua GIAO DIỆN, không phải script

Script lần trước ghi thẳng vào DB rồi đọc ngược ra. Nó chứng minh Postgres lưu được chữ, **không** chứng minh nút Lưu trên màn hình hoạt động đúng.

Trang này có cơ chế tự ghép hậu tố `_${activeTab}` vào tên key (`page.tsx` dòng 88, 130, 136, 142). Script bỏ qua giao diện nên không chạm tới cơ chế đó. Nhìn code thì `KtvTypeDSettingsBlock` có vẻ đi đường riêng, nhưng đó mới là suy luận, chưa phải kiểm chứng.

**Làm lại qua màn hình thật:**
1. Mở Admin, vào tab D
2. Sửa **từng ô một**, bấm Lưu
3. Sau mỗi lần lưu, `SELECT` từ `SystemConfigs` xác nhận **đúng tên key** và **đúng giá trị**
4. Tải lại trang, xác nhận ô hiện đúng số vừa lưu
5. **Khôi phục giá trị chuẩn** — và lần này khôi phục thật, kiểm tra lại bằng `SELECT`

Ghi thành bảng: **tên ô trên UI ↔ key trong DB ↔ giá trị**.

Kiểm luôn tab A/B/C: mở từng tab, sửa một ô, lưu, xác nhận key ghi ra vẫn đúng khuôn cũ (có hậu tố `_TYPE_A`…) và không đổi gì so với trước.

---

## Hai câu phải hỏi chủ dự án trước khi code `KtvTypeDDisciplineService`

Đã ghi thành §14 câu 17 và 18 trong plan. **Đừng tự quyết:**

1. **`LATE_NO_UPDATE` (−5h) còn dùng hay bỏ?** Luật mới xếp mọi tình huống "trễ" vào hai mốc 06:59 / 07:00, nên ô này chồng lấn — KTV đến trễ 07:30 sẽ dính cả −10h lẫn −5h, phạt hai lần cho một hành vi.

2. **Luồng đăng ký lịch làm việc đã có chưa?** Luật phạt dựa trên "lịch đã đăng ký" (đăng ký trước 00:00 cho hôm sau), nhưng plan chưa có phần này — chưa có màn hình, chưa có bảng lưu, chưa có mốc khoá. Không có đăng ký thì **không định nghĩa được thế nào là "bỏ lịch"**. Kiểm `app/api/ktv/shift` và `app/api/ktv/leave` xem tái dùng được không, rồi báo lại. Kèm câu hỏi: KTV không đăng ký gì thì tính nghỉ có phép hay bỏ lịch?

---

## Báo cáo cần có

1. `SELECT key, value FROM "SystemConfigs" WHERE key ILIKE '%type_d%' ORDER BY key;` sau khi sửa — dán nguyên kết quả.
2. Bảng đối chiếu UI ↔ key ↔ giá trị của V5, làm qua giao diện thật.
3. Kết quả kiểm A/B/C không đổi.
4. `npm run test:type-d` (gồm 2 case mới ở V2) và `tsc --noEmit`.
5. Trả lời 2 câu hỏi trên — hoặc nêu rõ đang chờ chủ dự án.
6. Commit sau khi xong.

**Không làm Phase 6.**
