# Prompt — Phase 5: Admin UI tab "Loại D"

> Copy toàn bộ phần dưới gửi cho anti.

---

Đợt tách A/B/C đã nghiệm thu, tôi kiểm chứng độc lập và đạt hết:

- Helper trả nguyên truy vấn cho A/B/C ✅
- `KtvWalletService.ts` gọn từ 401 → 201 dòng, `KtvTypeDWalletService.ts` tách riêng ✅
- `getTypeDBalance` cũ dọn sạch, còn 0 chỗ ✅
- `tsc --noEmit` sạch, `npm run test:type-d` xanh ✅
- Số tiền A/B/C khớp từng đồng với baseline (5 KTV, cả bonus lẫn tiền tua) ✅

Đây là lần đầu một đợt qua nghiệm thu ngay lần đầu, không phải làm lại. Tốt.

Commit nốt 4 file đang treo (đều là xoá file rác: `check_db.js`, `force_fix_tsc.js`, `force_fix_tsc_2.js`, `scratch_check_nh011_today.ts`) rồi bắt đầu Phase 5.

---

## Bỏ qua Phase 4

Đã kiểm tra `SystemConfigs`: mức phí global đang dùng là **giặt đồ 20.000 / bảo trì 50.000**, đúng bằng mức plan muốn cho TYPE_D. Sửa code dùng chung của 145 nhân viên để ra đúng con số đang có là rủi ro không đổi lấy gì.

TYPE_D dùng chung mức global, **không sửa dòng nào**. Chỉ làm Phase 4 khi doanh nghiệp thực sự muốn TYPE_D đóng phí khác. (Plan §14 câu 14 sẽ được cập nhật lại theo hướng này.)

---

## Phạm vi Phase 5

Thêm tab **"Loại D"** vào `app/admin/settings/system/page.tsx`. Chỉ Admin UI, không đụng logic tính tiền.

### Cấu trúc hiện có

```
page.tsx (553 dòng)
  dòng  56  activeTab: 'TYPE_A' | 'TYPE_B' | 'TYPE_C'
  dòng 161  thanh tab, map qua 3 loại
  dòng 545  <MilestonesEditor activeTab={activeTab} />
  dòng 549  <KtvFeaturesTable activeTab={activeTab} />
```

---

## ⚠️ Bẫy lớn nhất của phase này: hai kiểu đặt tên key không khớp nhau

Trang này **tự động ghép hậu tố** `_${activeTab}` vào key khi đọc và lưu (dòng 88, 130, 136, 142):

```ts
const actualKey = `${k}_${activeTab}`;   // ktv_deposit_amount + _TYPE_D
```

Nhưng các key của TYPE_D đang nằm trong DB theo **hai kiểu khác nhau**:

**Nhóm hợp với cơ chế tự ghép (3 key)** — thêm tab là chạy được ngay:
```
ktv_deposit_amount_TYPE_D
enable_ktv_bonus_TYPE_D
ktv_bonus_rate_TYPE_D
```

**Nhóm KHÔNG hợp (8 key)** — tiền tố `ktv_type_d_`, không có hậu tố:
```
ktv_type_d_vip_rate_per_60m
ktv_type_d_pt_rate_per_60m
ktv_type_d_rating_deduction
ktv_type_d_discipline_rules
ktv_type_d_bonus_points
ktv_type_d_internal_fund
ktv_type_d_internal_fund_enabled
ktv_type_d_reactivation_fee
```

Nếu cứ thế thêm tab, 8 key này sẽ bị biến thành `ktv_type_d_vip_rate_per_60m_TYPE_D` — **key không tồn tại**. Hậu quả: ô input hiện trống, bấm lưu thì tạo ra key rác, còn giá trị thật không bao giờ được đọc hay ghi. **Không có thông báo lỗi nào.**

Đây đúng kiểu lỗi đã xảy ra ba lần rồi (sai tên cờ, `[object Object]`, NULL snapshot): chạy trót lọt nhưng không có tác dụng.

**Chọn một hướng, nêu rõ hướng nào trước khi làm:**

