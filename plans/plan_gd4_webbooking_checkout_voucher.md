# Plan GĐ4: Checkout WebBooking có e-voucher (cửa sổ B làm)

> Plan gốc: `plans/plan_evoucher_webbooking_gioi_han.md`. Hợp đồng DB: `TableInSupabase.md` mục [v16].
> Viết 08/10/2026 bởi Conversation A sau khi đọc (chỉ đọc) `../NganHa-WebBooking-evoucher` nhánh `feat/web-evoucher`.
> **Mức 2** vì chạm đường nóng `src/app/api/bookings/route.ts` (mọi đơn web đi qua). DB **không cần đổi gì thêm**.

## 0. Nguyên tắc

1. **Đơn KHÔNG có mã đi đúng đường cũ.** Không mã → không gọi RPC mới, response không thêm field nào. Field `voucher` chỉ xuất hiện khi request có mã hoặc snapshot có dòng giảm.
2. **`voucherCode` KHÔNG nằm trong `intentFingerprint` / quote / reprice.** Quote vẫn là tổng trước giảm. Nhờ vậy khách bị từ chối voucher có thể gửi lại **cùng idempotency key, không mã** mà quote vẫn hợp lệ.
3. **Số tiền giảm hiển thị sau khi đặt lấy từ snapshot DB** (tổng các dòng `options.isPromotion`), không lấy từ request hay preview. Một nguồn cho mọi nhánh (lần đầu, replay, reconcile).
4. `options` của dòng gửi cho preview và writer **đều do server dựng** bằng `dispatchLinesFromPricing` + `expandDispatchItems` (đã đúng ở route hiện tại; preview phải dùng y hệt).

## 1. Bốn bẫy tìm thấy khi đọc route (nếu không sửa, đơn có voucher sẽ hỏng)

| # | Chỗ | Vì sao hỏng | Sửa |
|---|---|---|---|
| **F1** | `replayLineKeysFromSnapshot` (route.ts ~620) | Dòng `KM####` (isPromotion, không isAddon) bị đưa vào danh sách dòng → khác request → **double-click đơn có voucher trả `IDEMPOTENCY_KEY_REUSED`**. Hàm này dùng ở 4 nhánh: replay đầu POST (~860), `resolveReplayConflict`, `reconcileAfterUncertainCommit`, kiểm sau ghi (~975/984) | Thêm 1 dòng đầu flatMap: `if (options.isPromotion === true) return [];`. Sửa 1 chỗ phủ cả 4 nhánh |
| **F2** | Kiểm tổng sau ghi (~975 và ~984): `committedSnapshot.totalAmount !== pricing.totalAmountVND` | Tổng đã giảm ≠ tổng trước giảm → đơn đã ghi thật nhưng khách thấy **"đơn chưa hoàn tất"**, không có email | Hàm mới `promotionDiscountFromSnapshot(snapshot) = -Σ(price × quantity)` các dòng isPromotion. So `snapshot.totalAmount + discount === pricing.totalAmountVND` |
| **F3** | `catch (writerError)` (~952): `isRetryableWriterError` chạy **trước** `mapWriterError` | `schemaUnavailable` có regex `function webbooking_(allocate_booking_number\|commit_booking)` → khớp tiền tố `webbooking_commit_booking_with_voucher`; và `PGRST202` (RPC chưa có trên DB) bị coi là lỗi tạm → khách thấy "chưa xác minh được đơn" | Trong catch, kiểm `VOUCHER_REJECTED:` **đầu tiên**. Nếu gọi wrapper mà lỗi `PGRST202`/`42883` → trả như `VOUCHER_REJECTED:FEATURE_DISABLED` (đơn chưa tạo, khách đặt lại không mã) |
| **F4** | Nhánh replay ở đầu POST (~857) | Lần đầu không mã, lần sau gửi kèm mã → trả snapshot cũ mà **không báo voucher không áp** | Khi request có mã và snapshot không có dòng giảm → `voucher: {applied:false, reason:'REPLAY_WITHOUT_VOUCHER'}` |

## 2. Diff theo file

### 2.1 `src/lib/booking/contract.ts`
- `parseBookingRequest`: đọc `body.voucherCode` → trim, upper, regex `^[A-Z0-9]{3}-[A-Z0-9]{6}$` (đúng format mã v15), sai format → lỗi field `voucherCode`/`INVALID_VOUCHER_CODE`.
- Gắn `voucherCode` vào `value` **sau** khi tính `intentFingerprint` (không đưa vào `normalizedBase`). Thêm `voucherCode: string | null` vào type `NormalizedBooking` (dòng 53).

