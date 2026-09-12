# Kế hoạch sửa lỗi tính điểm thưởng (Bonus Points) KTV không khớp với ca làm việc

## 1. Nguyên nhân gốc rễ (Root Cause)
1. **Lỗi lấy ca hiện tại (`status = ACTIVE`) thay vì ca lịch sử:** Trong các API báo cáo tài chính (`/api/finance/ktv-bonus-summary` và `/api/finance/ktv-summary`), hệ thống chỉ truy vấn các ca của KTV có `status = 'ACTIVE'` (tức là ca hiện tại của hôm nay). Khi KTV thay đổi ca trong ngày hôm nay, các dữ liệu tính toán realtime của ngày hôm qua (hoặc các ngày trước chưa chốt sổ) sẽ bị tính sai theo ca mới của hôm nay.
2. **Lỗi so sánh ngày trong Javascript:** Ở các API ví KTV (`/api/ktv/wallet/bonus/timeline`, `/api/ktv/wallet/bonus/balance`, `/api/ktv/wallet/balance`, `/api/ktv/history`), phép so sánh `s.effectiveFrom <= todayStr` được thực hiện trực tiếp trên chuỗi. `s.effectiveFrom` đôi khi có thể chứa giờ hoặc định dạng ISO đầy đủ, dẫn đến phép so sánh chuỗi trong Javascript bị sai lệch (ví dụ: `"2026-06-05T00:00:00+00:00" <= "2026-06-05"` trả về `false`).

## 2. Giải pháp đề xuất
Chúng ta sẽ chuẩn hóa việc lấy ca làm việc của KTV theo ngày cụ thể của đơn hàng (booking) và sửa phép so sánh chuỗi ngày bằng cách cắt chuỗi lấy 10 ký tự đầu (`YYYY-MM-DD`).

### Các file cần chỉnh sửa:
1. [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/finance/ktv-bonus-summary/route.ts)
   - Lấy toàn bộ ca `ACTIVE` và `REPLACED` của KTV.
   - Khi duyệt qua các booking realtime để tính bonus, tìm ca của KTV tương ứng với ngày của đơn hàng đó (`b.timeStart.slice(0, 10)`).
2. [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/finance/ktv-summary/route.ts)
   - Tương tự như trên, lấy ca lịch sử và xác định ca của KTV theo ngày của booking.
3. [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/wallet/bonus/timeline/route.ts)
   - Chuẩn hóa phép so sánh ngày: `s.effectiveFrom.slice(0, 10) <= todayStr`.
4. [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/wallet/bonus/balance/route.ts)
   - Chuẩn hóa phép so sánh ngày: `s.effectiveFrom.slice(0, 10) <= todayStr`.
5. [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/wallet/balance/route.ts)
   - Tìm ca của KTV theo ngày của từng booking realtime cụ thể, thay vì dùng chung ca của ngày hôm nay cho tất cả các booking realtime.
6. [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/history/route.ts)
   - Chuẩn hóa phép so sánh ngày: `s.effectiveFrom.slice(0, 10) <= dateStr`.

---

## 3. Chi tiết thay đổi đề xuất

### 1. `app/api/finance/ktv-bonus-summary/route.ts`
- Truy vấn shifts:
```typescript
        // Fetch KTV shifts to determine bonus per KTV
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('employeeId, shiftType, effectiveFrom')
            .in('employeeId', staffIds)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });
```
- Khi tính toán realtime bookings:
```typescript
                if (totalUniqueKTVs > 0) {
                    const bookingDateStr = b.timeStart ? b.timeStart.slice(0, 10) : todayStr;
                    allKtvCodes.forEach(techCode => {
                        const sId = staffIds.find(id => id.toLowerCase() === techCode);
                        if (sId && statsMap[sId]) {
                            let currentShift = 'SHIFT_1';
                            const ktvShifts = (shiftsData || []).filter(s => s.employeeId === sId);
                            for (const s of ktvShifts) {
                                const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                                if (effDate && effDate <= bookingDateStr) {
                                    currentShift = s.shiftType;
                                }
                            }
                            
                            let basePoints = s1Bonus;
                            if (currentShift === 'SHIFT_2') basePoints = s2Bonus;
                            else if (currentShift === 'SHIFT_3') basePoints = s3Bonus;

                            if (totalDuration < 60) basePoints = Math.floor(basePoints / 2);
                            const bonusPts = Math.floor(basePoints / totalUniqueKTVs);
                            statsMap[sId].totalEarned += bonusPts;
                        }
                    });
                }
```

### 2. `app/api/finance/ktv-summary/route.ts`
- Thay đổi tương tự như trên khi truy vấn và ánh xạ ca của KTV cho từng booking realtime.

### 3. `app/api/ktv/wallet/bonus/timeline/route.ts` & `balance/route.ts`
- Chuẩn hóa vòng lặp xác định ca:
```typescript
        let currentShift = 'SHIFT_1';
        for (const s of (shiftsData || [])) {
            const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
            if (effDate && effDate <= todayStr) currentShift = s.shiftType;
        }
```

### 4. `app/api/ktv/wallet/balance/route.ts`
- Ánh xạ ca KTV theo ngày của booking:
```typescript
            if (bookingRating >= 4) {
                const bookingDateStr = b.timeStart ? b.timeStart.slice(0, 10) : todayStr;
                let currentShift = 'SHIFT_1';
                for (const s of (shiftsData || [])) {
                    const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                    if (effDate && effDate <= bookingDateStr) {
                        currentShift = s.shiftType;
                    }
                }
                
                let adjustedBasePoints = s1Bonus;
                if (currentShift === 'SHIFT_2') adjustedBasePoints = s2Bonus;
                else if (currentShift === 'SHIFT_3') adjustedBasePoints = s3Bonus;

                if (totalDuration < 60) {
                    adjustedBasePoints = adjustedBasePoints / 2;
                }
                
                // ... tính toán unique KTVs và cộng rt_bonus
```

### 5. `app/api/ktv/history/route.ts`
- Sửa phần so sánh ngày:
```typescript
            let activeForDate = currentShift;
            for (const s of (shiftsData || [])) {
                const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                if (effDate && effDate <= dateStr) {
                    activeForDate = s.shiftType;
                }
            }
```

---

## 4. Kế hoạch kiểm thử (Verification Plan)
1. **Kiểm thử tự động / chạy mô phỏng:** Sử dụng lại script `scratch_test_apis.js` để chạy mô phỏng các API sau khi chỉnh sửa, đảm bảo NH018 nhận được đúng 6đ cho đơn số 7 ngày 06-06, còn NH021 và NH025 nhận đúng 10đ.
2. **Kiểm tra biên (Edge Cases):**
   - Đảm bảo đổi ca của KTV hôm nay không làm thay đổi điểm thưởng realtime của các đơn ngày hôm qua.
   - Đảm bảo các ngày lễ (`isHoliday`) vẫn hoạt động bình thường và đè ca 2 thành công.
