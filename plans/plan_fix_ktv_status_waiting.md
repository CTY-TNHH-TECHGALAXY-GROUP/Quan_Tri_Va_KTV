# Kế hoạch khắc phục lỗi KTV đang làm nhưng hiện trạng thái Sẵn sàng (waiting)

## 📌 Nguyên nhân gốc rễ (Root Cause)
1. **Lễ tân bắt đầu đơn mới quá sớm**: KTV vừa hoàn thành đơn thứ nhất (`11NDK-001-05062026`) lúc 12:06. Lễ tân đã bấm bắt đầu đơn thứ hai (`11NDK-003-05062026`) vào lúc 12:12.
2. **KTV bị trôi màn hình (Bypass Handover)**: Vì đơn thứ hai đã bắt đầu (`IN_PROGRESS`), API GET của KTV tự động chuyển hướng giao diện của KTV sang đơn mới, làm KTV không thể bấm nút "Nhận đơn tiếp theo" (`RELEASE_KTV`) của đơn cũ.
3. **Kẹt trạng thái ACTIVE cũ**: Do không gọi `RELEASE_KTV`, assignment của đơn cũ trong bảng `KtvAssignments` vẫn ở trạng thái `ACTIVE` (chưa chuyển sang `COMPLETED`). Vì vậy hàm SQL `promote_next_assignment` không được gọi để gán đơn mới và đồng bộ hàng đợi.
4. **Auto-activate thiếu đồng bộ**: Khi KTV mở đơn mới, API `handleGetBooking.ts` tự động kích hoạt assignment của đơn mới thành `ACTIVE` (Auto-Activate), nhưng **chỉ cập nhật bảng `KtvAssignments` mà không đồng bộ sang bảng `TurnQueue`**. 
5. **Không cập nhật được trạng thái làm việc (working)**: Khi KTV bấm "Bắt đầu" đơn mới, API `START_TIMER` cố gắng cập nhật trạng thái `TurnQueue.status = 'working'` dựa trên điều kiện `current_order_id = bookingId` (đơn mới). Nhưng do `TurnQueue` vẫn đang trỏ về đơn cũ (hoặc rỗng), câu lệnh update không tìm thấy dòng phù hợp để cập nhật. Kết quả là KTV vẫn hiển thị là "Sẵn sàng" (waiting) trên bảng hàng đợi.

---

## 🛠️ Giải pháp đề xuất (Proposed Changes)

Chúng ta sẽ nâng cấp cơ chế tự phục hồi (Self-Healing) trong API `handleGetBooking.ts` khi thực hiện tự kích hoạt (Auto-Activate) đơn mới:

### 1. File cần chỉnh sửa: [handleGetBooking.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/booking/_handlers/handleGetBooking.ts)

- **Bước 1**: Truy vấn thêm các trường thông tin cần thiết (`id, status, booking_item_id, room_id, bed_id`) từ `KtvAssignments` thay vì chỉ truy vấn `status`.
- **Bước 2**: Khi phát hiện assignment của đơn mới ở trạng thái `QUEUED` hoặc `READY`:
  - **Tự động hoàn thành (COMPLETED) các assignment `ACTIVE` khác** của KTV đó trong ngày để tránh xung đột kẹt trạng thái.
  - **Cập nhật trạng thái của assignment mới** thành `ACTIVE`.
  - **Đồng bộ thông tin mới sang bảng `TurnQueue`**: cập nhật `current_order_id`, `booking_item_id`, `booking_item_ids`, `room_id`, `bed_id` và cập nhật `status = 'assigned'` (trừ khi trạng thái hiện tại là `'off'`).

---

## 📋 Chi tiết mã nguồn thay đổi

### [handleGetBooking.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/booking/_handlers/handleGetBooking.ts)

