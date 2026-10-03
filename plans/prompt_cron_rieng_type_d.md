# Prompt — Tách cron chốt sổ riêng cho KTV Loại D

> Copy toàn bộ phần dưới gửi cho anti.
> Nối tiếp `plans/plan_sua_luong_thuong_type_d.md`. Đợt 3 (A4) đã xong và đã kiểm chứng.

---

## 0. Yêu cầu của chủ dự án

Loại D phải có **cron chốt sổ riêng**, không đi chung đường với Loại A/B/C nữa. Lý do nghiệp vụ:
Loại D có **thuế TNCN 10%**, có **trừ theo sao**, và **bonus gộp chung vào thu nhập** — khác hẳn
các loại còn lại. Nhánh `if (work_type === 'TYPE_D')` nhét trong cron chung là giải pháp tạm,
giờ tách hẳn.

## 1. Hiện trạng đã kiểm trên DB thật

### 1.1 Bảng `KTVDailyLedger` ĐÃ CÓ cột phân biệt loại — nhưng cron KHÔNG ghi

Cột hiện có:
```
id · date · staff_id · total_commission · total_tip · total_bonus · total_penalty
total_adjustment · total_withdrawn · commission_breakdown
work_type_snapshot   ← CÓ SẴN, đang NULL 100%
rating_deduction     ← CÓ SẴN, đang 0 hết
created_at · updated_at
```

Kiểm 300 dòng gần nhất: `work_type_snapshot` có giá trị **0/300 dòng**. Cron chỉ ghi
`commission_breakdown`, bỏ trống hai cột kia (`route.ts:304-315`).

**Hậu quả:** nhìn một dòng ledger không biết nó được tính bằng luật nào. Với dữ liệu lương thì
đây là thiếu sót nghiêm trọng — không truy vết được, không kiểm toán được, và chính là lý do
đợt vừa rồi phải viết script audit riêng mới biết số nào sai.

### 1.2 Chênh lệch chưa giải thích được

```
02/09  T016 (Loại D)   ledger comm = 225.000 đ
                       audit Đợt 1 "đúng luật" =  25.000 đ
```
Gấp 9 lần. Một trong hai sai — hoặc script audit, hoặc nhánh cron mới. **Phải làm rõ trước khi
tách cron**, nếu không sẽ bê nguyên cái sai sang cron mới.

Ngoài ra `01/09 NH079` vẫn là `100.000` chưa về `99.023` như dự kiến → cron chưa chạy lại cho
ngày 01/09 dù ngày này nằm trong mốc áp dụng.

## 2. VIỆC CẦN LÀM

### Bước 1 — Làm rõ chênh lệch T016 (làm TRƯỚC, đừng bỏ qua)

Truy đơn của T016 ngày 02/09: bao nhiêu item, serviceId gì, `segments` ra sao, rating bao nhiêu.
Tính tay ra con số, rồi nói rõ **225.000 hay 25.000 mới đúng** và vì sao. Không được đoán.

### Bước 2 — Ghi đủ metadata vào ledger

Trong mọi đường ghi `KTVDailyLedger`, bổ sung:
- `work_type_snapshot`: loại KTV **tại thời điểm chốt sổ** (không phải loại hiện tại — KTV có thể
  đổi loại về sau, dòng cũ phải giữ nguyên luật đã áp).
- `rating_deduction`: tỉ lệ trừ theo sao đã áp (0 / 0.25 / 0.5 / 0.75).

### Bước 3 — Tách cron riêng

Tạo `app/api/cron/sync-daily-ledger-type-d/route.ts`, **chỉ xử lý `work_type = 'TYPE_D'`**.

Ràng buộc bắt buộc:
1. **Cron chung phải LOẠI HẲN Loại D** — lọc ngay ở query `Staff` (`.neq('work_type','TYPE_D')`),
   không dùng `continue` giữa vòng lặp như hiện tại. Hai cron không được cùng đụng một dòng.
2. **Chống ghi đè chéo**: trước khi upsert, nếu dòng đã tồn tại và có `work_type_snapshot` khác
   loại mình xử lý → **bỏ qua + ghi log**, không ghi đè.
