# Kế hoạch sửa lỗi hiển thị đánh đồng rating trên Kanban của quầy lễ tân

## Nguyên nhân gốc rễ (Root Cause)
1. Trong file `app/reception/dispatch/_components/dispatch-timeline.ts`, hàm `buildOrderTimeline` tính toán rating của từng card dịch vụ (`subOrderRating`). Nếu card của KTV cụ thể không có rating chi tiết (`subOrderRating === null`), hệ thống lại fallback về `order.rating` (Rating chung của Booking cha).
2. Ở `app/reception/dispatch/page.tsx`, `order.rating` lại được tính chắp vá: nếu Booking không có rating chung (`b.rating`) từ DB, hệ thống sẽ tự động quét và lấy `itemRating` của bất kỳ KTV nào trong đơn được đánh giá để gán làm `order.rating`.
3. Kết quả là, khi khách hàng đánh giá riêng biệt (ví dụ KTV `NH011` được 4 sao, KTV `NH021` không được đánh giá), `subOrderRating` của KTV `NH021` bị null và đã fallback về rating chắp vá của Booking (tức là 4 sao của `NH011`). Điều này làm hiển thị sai lệch trên Kanban của Quầy lễ tân (card của `NH021` vẫn hiện "Xuất sắc" / 4 sao).

## Giải pháp đề xuất
Chúng ta sẽ thay đổi cơ chế fallback rating của `SubOrder` trong `app/reception/dispatch/_components/dispatch-timeline.ts`:
- Chỉ cho phép card `SubOrder` fallback về `order.rating` nếu Booking đó **KHÔNG có bất kỳ đánh giá chi tiết cho dịch vụ/KTV nào** (tức là khách hàng thực sự đánh giá chung cho cả đơn hàng).
- Nếu Booking đó đã có ít nhất một dịch vụ được đánh giá chi tiết (tức là khách hàng đánh giá riêng biệt), thì KTV nào không được đánh giá sẽ giữ nguyên trạng thái `null` (hiển thị "Chờ khách..." hoặc không hiện rating) thay vì bị "đánh đồng" lấy rating của KTV khác.

## Chi tiết thay đổi

### 1. [app/reception/dispatch/_components/dispatch-timeline.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/_components/dispatch-timeline.ts)

#### [MODIFY] logic gán `subOrderRating` (cho card dịch vụ có KTV)
```typescript
            if (subOrderRating === null) {
                // Kiểm tra xem đơn có bất kỳ đánh giá chi tiết cho dịch vụ/KTV nào không
                const hasDetailedRating = order.services.some((svc: any) => 
                    svc.itemRating != null || 
                    (svc.ktvRatings && Object.keys(svc.ktvRatings).length > 0)
                );
                // Nếu KHÔNG có đánh giá chi tiết nào, ta mới fallback về rating chung của đơn hàng
                if (!hasDetailedRating) {
                    subOrderRating = order.rating ?? null;
                }
            }
```

#### [MODIFY] logic gán `utilityRating` (cho card dịch vụ tiện ích/phòng riêng)
```typescript
                if (utilityRating === null) {
                    const hasDetailedRating = order.services.some((svc: any) => 
                        svc.itemRating != null || 
                        (svc.ktvRatings && Object.keys(svc.ktvRatings).length > 0)
                    );
                    if (!hasDetailedRating) {
                        utilityRating = order.rating ?? null;
                    }
                }
```

## Verification Plan
1. Khởi động ứng dụng hoặc tải lại trang Dispatch Board (Điều phối/Giám sát đơn) của Lễ tân.
2. Kiểm tra đơn hàng `001-04062026`:
   - Thẻ card của `NH011` (Dịch vụ Dầu dừa): Hiển thị ⭐⭐⭐⭐ Xuất sắc.
   - Thẻ card của `NH021` (Dịch vụ Gói làm móng...): Phải hiển thị "Chờ khách..." hoặc không hiển thị sao (trống rating).
