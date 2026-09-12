# 1. Thông tin chung
- **Vấn đề:** Khi KTV bấm nút "Kết thúc dịch vụ", hệ thống thực hiện API để cập nhật trạng thái `CLEANING`. Tuy nhiên, sự kiện Realtime cập nhật nhanh hơn giao diện React, khiến `fetchBooking` chạy và do không tìm thấy trạng thái đang phục vụ, hệ thống ép KTV văng ra màn hình DASHBOARD thay vì màn hình Đánh giá (REVIEW).
- **Mục tiêu:** Khắc phục triệt để bằng việc thêm các chốt chặn (guards) tại những nơi gọi lệnh `setScreen('DASHBOARD')` ở trong KTVDashboard.

# 2. Chi tiết triển khai

## 2.1 Cập nhật `app/ktv/dashboard/KTVDashboard.logic.ts`
Khu vực cần chỉnh sửa là hàm `fetchBooking()` - chịu trách nhiệm tải lại dữ liệu khi có tín hiệu Realtime hoặc polling.

### Điểm 1: Guard khi không tìm thấy Booking (`!res.data`)
Hiện tại:
```typescript
} else if (res.success && (!res.data || !res.data.id)) {
    // KTV chưa có ca hoặc ca đã hoàn thành
    setBooking(null);
    setScreen('DASHBOARD');
}
```

Sửa thành:
```typescript
} else if (res.success && (!res.data || !res.data.id)) {
    // 🔒 CHỐT CHẶN: Nếu đang ở các màn hậu kỳ, tuyệt đối không văng ra Dashboard
    if (['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current)) {
        console.log("🔒 [KTV] Chặn lệnh thoát ra Dashboard vì đang trong màn hình Hậu kỳ.");
        return;
    }
    // KTV chưa có ca hoặc ca đã hoàn thành
    setBooking(null);
    setScreen('DASHBOARD');
}
```

### Điểm 2: Guard khi phát hiện Booking ID bị lệch
Hiện tại:
```typescript
if (bookingRef.current?.id && bookingRef.current.id !== res.data.id) {
    setBooking(null);
    setScreen('DASHBOARD');
}
```

Sửa thành:
```typescript
if (bookingRef.current?.id && bookingRef.current.id !== res.data.id) {
    // 🔒 CHỐT CHẶN: Nếu ID bị lệch do load nhầm đơn mới trong lúc đang hậu kỳ đơn cũ
    if (['REVIEW', 'HANDOVER', 'REWARD'].includes(screenRef.current)) {
        console.log("🔒 [KTV] Chặn đổi ID phiên làm việc vì đang trong màn hình Hậu kỳ.");
        return;
    }
    setBooking(null);
    setScreen('DASHBOARD');
}
```

# 3. Kế hoạch kiểm tra (Verification Plan)
- Yêu cầu KTV (trên máy test) bấm Kết thúc dịch vụ.
- Quan sát luồng màn hình xem có còn bị văng ra màn Dashboard nữa không.
- Log console sẽ in ra `"🔒 [KTV] Chặn..."` thay vì đẩy KTV văng ra ngoài, chứng minh chốt chặn đã hoạt động.
