# Prompt mở Phase 3 — API Routes

> Copy toàn bộ phần dưới gửi cho anti.

---

Đã kiểm tra lại bằng cách chạy độc lập `npm run test:type-d`. **Đạt hết.** Cả 4 script giờ import service thật, không còn class sao chép, file `.mjs`/`.js` cũ đã xoá, `tsc --noEmit` sạch, `KTVServiceHoursLedger` sạch 0 dòng.

Tôi soát lại số học từng case cũng đúng — đặc biệt Case 5 (`segments` kiểu chuỗi JSON + `ktvId` chữ thường → 150.000đ) là case quan trọng nhất, vì nó phủ đúng hai thứ từng làm hỏng và giờ chạy qua code thật.

**Mở Phase 3.** Trước khi bắt đầu, commit nốt 16 file đang treo (có cả các file plan vừa cập nhật) để có mốc sạch phòng khi phải quay lui.

---

## Phạm vi Phase 3

Chỉ làm **API Routes** theo §6 của plan. **KHÔNG** làm Phase 4 (sửa `.eq()` cứng của phí giặt đồ/bảo trì), **KHÔNG** làm UI.

### Routes sửa

| Route | Việc |
|---|---|
| `POST /api/ktv/attendance` | CHECK_IN: có trừ phí giặt đồ. Nghỉ đột xuất: gọi `KtvTypeDDisciplineService.deductHours()` **thay cho** phạt tiền |
| `GET /api/ktv/wallet/balance` | Nhánh TYPE_D → `KtvTypeDCommissionService`, lọc `work_type_snapshot = 'TYPE_D'` |
| `GET /api/ktv/wallet/bonus/balance` | Nhánh TYPE_D → `KtvTypeDBonusService`, lọc `work_type_snapshot = 'TYPE_D'` |
| `GET /api/ktv/wallet/timeline` | Cũng đọc `KTVDailyLedger` → cũng phải lọc snapshot |
| `GET /api/ktv/wallet/bonus/timeline` | Như trên |
| `POST /api/ktv/wallet/withdraw` | TYPE_D + cờ `withdraw_morning_only` + giờ VN > 12:00 → từ chối, kèm thông báo rõ ràng |
| `GET /api/turns` | TYPE_D sort `monthly_hours` DESC (JOIN lúc đọc, §2.4) |
| `POST /api/finance/adjustment` | Hỗ trợ `wallet_type: 'HOURS'`; luôn stamp `work_type_snapshot` |
| `GET /api/finance/ktv-summary` | Thêm cột giờ tích lũy, rating deduction, quỹ nội bộ cho TYPE_D |

### Routes mới

- `GET /api/ktv/type-d/service-hours` — tổng giờ tích lũy + lịch sử phạt trong tháng
- `POST /api/cron/reset-type-d-hours` — **chỉ chốt sổ** vào `KTVMonthlyServiceHours`. Không cần reset gì: query §2.4 đã lọc theo tháng nên sang tháng mới tổng tự về 0. Bảo vệ bằng `CRON_SECRET` như các cron khác, và khai báo trong `vercel.json`.

---

## Năm điều dễ làm sai ở phase này

**1. Logic ví KHÔNG nằm ở route.** `app/api/ktv/wallet/balance/route.ts` chỉ 31 dòng, gọi thẳng `lib/services/KtvWalletService.ts`. Sửa route là sửa nhầm chỗ — phải sửa trong service.

**2. `getBalance()` tính theo mô hình LAI — phải phủ cả hai đường.**
- Phần quá khứ: đọc từ `KTVDailyLedger` (có `work_type_snapshot`)
- Phần từ ngày cuối có ledger đến hiện tại: **tính lại trực tiếp từ `Bookings`** bằng `work_type` hiện tại

Nếu chỉ thêm nhánh TYPE_D cho đường ledger mà quên đường realtime, số dư hôm nay sẽ sai. Đây là bẫy đã ghi ở §2.2.

**3. Stamp `work_type_snapshot` ở MỌI nơi tạo bút toán.** Viết một helper `getWorkTypeSnapshot(supabase, staffId)` rồi dùng thống nhất. Quên một chỗ thì bản ghi đó `NULL` → rơi về TYPE_A → KTV mất tiền, và rất khó truy (rủi ro R4).

**4. Lấy rate đúng key: `ktv_type_d_vip_rate_per_60m` / `ktv_type_d_pt_rate_per_60m`** (180000 / 100000). Hai key `_per_min` đã xoá khỏi DB nên không còn nguy cơ lấy nhầm, nhưng đừng tự thêm lại. Nhớ chia 60 khi tính — chữ ký hàm là `ratePer60m`.

**5. Không được làm hỏng A/B/C.** Mọi thay đổi phải nằm trong nhánh `if (workType === 'TYPE_D')`. Đường đi của A/B/C phải giữ nguyên byte-for-byte.

---

## Nghiệm thu

1. **Đối chiếu số tiền qua 2 đường độc lập.** Gọi thật `GET /api/ktv/wallet/balance?techCode=T001`, so với kết quả tính từ `KtvTypeDCommissionService` trong script mô phỏng trên cùng bộ dữ liệu. Hai bên phải khớp. Đây là nghiệm thu quan trọng nhất — nó chứng minh service đã được nối đúng vào route.

2. **Kiểm A/B/C không đổi.** Gọi `wallet/balance` cho một KTV TYPE_A và một TYPE_B, **trước và sau** khi sửa. Số phải giống hệt.

3. **Test chặn rút tiền**: gọi `withdraw` cho KTV TYPE_D sau 12:00 giờ VN → phải bị từ chối; trước 12:00 → phải qua.

4. `npm run test:type-d` vẫn xanh, `tsc --noEmit` vẫn sạch.

5. Nếu có ghi dữ liệu test vào DB thì dọn sạch sau khi xong, và dán câu `SELECT` chứng minh.

---

## Báo cáo cần có

- Output `curl` của các route đã sửa, kèm số tiền thật.
- Bảng đối chiếu số tiền route ↔ script mô phỏng (nghiệm thu 1).
- Bảng đối chiếu A/B/C trước/sau (nghiệm thu 2).
- Output `npm run test:type-d` và `tsc --noEmit`.

Gặp chỗ nào trong plan mâu thuẫn hoặc không khớp code thực tế thì **dừng lại hỏi**, đừng tự đoán. Ba lần trước lỗi đều đến từ chỗ tự quyết mà không hỏi.

**Không làm Phase 4 hay UI trong lượt này.**
