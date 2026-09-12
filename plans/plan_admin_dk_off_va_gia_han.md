# Plan: Admin Đăng Ký OFF & Logic Gia Hạn Mới

## Trạng thái: ✅ HOÀN THÀNH

## 1. Tính năng A: Admin đăng ký OFF giúp KTV
- **Vị trí UI**: Tab "Lịch OFF & Ca" → Phần "Nhân sự OFF" → Nút `+ ĐK OFF`
- **Flow**: Chọn ngày trên calendar → Bấm `+ ĐK OFF` → Chọn KTV từ dropdown → Xác nhận
- **Backend**: `POST /api/ktv/leave` với `registeredByAdmin: true`
  - Bypass deadline (không kiểm tra 19h hôm trước)
  - Bypass gia hạn (không tính extension)
  - Auto-approved

### Files đã sửa:
- `app/api/ktv/leave/route.ts` — Thêm `registeredByAdmin` param
- `app/reception/leave-management/LeaveManagement.logic.ts` — Thêm `adminRegisterOff()` function
- `app/reception/ktv-hub/page.tsx` — Thêm UI nút ĐK OFF + popover chọn KTV

## 2. Tính năng B: Logic gia hạn mới

### Rule:
```
Khi KTV đăng ký thêm ngày OFF (targetDate):
1. Kiểm tra ngày trước targetDate có OFF không
2. Nếu KHÔNG → đăng ký mới, KHÔNG tính gia hạn
3. Nếu CÓ → tìm ngày đầu chuỗi nghỉ liên tiếp → tính deadline = 19h ngày trước ngày đầu chuỗi
4. Nếu đăng ký TRƯỚC deadline → KHÔNG tính gia hạn
5. Nếu đăng ký SAU deadline → TÍNH gia hạn
```

### Proof of Concept — 5/5 cases đúng:
| Case | Kịch bản | Kết quả |
|------|----------|---------|
| 1 | OFF 2,3 → Trước 19h ngày 1 dk ngày 4 | KHÔNG gia hạn ✅ |
| 2 | OFF 2,3 → Sau 19h ngày 1 dk ngày 4 | TÍNH gia hạn ✅ |
| 3 | OFF 2,3 → Đang trong ngày 2 dk ngày 4 | TÍNH gia hạn ✅ |
| 4 | OFF 2,3 → Trước 19h ngày 1 dk ngày 5 (nhảy cóc) | KHÔNG gia hạn ✅ |
| 5 | Không có chuỗi → dk ngày mới | KHÔNG gia hạn ✅ |