```typescript
// Trước:
const { data: assign } = await supabase
    .from('KtvAssignments')
    .select('status')
    .eq('employee_id', technicianCode)
    .eq('booking_id', bookingId)
    .eq('business_date', today)
    .maybeSingle();

if (assign && (assign.status === 'QUEUED' || assign.status === 'READY')) {
    await supabase
        .from('KtvAssignments')
        .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
        .eq('employee_id', technicianCode)
        .eq('booking_id', bookingId)
        .eq('business_date', today);
    
    console.log(`[KTV API] Auto-activated assignment for KTV ${technicianCode} on booking ${bookingId}`);
}

// Sau:
const { data: assign } = await supabase
    .from('KtvAssignments')
    .select('id, status, booking_item_id, room_id, bed_id')
    .eq('employee_id', technicianCode)
    .eq('booking_id', bookingId)
    .eq('business_date', today)
    .maybeSingle();

if (assign && (assign.status === 'QUEUED' || assign.status === 'READY')) {
    // 1. Tự động giải phóng các active assignment khác bị kẹt của KTV này trong ngày
    const { data: activeAssigns } = await supabase
        .from('KtvAssignments')
        .select('id, booking_id')
        .eq('employee_id', technicianCode)
        .eq('business_date', today)
        .eq('status', 'ACTIVE')
        .neq('booking_id', bookingId);
    
    if (activeAssigns && activeAssigns.length > 0) {
        const activeBookingIds = activeAssigns.map(a => a.booking_id);
        await supabase
            .from('KtvAssignments')
            .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
            .in('id', activeAssigns.map(a => a.id));
        
        console.log(`[KTV API] Auto-completed prior active assignments for KTV ${technicianCode} on bookings: ${activeBookingIds.join(', ')}`);
    }

    // 2. Kích hoạt assignment của đơn mới thành ACTIVE
    await supabase
        .from('KtvAssignments')
        .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
        .eq('id', assign.id);
    
    console.log(`[KTV API] Auto-activated assignment for KTV ${technicianCode} on booking ${bookingId}`);

    // 3. Đồng bộ thông tin đơn mới sang TurnQueue
    const { data: currentTurn } = await supabase
        .from('TurnQueue')
        .select('status')
        .eq('employee_id', technicianCode)
        .eq('date', today)
        .maybeSingle();

    const newStatus = (currentTurn?.status === 'off') ? 'off' : 'assigned';

    await supabase
        .from('TurnQueue')
        .update({
            status: newStatus,
            current_order_id: bookingId,
            booking_item_id: assign.booking_item_id,
            booking_item_ids: assign.booking_item_id ? [assign.booking_item_id] : [],
            room_id: assign.room_id,
            bed_id: assign.bed_id,
            start_time: null,
            estimated_end_time: null,
            updated_at: new Date().toISOString()
        })
        .eq('employee_id', technicianCode)
        .eq('date', today);
    
    console.log(`[KTV API] Synced TurnQueue for KTV ${technicianCode} to new booking ${bookingId}`);
}
```

---

## 🧪 Kế hoạch kiểm thử (Verification Plan)

### Kiểm thử thủ công:
1. Giả lập một KTV có assignment cũ ở trạng thái `ACTIVE`.
2. Tạo một assignment mới ở trạng thái `QUEUED` cho KTV đó.
3. Gọi API GET `/api/ktv/booking?techCode=<techCode>&bookingId=<bookingIdMới>` để giả lập KTV mở đơn mới.
4. Kiểm tra trong database:
   - Assignment cũ phải chuyển sang `COMPLETED`.
   - Assignment mới phải chuyển sang `ACTIVE`.
   - Bảng `TurnQueue` của KTV đó phải cập nhật `current_order_id` thành ID của đơn mới và `status` thành `assigned`.
5. Tiếp tục gọi API PATCH `/api/ktv/booking` với action `START_TIMER` của đơn mới.
6. Kiểm tra bảng `TurnQueue`: trạng thái của KTV trong `TurnQueue` phải chuyển thành `working` và thời gian bắt đầu được cập nhật chính xác.