- **(a)** Đổi tên 8 key trong DB về đúng khuôn hậu tố, ví dụ `ktv_vip_rate_per_60m_TYPE_D`. Dùng lại được toàn bộ cơ chế sẵn có, nhưng phải sửa cả nơi đọc trong service TYPE_D và script seed.
- **(b)** Giữ tên hiện tại, viết riêng phần đọc/ghi cho tab D, bỏ qua cơ chế tự ghép hậu tố. Không đụng service, nhưng UI có nhánh riêng.

Tôi nghiêng về **(b)** — đúng tinh thần "D tách riêng", và không phải sửa dữ liệu đang chạy. Nhưng cứ nêu ý của bạn.

---

## Nội dung tab D

Theo §7 của plan:

| Mục | Nội dung |
|---|---|
| **Khung giá tua** | **KHÔNG dùng `MilestonesEditor`.** Chỉ 2 ô số: Rate VIP (đ/giờ, mặc định 180.000) và Rate Phổ thông (đ/giờ, mặc định 100.000) |
| **Khấu trừ theo sao** | Bảng 5 dòng: 0★, 1★, 2★, 3★, 4★ — nhập phần trăm khấu trừ. **TYPE_D dùng thang 4 sao, không có 5★** |
| **Bonus** | Điểm cơ bản mỗi tua (20), tỷ lệ quy đổi điểm→VNĐ (1.000), công tắc bật/tắt |
| **Kỷ luật** | 4 dòng mức trừ giờ, nhập số |
| **Phí & Quỹ** | Quỹ nội bộ (250.000 + công tắc), phí kích hoạt lại (1.000.000), tiền cọc ví (1.000.000) |

Ghi chú: phí giặt đồ và phí bảo trì **không hiện ở tab D** vì đang dùng chung mức global (xem phần bỏ Phase 4). Nếu muốn hiện thì để dạng chỉ đọc kèm chú thích "dùng mức chung".

---

## Bốn điều không được làm sai

1. **`MilestonesEditor` phải ẩn khi ở tab D.** TYPE_D không dùng milestones. Nếu để hiện, admin sẽ sửa nhầm và tưởng nó có tác dụng.
2. **Đừng đụng đường đi của A/B/C.** Mở tab A, B, C phải hiện đúng như trước, lưu đúng như trước.
3. **`activeTab` đang khai báo kiểu union ở dòng 56** — thêm `'TYPE_D'` vào đó, `tsc` sẽ chỉ ra mọi chỗ còn thiếu nhánh. Dùng danh sách lỗi đó làm bản đồ, đừng bỏ sót chỗ nào.
4. **Không sửa logic tính tiền trong phase này.** Chỉ làm màn hình.

---

## Nghiệm thu

1. **Vòng lặp lưu–đọc lại**: vào tab D, sửa **từng ô một**, bấm lưu, `SELECT` ra khỏi `SystemConfigs` xác nhận đúng key đúng giá trị, rồi tải lại trang xác nhận hiện đúng số vừa lưu. Làm đủ mọi ô, không làm mẫu vài ô.

   Đây là nghiệm thu quan trọng nhất — nó bắt đúng cái bẫy đặt tên key ở trên.

2. **A/B/C không đổi**: mở lần lượt 3 tab cũ, đối chiếu giá trị hiển thị với `SystemConfigs`. Thử lưu một ô rồi kiểm tra key ghi ra vẫn đúng khuôn cũ.

3. `tsc --noEmit` sạch, `npm run test:type-d` xanh.

4. Dán ảnh chụp hoặc mô tả tab D sau khi hoàn thành.

---

## Báo cáo cần có

- Nêu rõ chọn hướng (a) hay (b) cho vụ đặt tên key, và vì sao.
- Bảng đối chiếu: tên ô trên UI ↔ key trong `SystemConfigs` ↔ giá trị sau khi lưu.
- Kết quả kiểm A/B/C không đổi.
- Commit sau khi nghiệm thu xong.

Gặp chỗ nào không khớp plan thì dừng hỏi, đừng tự quyết.
