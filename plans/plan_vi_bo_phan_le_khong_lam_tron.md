# Plan — Ví: bỏ phần lẻ, KHÔNG làm tròn (và dẹp chênh lệch 1,28đ giữa hai con số)

> **Mức 2** — chạm ví/tiền (`app/api/ktv/wallet/timeline/route.ts`, `app/ktv/wallet/page.tsx`, `app/finance/ktv/page.tsx`).
> **Trạng thái**: ⏳ Chờ duyệt · **Ngày**: 12/09/2026 · **Nhánh**: `feat/bit-lo-hong-phase1`

---

## 1. Hiện tượng

Ảnh user gửi (tài khoản **T016**):

| Chỗ hiện | Đang hiện | Vấn đề |
|---|---|---|
| Số dư khả dụng | `86,971.719đ` | lòi phần lẻ `.719` |
| Số dư hiện tại | `1,086,971.719đ` | lòi phần lẻ `.719` |
| Số dư dưới dòng timeline | `1,086,973đ` | **đã làm tròn**, và **lệch 1,28đ** so với ô trên |

Hai con số tiền trên **cùng một màn** không bằng nhau.

## 2. Nguyên nhân gốc rễ — hai lỗi chồng nhau

**(a) Hai đường cộng tiền khác nhau.**
- Ô số dư lớn: `KtvWalletService.getBalance` cộng **số thật chưa làm tròn** của sổ cái.
- Dòng timeline: `timeline/route.ts` làm tròn **TỪNG DÒNG** trước khi cộng —
  `amount: Math.round(tienTua)` (dòng 281), `-Math.round(g.tax_amount)` (dòng 294),
  `Math.round(g.tip)` (dòng 305). `attachRunningBalance` cộng các số đã tròn đó.

Tổng của các số đã làm tròn **≠** số thật. Đo trên toàn sổ cái:

| KTV | Tổng ròng THẬT | Tổng cộng từng dòng ĐÃ TRÒN | Lệch |
|---|---|---|---|
| **T016** | 206.971,719 | 206.973 | **+1,281** |
| T007 | 491.496,550 | 491.496 | −0,550 |
| NH079 | 89.120,975 | 89.121 | +0,025 |
| T001 / T069 / T079 | tròn sẵn | — | 0 |

**(b) Không chỗ nào cắt phần lẻ khi hiển thị.** `app/ktv/wallet/page.tsx` dùng
`Number(x).toLocaleString()` — **không tham số locale**, nên vừa lòi 3 chữ số thập
phân vừa lấy dấu phân cách của máy (`86,971.719` kiểu Mỹ) thay vì kiểu Việt
(`86.971`). Màn `app/finance/ktv/page.tsx` bên quản lý y hệt.

Phần lẻ sinh ra là **đúng nghiệp vụ**, không phải rác: tiền tua = phút × đơn
giá/60 và thuế 10% đều ra số lẻ. Không được sửa công thức để ép tròn.

## 3. Đề xuất (một phương án)

**Giữ số thật trong mọi phép cộng, chỉ CẮT phần lẻ ở tầng hiển thị.**

| # | File | Thay đổi |
|---|---|---|
| 1 | `lib/format.logic.ts` | Thêm `formatVnd(n)` = `Math.trunc(n)` rồi `toLocaleString('vi-VN')` + `đ`. **Cắt, không làm tròn** — đúng ý user, và không bao giờ hiện nhiều hơn số KTV thật sự có. |
| 2 | `app/api/ktv/wallet/timeline/route.ts` | Bỏ `Math.round` ở 3 chỗ (`tienTua`, `tax_amount`, `tip`) — trả số thật. `attachRunningBalance` khi đó cộng số thật, khớp tuyệt đối với ô số dư lớn. |
| 3 | `app/ktv/wallet/page.tsx` | Mọi số tiền dùng `formatVnd`: số dư khả dụng, số dư hiện tại, đang chờ duyệt, số tiền từng dòng, số dư luỹ kế. |
| 4 | `app/finance/ktv/page.tsx` | Cùng `formatVnd` cho cột số dư / hoa hồng / rút — để hai phía đọc ra **cùng một con số**. |

Không đụng công thức tiền, không đụng sổ cái, không đụng `getBalance`. Chỉ bỏ
việc làm tròn sớm ở API timeline và thống nhất cách hiển thị.

**Riêng ô "Ví Điểm"** (`điểm`, không phải `đ`) giữ nguyên cách hiện — điểm vốn là
số nguyên.

