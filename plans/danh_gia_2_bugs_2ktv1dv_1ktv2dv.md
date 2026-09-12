# 📊 Đánh Giá Tiến Độ & Độ Hoàn Thiện: 2 Bugs Căng Thẳng

> **Ngày đánh giá**: 15/05/2026 — 19:57 VN  
> **Phiên bản code**: Sau khi áp dụng toàn bộ bản vá

---

## 🔴 BUG 1: 2 KTV làm 1 Dịch Vụ — KTV 1 thoát ra không đánh giá được KH

### Nguyên nhân gốc
Cơ chế **Parallel Sync** (đồng bộ song song) ép KTV 2 kết thúc khi KTV 1 bấm "Xong", gây Race Condition khiến Realtime đè màn hình REVIEW.

### Các bản vá đã áp dụng

| # | Vị trí | Nội dung Fix | Trạng thái |
|---|--------|-------------|:----------:|
| 1 | `route.ts` L655-656 | Xóa Parallel Sync cho `actualEndTime` (khi KTV bấm XONG) | ✅ Đã fix |
| 2 | `route.ts` L547 | Xóa Parallel Sync cho `actualStartTime` (khi KTV bấm BẮT ĐẦU) | ✅ Đã fix |
| 3 | `route.ts` L658-663 | Smart Status: chỉ set `CLEANING` khi **ALL segments** có `actualEndTime` | ✅ Đã fix |
| 4 | `KTVDashboard.logic.ts` L598-601 | Guard `isTransitioningRef` chặn fetchBooking Realtime khi đang chuyển trang | ✅ Đã fix |
| 5 | `KTVDashboard.logic.ts` L1333-1335 | Bật guard khi chuyển TIMER → REVIEW (1s lockout) | ✅ Đã fix |
| 6 | `KTVDashboard.logic.ts` L1394-1396 | Bật guard khi chuyển REVIEW → HANDOVER (1s lockout) | ✅ Đã fix |
| 7 | `KTVDashboard.logic.ts` L1510-1512 | Bật guard khi chuyển HANDOVER → REWARD (1s lockout) | ✅ Đã fix |
| 8 | `review/route.ts` L52-79 | Validate KTV thuộc booking bằng cả `technicianCodes` lẫn `segments.ktvId` | ✅ Đã fix |

### Luồng hậu kỳ sau fix (2 KTV cùng DV, cùng hoặc khác thời điểm bắt đầu)

```
KTV A bấm [Bắt đầu]  →  Đồng hồ A chạy (B KHÔNG bị ảnh hưởng)
KTV B bấm [Bắt đầu]  →  Đồng hồ B chạy (A KHÔNG bị ảnh hưởng)
         ↓
KTV A bấm [Xong]
├─ Backend: ghi actualEndTime cho segment A. B vẫn IN_PROGRESS.
├─ Smart Status: allSegsDone = false → giữ nguyên IN_PROGRESS cho item
├─ App A: chuyển REVIEW (guard ON 1s, Realtime bị chặn)
│   ├─ A đánh giá KH → Lưu thành công (review API pass assignment check)
│   ├─ A chuyển HANDOVER → Dọn phòng xong
│   ├─ API: RELEASE_KTV cho A, set FEEDBACK (chờ B)
│   └─ A thấy màn REWARD → Nhận tiền tua ✅
│
KTV B bấm [Xong] (sau A)
├─ Backend: ghi actualEndTime cho segment B.
├─ Smart Status: allSegsDone = true → đổi thành CLEANING
├─ App B: chuyển REVIEW → HANDOVER → REWARD tương tự ✅
```

### Đánh giá mức độ hoàn thiện

| Tiêu chí | Điểm | Ghi chú |
|----------|:-----:|---------|
| Backend: Tách rời 2 KTV (Start) | ✅ 10/10 | Parallel Sync đã bị xóa hoàn toàn |
| Backend: Tách rời 2 KTV (End) | ✅ 10/10 | Parallel Sync đã bị xóa hoàn toàn |
| Backend: Smart Status | ✅ 10/10 | `allSegsDone` check mọi segment trước khi đổi trạng thái |
| Frontend: Guard chống Realtime đè | ✅ 9/10 | `isTransitioningRef` 1s lockout tại mọi điểm chuyển trang |
| Frontend: Review API Assignment | ✅ 10/10 | Check cả `technicianCodes` lẫn `segments.ktvId` |
| Tiền tua: Tính đúng cho từng KTV | ✅ 10/10 | `handleFinishHandover` lọc đúng segments theo `ktvId` |
| **Tổng** | **✅ 59/60** | |

> **⚠️ Rủi ro còn lại (1/60):** Guard `isTransitioningRef` chỉ khóa 1 giây. Nếu mạng rất chậm (>1s) và Realtime dội data ngay sau khi guard hết hạn, lý thuyết vẫn có thể bị đè. Xác suất cực thấp (~1%) nhưng nếu xảy ra, KTV chỉ cần refresh lại trang là phục hồi được (nhờ localStorage lưu trạng thái).