### 2.2 `src/app/api/bookings/route.ts` (đường nóng, sửa tối thiểu)
- F1: 1 dòng trong `replayLineKeysFromSnapshot`.
- F2: thêm `promotionDiscountFromSnapshot`; thay 2 biểu thức so tổng.
- `commitBookingAtomically(supabase, payload, items, voucherCode)`:
  - `voucherCode` null → gọi `webbooking_commit_booking` **như cũ**.
  - Có mã → `webbooking_commit_booking_with_voucher({p_booking, p_items, p_voucher_code})`. Result thêm `voucher` (giữ nguyên để log, không dùng để hiển thị).
- F3: nhánh catch đầu tiên:
  ```ts
  const rejected = voucherRejectionCode(writerError, Boolean(booking.voucherCode));
  if (rejected) return jsonError('VOUCHER_REJECTED', 'The voucher could not be applied.', 409, undefined, { voucherError: rejected });
  ```
  `voucherRejectionCode`: đọc `VOUCHER_REJECTED:([A-Z_]+)` từ message; nếu có mã và lỗi là `PGRST202`/`42883` → `'FEATURE_DISABLED'`. (Kiểm `jsonError` có nhận thêm field không; nếu không thì thêm tham số `extra` tuỳ chọn, không đổi call cũ.)
- Response (`responseForSnapshot` + response cuối): thêm `voucher` **chỉ khi** `booking.voucherCode` hoặc discount > 0:
  `{ applied: discount > 0, voucherCode, discountAmount: discount, subtotalAmount: totalAmount + discount, totalAmount, reason? }` → F4.
- Email: truyền thêm `subtotalAmount`, `discountAmount` (0 khi không mã).

### 2.3 `src/lib/mailer.ts`
- Type input thêm `discountAmount?: number; subtotalAmount?: number`.
- HTML (~900) và text (~1108): khi `discountAmount > 0` hiện Tạm tính / "Oria Booking Reward −X" / Tổng. Không mã → HTML **y hệt** cũ. Chuỗi 5 ngôn ngữ để trong dictionary của mailer.

### 2.4 Mới `src/app/api/promotions/web-claim/preview/route.ts` (POST)
- Body `{ voucherCode, selectedServices }`. Rate limit cùng helper (VD 20 lần/phút/IP).
- Dùng **lại** các hàm lib mà route bookings dùng: đọc catalog → `canonicalizeOptionsForService` → `validateCatalogOptions` → `buildCanonicalPricing` → `expandDispatchItems(dispatchLinesFromPricing(pricing), 'PREVIEW')` → `rpc('promo_web_preview', {p_code, p_items})`. RPC bỏ qua key thừa (id, price…), tự lấy giá.
- Không import gì từ `app/api/bookings/route.ts`. Nếu phần đọc catalog phải copy > 15 dòng → tách ra `src/lib/booking/pricingFromCatalog.ts` và **chỉ** để preview dùng (không đổi route bookings ở GĐ4).

### 2.5 Client: `src/components/BookingCheckout/BookingCheckout.tsx` (+ `.logic.ts`/i18n tương ứng) và `BookingForm.logic.ts`
- **Xác nhận trước:** checkout nào đang thật sự gửi `/api/bookings` (`BookingForm.logic.ts` hay `app/[lang]/new-user/[menuType]/checkout/page.tsx`), và idempotency key sinh ở đâu. Key phải **giữ nguyên** khi gửi lại không mã.
- Khối voucher (component riêng, bọc lỗi → ẩn khối, checkout vẫn chạy):
  1. Đọc ví → `/api/vouchers/[code]` → chỉ hiện mã `RESERVED` còn hạn (đếm ngược).
  2. Nút **Áp dụng** → preview → hiện giảm / tổng sau giảm, hoặc `unmetReasons` (câu chung 5 ngôn ngữ).
  3. Đổi giỏ sau khi Áp dụng → xoá kết quả preview, phải Áp dụng lại.
  4. Gửi `voucherCode` trong body chỉ khi khách đã Áp dụng thành công.
- 409 `VOUCHER_REJECTED` → dialog câu theo `voucherError` + "Đặt không kèm voucher?" → Đồng ý: gửi lại **cùng key**, bỏ `voucherCode`; Huỷ: ở lại checkout.
- Thành công: màn cảm ơn hiện Tạm tính / Giảm / Tổng từ `response.voucher`; `reason === 'REPLAY_WITHOUT_VOUCHER'` → câu báo "đơn đã ghi trước đó, chưa áp voucher". Xoá mã khỏi ví khi `applied`.