## 4. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Ví (`/api/ktv/wallet/timeline`, `/balance`) | `finance/ktv` (`/api/finance/ktv-summary`) | `lib/format.logic.ts` | Sửa **cả hai phía** |
| Số tiền hiển thị | số dư lớn ↔ số dư dưới dòng đang lệch 1,28đ | cũng lòi phần lẻ (`toLocaleString()` trần) | `KtvWalletService.getBalance` | Sau khi sửa: **khớp** |
| Công thức tính | không đổi | không đổi | `KtvDLedgerEngine` | **Không ảnh hưởng — vì chỉ sửa tầng hiển thị** |
| Lệnh rút tiền | `maxAmount` lấy từ `available_balance` | quầy duyệt theo cùng số | `/api/ktv/wallet/withdraw` | **Cần xác nhận** — xem mục 6 |
| Màn Lịch Sử | đã làm tròn từng đơn ở tầng hiển thị (`Math.round(led...)`) | — | — | Không đụng lần này — khác sổ, từng đơn chứ không cộng dồn |
| Quyền xem | KTV chỉ thấy ví mình | quản lý thấy mọi KTV | — | Không đổi |

## 5. Kiểm chứng trước khi apply (mục 10 + 4.3)

1. **T016**: ô số dư lớn và số dư ở dòng mới nhất phải **bằng nhau**, cùng ra
   `1.086.971đ` (cắt `.719`), không còn `1.086.973đ`.
2. Chạy lại đối chiếu cho cả 6 KTV có dữ liệu — kỳ vọng **0 lệch**.
3. Số âm phải cắt về phía 0, không về phía âm sâu hơn (`Math.trunc(-0,5)` = `-0`,
   không phải `-1`) — kiểm riêng dòng trừ tiền, phạt, rút tiền.
4. Đối chiếu 2 phía (mục 4.3): cùng KTV, số dư trên Ví = số dư ở `finance/ktv`.
5. Kiểm dấu phân cách ra kiểu Việt (`1.086.971đ`) ở cả hai màn.

## 6. Cần chốt trước khi làm

**Lệnh rút tiền lấy trần bằng `available_balance` (số thật, có phần lẻ).** KTV
nhìn thấy `86.971đ` mà hệ thống cho rút tối đa `86.971,719đ`. Đề xuất: **cắt luôn
phần lẻ ở trần rút** cho khớp cái KTV nhìn thấy. Đây là chỗ duy nhất trong plan
đụng vào số tiền thật chứ không chỉ hiển thị — cần user gật trước.

## 7. Rủi ro

- Số dư hiện ra sẽ **nhỏ hơn tối đa 1đ** so với hôm nay ở vài tài khoản (T016 đang
  hiện thừa 1,28đ). Đúng hướng, nhưng là số đi xuống nên nên báo trước.
- Dấu phân cách đổi từ `,` sang `.` (chuẩn Việt) — thay đổi nhìn thấy được, tuy
  phần còn lại của app đã dùng kiểu Việt sẵn.

---

## 8. Kết quả thực hiện (12/09/2026)

User chốt: **cắt luôn phần lẻ ở trần rút**.

**Code** — 5 file:
- `lib/format.logic.ts`: thêm `formatVnd(n)` — `Math.trunc` rồi `toLocaleString('vi-VN')` + `đ`.
  `|| 0` để `Math.trunc(-0,5)` (= −0) không hiện ra `-0đ`.
- `app/api/ktv/wallet/timeline/route.ts`: bỏ `Math.round` ở 3 chỗ (`tienTua`,
  `tax_amount`, `tip`) → `attachRunningBalance` cộng số thật.
- `app/ktv/wallet/page.tsx`: 10 chỗ hiện tiền dùng `formatVnd`; trần rút
  `Math.trunc`.
- `app/api/ktv/wallet/withdraw/route.ts`: `availableBalance` cắt phần lẻ (cổng
  thật, không tin client), câu báo lỗi cũng dùng `formatVnd`.
- `app/finance/ktv/page.tsx`: 12 chỗ hiện tiền dùng `formatVnd` — hai phía đọc ra
  cùng một con số.

**Lệch so với plan:**
1. **Ô NHẬP tiền rút giữ nguyên định dạng en-US.** Plan định đổi hết sang kiểu
   Việt, nhưng chuỗi trong ô đó được parse lại bằng `replace(/,/g,'')` — đổi sang
   dấu chấm là `Number("86.971")` ra **86,971đ**. Chỉ đổi chỗ HIỂN THỊ, không đổi
   chỗ nhập liệu.
2. **Bỏ `vndNumber`** đã viết cùng `formatVnd` — sau mục #1 thì không còn ai gọi.