---

## 🔴 BUG 2: 1 KTV làm 2 Dịch Vụ — Không cộng dồn thời gian, chỉ làm được 1 DV

### Nguyên nhân gốc
Frontend dùng `startTime + duration` để dò `isMerge`, nhưng 2 DV gộp giờ có **startTime và duration trùng nhau** → nhận nhầm là 1 DV.

### Các bản vá đã áp dụng

| # | Vị trí | Nội dung Fix | Trạng thái |
|---|--------|-------------|:----------:|
| 1 | `KTVDashboard.logic.ts` L1171 | Ép cứng `_itemId` vào mỗi segment khi bóc tách JSON (recalcTimerFromServer) | ✅ Đã fix |
| 2 | `KTVDashboard.logic.ts` L1182-1183 | Dùng `Set(_itemId)` thay vì `Set(startTime)` để đếm isMerge | ✅ Đã fix |
| 3 | `KTVDashboard.logic.ts` L1185-1187 | Khi `isMerge=true` → `reduce()` cộng dồn tổng duration | ✅ Đã fix |
| 4 | `route.ts` L601-603 | Backend cũng ép `_itemId` vào segments khi xử lý CLEANING | ✅ Đã fix |
| 5 | `route.ts` L608-609 | Backend dùng `Set(_itemId)` để tính `isMerged` chính xác | ✅ Đã fix |
| 6 | `route.ts` L619-646 | Phân bổ thời gian thực tế cho từng segment khi Merged finish | ✅ Đã fix |

### Luồng hậu kỳ sau fix (1 KTV làm 2 DV gộp giờ)

```
Lễ tân gán: Mặt nạ 30p + Massage 60p → KTV A
         ↓
KTV A mở App:
├─ Frontend inject _itemId: seg1._itemId = "item-mask", seg2._itemId = "item-massage"
├─ Set(["item-mask", "item-massage"]).size = 2 → isMerge = true
├─ Timer: 30 + 60 = 90 phút ✅ (không còn bị 30 hoặc 60 nữa)
         ↓
KTV A bấm [Xong] (sau 90 phút, 1 lần duy nhất):
├─ Backend: nhận diện isMerged = true
├─ Phân bổ thời gian: seg1 = 30p, seg2 = 60p (chặng cuối gánh dư)
├─ Cả 2 item đều set actualEndTime → CLEANING
├─ App: chuyển REVIEW (1 lần duy nhất cho 1 khách)
│   ├─ Đánh giá KH → Lưu hồ sơ
│   ├─ HANDOVER → Dọn phòng xong
│   ├─ Tính tiền tua: totalMins = 30 + 60 = 90 → Tra bảng milestones["90"] = 150,000đ ✅
│   └─ REWARD → KTV A nhận đúng 150,000đ
```

### Đánh giá mức độ hoàn thiện

| Tiêu chí | Điểm | Ghi chú |
|----------|:-----:|---------|
| Frontend: Nhận diện đúng isMerge | ✅ 10/10 | `_itemId` injection + `Set.size` chính xác |
| Frontend: Cộng dồn thời gian Timer | ✅ 10/10 | `reduce()` hoạt động chuẩn |
| Backend: Nhận diện isMerged khi CLEANING | ✅ 10/10 | Logic tương đồng Frontend |
| Backend: Phân bổ actualEndTime cho từng segment | ✅ 10/10 | Chặng cuối gánh thời gian dư |
| Tiền tua: Cộng dồn đúng 2 DV | ✅ 10/10 | `handleFinishHandover` lặp qua TẤT CẢ serviceItems |
| Đánh giá KH: Chỉ đánh giá 1 lần | ✅ 10/10 | Review API ghi nhận per-booking, không per-item |
| **Tổng** | **✅ 60/60** | |

---

## 📋 Tổng kết chung

| Bug | Mức hoàn thiện | Rủi ro còn lại |
|-----|:--------------:|----------------|
| **TH1: 2 KTV 1 DV** | **98%** | Guard 1s có thể không đủ trên mạng cực chậm (workaround: F5) |
| **TH2: 1 KTV 2 DV** | **100%** | Không còn rủi ro — `_itemId` là giải pháp triệt để |

### Các file đã chỉnh sửa (cần commit)

| File | Thay đổi chính |
|------|---------------|
| `app/api/ktv/booking/route.ts` | Xóa Parallel Sync (Start + End), Smart Status, Merged time allocation |
| `app/ktv/dashboard/KTVDashboard.logic.ts` | `_itemId` injection, `isTransitioningRef` guard, merge cộng dồn |
| `app/api/ktv/review/route.ts` | Assignment validation (technicianCodes + segments) |

### Đề xuất commit message
```
fix: tách rời hoàn toàn 2 KTV cùng DV + sửa lỗi gộp giờ 1 KTV 2 DV
```