3. Giữ nguyên rào `TYPE_D_RULE_EFFECTIVE_FROM = '2026-09-01'` (Option B — ngày trước mốc không đụng).
4. Vẫn **gọi lại** `KtvTypeDCommissionService` / `KtvTypeDBonusService`, không sao chép công thức.
5. Đăng ký cron mới trong `vercel.json` (hoặc nơi cấu hình lịch chạy). **Kiểm tra kỹ**: tách 2 cron
   nghĩa là có 2 thứ phải chạy — quên đăng ký cái mới thì Loại D mất trắng dữ liệu chốt sổ,
   mà lỗi này im lặng, không ai biết cho tới khi KTV kêu.

### Bước 4 — Thuế: LƯU hay TÍNH LẠI? (đọc kỹ, dễ trừ thuế hai lần)

Hiện `total_tax_deducted` được **tính lại mỗi lần mở ví**, không lưu trong ledger.

**Đề xuất — chọn phương án này trừ khi chủ dự án nói khác:**
- Ledger lưu **số GỘP (trước thuế)** như hiện tại: `total_commission`, `total_bonus` (ĐIỂM).
- Thêm cột `total_tax` **chỉ để lưu vết đối chiếu**, không ai trừ dựa trên nó.
- Ví vẫn là **nơi duy nhất** thực hiện phép trừ 10%, đúng như đang chạy.

⚠️ **Tuyệt đối không** lưu số đã trừ thuế vào `total_commission` rồi để ví trừ tiếp — KTV sẽ bị
**trừ thuế hai lần**. Nếu đổi sang lưu số sau thuế thì phải bỏ phép trừ trong
`KtvTypeDWalletService` cùng lúc, trong cùng một lần sửa, không tách ra hai đợt.

Nếu thêm cột: viết migration UTF-8, đặt tên `20260903xxxxxx_add_total_tax_to_ledger.sql`,
và nhớ `SystemConfigs.value` là jsonb (chuỗi phải bọc nháy kép).

## 3. TIÊU CHÍ NGHIỆM THU

1. Chạy cron chung → **không** tạo/sửa bất kỳ dòng nào của KTV Loại D.
2. Chạy cron D → chỉ đụng dòng Loại D, mọi dòng đều có `work_type_snapshot = 'TYPE_D'` và
   `rating_deduction` đúng với số sao thật của đơn.
3. Chạy **cả hai cron hai lần liên tiếp** → kết quả không đổi (idempotent), không nhân đôi số.
4. Bảng đối chiếu 3 nguồn (ví · ledger · lịch sử) vẫn khớp như báo cáo Đợt 3.
5. Giải thích xong chênh lệch T016 ở Bước 1.
6. Ngày trước `2026-09-01` không đổi một đồng nào.

## 4. BẮT BUỘC TRƯỚC KHI BÁO XONG

1. **`rm -rf .next && npm run build`** — dán output nguyên văn.
   Lưu ý: kiểm tra thấy **không có `.next/BUILD_ID`**, nghĩa là `next build` **chưa từng chạy
   thành công** dù báo cáo trước nói đã chạy. Lần này phải chạy thật và dán kết quả thật.
2. `npx tsc --noEmit`.
3. Trả lời Bước 1: **225.000 hay 25.000 đúng?**
4. Dán ảnh/nội dung 1 dòng ledger Loại D sau khi chạy, cho thấy `work_type_snapshot` và
   `rating_deduction` đã có giá trị.
5. Xác nhận đã đăng ký cron mới vào lịch chạy, kèm nội dung file cấu hình.
6. Nói rõ mục nào **chưa test được**.

## 5. KHÔNG ĐƯỢC LÀM

- Không tính lại ledger trước `2026-09-01`.
- Không sửa `app/api/ktv/history/*`, `app/ktv/history/*` (chủ dự án đang giữ) mà không báo trước.
- Không viết công thức mới — gọi lại service có sẵn.
- Không đổi quy ước `total_bonus` lưu **ĐIỂM**.