**Kiểm chứng**
- `formatVnd`: 13 ca (số lẻ, số âm, −0,5 → `0đ`, null/undefined/chuỗi rác, biên
  999,999) — đạt; chạy lại dưới `TZ=UTC` cũng đạt.
- **Số dư lớn ↔ số dư dòng mới nhất**, 6 KTV: **5 khớp tuyệt đối** trên số chưa
  cắt (T016 `1.066.971,719` = `1.066.971,719`, T007 `491.496,550` = `491.496,550`,
  NH079 `49.120,975` = `49.120,975`). Lệch 1,28đ của T016 đã hết.
- **Đối chiếu 2 phía** (mục 4.3): `available_balance` trên Ví = trên `finance/ktv`
  — 4/4 KTV khớp (T016 `66.971đ` cả hai bên).
- `npm run test:qa` (16 bộ): ĐẠT. Typecheck sạch, eslint không thêm lỗi mới,
  `/ktv/wallet` và `/finance/ktv` trả 200.

## 9. Phát hiện thêm — KHÔNG thuộc lỗi làm tròn, chưa sửa

**T069 lệch 10.500đ** giữa ô số dư (`−30.000đ`) và số dư dòng mới nhất
(`−19.500đ`). Không phải phần lẻ — là **tua "tạm tính"**:

- `KtvWalletService.getBalance` **loại** tua `is_provisional` (API trả riêng
  `pending_review_amount: 10500`, `pending_review_turns: 2`).
- `attachRunningBalance` thì **cộng cả** dòng `PENDING` vào số dư luỹ kế.

Hai định nghĩa "số dư" khác nhau trên cùng màn. Cần user chốt: số dư luỹ kế dưới
mỗi dòng nên tính cả tua chờ khách đánh giá, hay chỉ tính tua đã chốt? Tách việc
riêng — đụng ý nghĩa con số chứ không phải cách hiển thị.

---

## 10. Bổ sung — số dư luỹ kế CHỈ tính tua đã chốt (12/09/2026)

User chốt mục 9: **chỉ tính tua đã chốt**.

**Nguyên nhân gốc rễ.** `KtvWalletService.getBalance` và `attachRunningBalance`
định nghĩa "số dư" khác nhau:

| | Số dư lớn (`getBalance`) | Số dư luỹ kế (`attachRunningBalance`) |
|---|---|---|
| Tua loại D `is_provisional` | **bỏ** (trả riêng `pending_review_amount`) | **cộng vào** |
| Thuế của tua đó | **bỏ** | **cộng vào** (dòng thuế đang mang `status: 'APPROVED'`) |
| Tua A/B/C `HELD` (đang tạm giữ) | **bỏ** (chỉ cộng tua qua `checkIsItemPassed`) | **cộng vào** |
| Lệnh rút `PENDING` | **trừ** (`total_pending`) | **trừ** |

Vì vậy **không được chặn theo `status === 'PENDING'` chung chung** — làm thế là
bỏ luôn lệnh rút đang chờ duyệt, số dư lại sai theo hướng khác.

**Code** — 2 file:
- `app/api/ktv/wallet/timeline/route.ts`: thêm hàm `countsTowardBalance(item)` làm
  **một chỗ duy nhất** định nghĩa "dòng này có vào số dư chưa" (bỏ TIP, dòng bị từ
  chối, `is_provisional`, `HELD`; vẫn tính lệnh rút `PENDING`). Dòng tua loại D và
  dòng thuế đi kèm nay mang cờ `is_provisional`.
- `app/ktv/wallet/page.tsx`: dòng chưa chốt **không hiện chip "Số dư"** — hiện thì
  hai dòng liền nhau ra cùng một con số, đọc như lỗi.

**Kiểm chứng**
- Số dư lớn = số dư ở dòng **đã chốt** mới nhất: **7/7 KTV khớp tuyệt đối**, gồm
  T069 (`−30.000đ`, còn `10.500đ` tạm tính nằm ngoài) và một KTV loại C
  (`C_9HPU96`, `9.266.000đ` — có trừ tiền cọc).
- 4 dòng tạm tính của T069 giữ nguyên số dư của dòng chốt trước đó, không đội lên.
- `npm run test:qa` (16 bộ): ĐẠT. Typecheck sạch, eslint không thêm lỗi mới,
  `/ktv/wallet` trả 200.

**Còn lại**: dữ liệu hiện tại **không có dòng `HELD` nào** nên nhánh A/B/C chưa
được dữ liệu thật soi tới — logic đối xứng với nhánh loại D và khớp định nghĩa của
`getBalance`, nhưng nên để mắt khi có đơn A/B/C bị tạm giữ.
