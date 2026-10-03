# Kế Hoạch Triển Khai Phase 4: Chuyển Đổi S.O.L.I.D Backend

## Mục Tiêu
Cấu trúc lại Backend: tách nghiệp vụ (Business Logic) ra khỏi API Routes thành các `Service` độc lập, đồng thời vá tất cả lỗ hổng đã phát hiện.

---

## Các Thay Đổi Đề Xuất

### 1. Tạo mới Service Layer (`lib/services/`)

#### [NEW] `lib/services/KtvCommissionService.ts`
Chịu trách nhiệm toàn bộ về TIỀN TUA và SỐ DƯ.
- `getCommissionConfig(workType)`: Đọc mốc tiền tua (Milestones) theo Type A hoặc Type B.
- `calculateWalletBalance(staffId)`: Tính tổng tiền tua kiếm được − tiền đã rút. Thay thế SQL RPC cũ.
- `withdraw(staffId, amount)`: Rút tiền với **transaction lock** — kiểm tra `balance >= amount` bên trong transaction, reject nếu 2 lần rút cách nhau < 5 giây.

> [!WARNING]
> **Chiến lược Migrate an toàn (2 tuần song song):**
> Trong 2 tuần đầu, API `balance` sẽ gọi **cả RPC cũ lẫn Service mới**, so sánh kết quả qua `console.log`. Chỉ khi khớp 100% mới loại bỏ RPC cũ. Đúng theo rule: *"KHÔNG DROP ngay hàm SQL khi vừa deploy."*

#### [NEW] `lib/services/KtvOnlineService.ts`
Chịu trách nhiệm về trạng thái Online/Offline của KTV Type B.
- `goOnline(staffId, travelMinutes, availableUntil)`: KTV bấm nút nhận khách từ nhà.
- `arriveAtVenue(staffId)`: KTV xác nhận đã tới Spa.
- `cleanupExpiredOnline()`: Dọn rác — SET `online_status = 'OFFLINE'` cho các KTV có `available_until < NOW() - 1 giờ` và không có đơn đang làm.

### 2. Cơ chế Tự Động Offline: Hybrid (Lazy + Cron Theo Ca)

```
┌─────────────────────────────────────────────────────────┐
│  TẦNG 1: LAZY EVALUATION (Realtime, chi phí = 0)       │
│                                                         │
│  • Lễ Tân load bảng → SQL filter:                       │
│    WHERE online_status = 'ONLINE'                       │
│    AND available_until > NOW()                           │
│    → KTV hết giờ tự ẩn, không cần update DB             │
│                                                         │
│  • KTV mở App → API check:                              │
│    Nếu available_until < NOW()                           │
│    → Tự động UPDATE online_status = 'OFFLINE'           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  TẦNG 2: CRON DỌN RÁC THEO MỐC CA (7 lần/ngày)       │
│                                                         │
│  Chạy tại: 09:00, 11:00, 15:00, 17:00, 19:00,          │
│            21:00, 00:00 (theo giờ VN, UTC+7)            │
│                                                         │
│  → Gọi KtvOnlineService.cleanupExpiredOnline()          │
│  → Dọn sạch "Zombie Records" (KTV quên tắt,            │
│     KTV không mở app lại, v.v.)                         │
│                                                         │
│  Vercel Cron Expression:                                │
│  "0 2,4,8,10,12,14,17 * * *" (UTC, tương đương VN)     │
└─────────────────────────────────────────────────────────┘
```

> [!NOTE]
> **Tại sao chọn các mốc này?**
> 9h, 11h → Ca sáng ra/vô. 15h, 17h → Ca chiều. 19h, 21h → Ca tối. 00h → Cuối ngày dọn sạch toàn bộ.
> Đây là thói quen thực tế của KTV tại Spa, đảm bảo dữ liệu luôn sạch vào đúng thời điểm quan trọng nhất.

### 3. Fix Biến `now` Trôi Thời Gian (DispatchStaffRow)

#### [MODIFY] `app/reception/dispatch/useDispatchBoard.logic.ts`
- Thêm state `now` với `setInterval` mỗi **60 giây** tự cập nhật.
- Truyền `now` xuống các component con qua props hoặc context.

#### [MODIFY] `app/reception/dispatch/_components/DispatchStaffRow.tsx`
- Nhận `now` từ props thay vì tự tính → thời gian "Rảnh lúc HH:MM" luôn chính xác dù Lễ tân để màn hình mở cả tiếng.

### 4. API Routes (Controller Layer)

#### [MODIFY] `app/api/ktv/wallet/balance/route.ts`
- Gọi song song: `KtvCommissionService.calculateWalletBalance()` + RPC cũ.
- So sánh kết quả, log ra console. Trả về kết quả từ Service mới.

#### [MODIFY] `app/api/ktv/wallet/withdraw/route.ts`
- Dùng `KtvCommissionService.withdraw()` với transaction lock.

#### [NEW] `app/api/ktv/online/route.ts`
- POST: nhận `{ action: 'GO_ONLINE' | 'ARRIVED' | 'GO_OFFLINE', ...params }`.
- Gọi `KtvOnlineService` tương ứng.

#### [NEW] `app/api/cron/cleanup-online/route.ts`
- Vercel Cron endpoint, gọi `KtvOnlineService.cleanupExpiredOnline()`.
- Cấu hình trong `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/cleanup-online",
    "schedule": "0 2,4,8,10,12,14,17 * * *"
  }]
}
```

---

## Tổng Hợp Files Thay Đổi

| # | File | Hành động | Mô tả |
|---|------|-----------|-------|
| 1 | `lib/services/KtvCommissionService.ts` | **[NEW]** | Service tính tiền tua + số dư + rút tiền (có lock) |
| 2 | `lib/services/KtvOnlineService.ts` | **[NEW]** | Service quản lý trạng thái Online/Offline Type B |
| 3 | `app/api/ktv/wallet/balance/route.ts` | **[MODIFY]** | Chuyển sang dùng Service, chạy song song RPC cũ 2 tuần |
| 4 | `app/api/ktv/wallet/withdraw/route.ts` | **[MODIFY]** | Dùng Service với transaction lock |
| 5 | `app/api/ktv/online/route.ts` | **[NEW]** | API cho KTV Type B đăng ký nhận đơn |
| 6 | `app/api/cron/cleanup-online/route.ts` | **[NEW]** | Cron dọn Zombie Records theo mốc ca |
| 7 | `vercel.json` | **[MODIFY]** | Thêm cấu hình cron schedule |
| 8 | `useDispatchBoard.logic.ts` | **[MODIFY]** | Thêm state `now` auto-refresh 60s |
| 9 | `DispatchStaffRow.tsx` | **[MODIFY]** | Nhận `now` từ props, không tự tính |

---

## Kế Hoạch Xác Minh

### Automated Tests
1. Gọi API `balance` → kiểm tra kết quả Service mới khớp RPC cũ.
2. Gọi API `withdraw` 2 lần liên tiếp cách nhau < 1 giây → request thứ 2 phải bị reject.
3. Sửa `available_until` của KTV về quá khứ → gọi API `cleanup-online` → kiểm tra `online_status` đã chuyển `OFFLINE`.

### Manual Verification
1. KTV Type B bấm "Nhận đơn" → Lễ Tân thấy ngay trong danh sách (⌛ Rảnh lúc HH:MM).
2. Để màn hình Lễ Tân mở 5 phút → thời gian "Rảnh lúc" phải tự cập nhật (không bị đóng băng).
3. KTV hết giờ mà không tắt → chờ đến mốc Cron tiếp theo → kiểm tra DB đã tự dọn.