## 3. Ảnh hưởng chéo (CLAUDE.md 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn / API | Không ảnh hưởng: dòng KM không có KTV, không có segments | Quầy thấy đơn web có dòng `KM####` âm và tổng đã giảm (đã có từ engine v1–v14) | `Bookings`, `BookingItems`, v16 | Sửa WebBooking; admin/KTV không đổi code |
| Số liệu tiền | Hoa hồng theo phút, không đổi | Doanh thu theo `totalAmount` (net) | engine `promo_compute_discount_core` | Khớp (đã kiểm GĐ0, B18) |
| Realtime | Không | Thẻ admin nhận `PromotionCampaignStock` | `PromotionCampaignStock` | Đồng bộ |
| Quyền xem | Không | Không đổi | Preview/status không trả SĐT | Không lộ |

## 4. Vùng ảnh hưởng (CLAUDE.md 4.5)

1. **Dùng chung gì?** `replayLineKeysFromSnapshot` + kiểm tổng nuôi mọi đơn web; `parseBookingRequest` dùng cả ở `reprice` (field mới tuỳ chọn, không đổi fingerprint → reprice không đổi); `mailer.ts` dùng cho mọi email xác nhận.
2. **Sai thì sập gì?** Sai F1/F2 → khách đặt được nhưng thấy lỗi/không có email; sai parse → **mọi** đơn web 400. Vì vậy test bắt buộc "đơn không mã y hệt trước".
3. **Luồng khách:** có — checkout, màn cảm ơn, email. WRB hoá đơn/journey không đổi (B18).
4. **Cô lập:** khối voucher ở checkout là component riêng, lỗi thì ẩn; preview là route riêng; đường không mã không gọi RPC mới.

## 5. Test bắt buộc (TEST `eknggruuiuadwldacpmb`, dọn sạch sau)

Mỗi ca ghi lại: HTTP status, `response.voucher`, `Bookings.totalAmount`, dòng KM, trạng thái claim.

| # | Ca | Kỳ vọng |
|---|---|---|
| T1 | Đơn **không mã**: 1 DV, 2 DV + phòng riêng, nhiều khách, ngày mai | Response và email **giống hệt** trước khi sửa (so JSON trước/sau) |
| T2 | Có mã, 1 DV đủ điều kiện | 200, giảm đúng = preview, claim ACTIVE, email có dòng giảm |
| T3 | Double-click (2 POST cùng key, cùng mã) | 1 đơn, 1 dòng KM, lần 2 `idempotent:true` + `voucher.applied:true` (F1) |
| T4 | Mã hết hạn giữa Áp dụng và Xác nhận | 409 `VOUCHER_REJECTED`/`VOUCHER_EXPIRED`, **không có đơn**; Đồng ý đặt không mã → 200, cùng key |
| T5 | 2 tab cùng mã đặt cùng lúc | 1 đơn có giảm; tab kia 409 `VOUCHER_ALREADY_USED` → đặt không mã được |
| T6 | Tắt công tắc giữa chừng | 409 `FEATURE_DISABLED` → đặt không mã được |
| T7 | Không đủ điều kiện (VD dưới X phút) | Preview `eligible:false`; nếu vẫn gửi → 409 `ORDER_CONDITION_NOT_MET` |
| T8 | Lần đầu không mã, gửi lại cùng key kèm mã | 200 `REPLAY_WITHOUT_VOUCHER`, không giảm (F4) |
| T9 | Sửa `options.duration` từ client để lách điều kiện | Không ảnh hưởng: options do server dựng |
| T10 | Giả lập wrapper chưa có (gọi tên RPC sai trên local) | 409 `FEATURE_DISABLED`, không phải "chưa xác minh" (F3) |
| T11 | Huỷ đơn có voucher từ admin TEST | Suất quay về kho, thẻ web nhận realtime |
| T12 | `npm run build`, lint, chạy dưới `TZ=UTC` | Đạt |

**Phối hợp TEST:** trong lúc B chạy T2–T11, A không chạy `qa_promotion_web_claim.ts` (cả hai bật/tắt `promotion_web_claim_enabled`).

## 6. Deploy

- GĐ3 + GĐ4 merge vào `master` **cùng một lần**, chỉ sau khi v15 + v16 đã lên DB thật (checklist go-live bước 1–2). Nếu code lên trước DB: không mã vẫn chạy; có mã → F3 trả `FEATURE_DISABLED` (an toàn), và thẻ web không hiện vì công tắc chưa có.
- Env cần trên Vercel: `VOUCHER_IP_HASH_SECRET` (GĐ3).
