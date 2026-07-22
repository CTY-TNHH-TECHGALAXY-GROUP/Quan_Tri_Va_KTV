# Kế hoạch sửa lỗi hiển thị/tính toán nhầm ca làm việc khi KTV đổi ca trước cho ngày mai

## Nguyên nhân gốc rễ (Root Cause)
1. KTV `NH021` đăng ký đổi ca làm việc cho ngày mai (`2026-06-05`) từ lúc 18h chiều nay (`2026-06-04`).
2. Hệ thống xử lý bằng cách chuyển ca hiện tại hôm nay (`SHIFT_2`, ca gốc) thành trạng thái `REPLACED` và chèn một bản ghi ca mới (`SHIFT_3`) cho ngày mai ở trạng thái `ACTIVE`.
3. Tuy nhiên, các API lấy ca hiện tại của KTV (để hiển thị trên app cá nhân hoặc tính toán số dư ví realtime) lại query ca trong bảng `KTVShifts` bằng điều kiện đơn giản `.eq('status', 'ACTIVE')` mà không kiểm tra ngày có hiệu lực `effectiveFrom`.
4. Kết quả là, từ lúc 18h chiều nay, hệ thống đã lấy nhầm ca `SHIFT_3` (ca 3, tan lúc 00h) làm ca làm việc hiện tại của KTV `NH021` cho ngày hôm nay, dẫn đến việc app KTV hiển thị thời gian ca kéo dài đến 00h mới tan ca thay vì ca 2 (tan lúc 19:00).

## Giải pháp đề xuất
Cập nhật các API lấy ca hiện tại để chỉ lấy ca có hiệu lực tại ngày đang xem (ngày business hiện tại):
- Lấy các bản ghi ca có `effectiveFrom <= businessDate` (hoặc `todayStr`) và ở trạng thái `ACTIVE` hoặc `REPLACED`.
- Sắp xếp giảm dần theo `effectiveFrom` và `createdAt` để lấy bản ghi mới nhất.
- Tránh lỗi lấy nhầm ca đăng ký cho tương lai.

## Chi tiết thay đổi

### 1. [app/api/ktv/shift/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/shift/route.ts)
Sửa logic lấy `activeShift` cho cá nhân KTV (dòng 171-177):
```typescript
            // Thay vì:
            // let { data: activeShift, error: activeError } = await supabase
            //     .from('KTVShifts')
            //     .select('*')
            //     .eq('employeeId', employeeId)
            //     .eq('status', 'ACTIVE')
            //     .maybeSingle();

            // Sửa thành:
            let { data: shifts, error: activeError } = await supabase
                .from('KTVShifts')
                .select('*')
                .eq('employeeId', employeeId)
                .lte('effectiveFrom', businessDateStr)
                .in('status', ['ACTIVE', 'REPLACED'])
                .order('effectiveFrom', { ascending: false })
                .order('createdAt', { ascending: false });

            let activeShift = null;
            if (shifts && shifts.length > 0) {
                activeShift = shifts[0];
            }
```
Và bọc logic auto-revert ca tạm thời (dòng 183) với điều kiện chỉ revert khi ca đó đang `ACTIVE`:
```typescript
            // Chỉ auto-revert nếu ca đó thực sự đang ACTIVE
            if (activeShift && activeShift.status === 'ACTIVE') {
```

### 2. [app/api/ktv/wallet/balance/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/wallet/balance/route.ts)
Sửa logic lấy ca tính thưởng realtime cho hôm nay (dòng 143-149):
```typescript
        // Thay vì:
        // const { data: shiftsData } = await supabase
        //     .from('KTVShifts')
        //     .select('shiftType')
        //     .eq('employeeId', techCode)
        //     .eq('status', 'ACTIVE')
        //     .order('effectiveFrom', { ascending: false })
        //     .limit(1);

        // Sửa thành:
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('shiftType, effectiveFrom')
            .eq('employeeId', techCode)
            .lte('effectiveFrom', todayStr)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: false })
            .order('createdAt', { ascending: false })
            .limit(1);
```

## Verification Plan
1. Tải lại giao diện app cá nhân của KTV `NH021` (ở ngày hôm nay `2026-06-04`) -> Phải hiển thị ca 2 (tan lúc 19:00) thay vì ca 3 (tan lúc 00:00).
2. Kiểm tra giao diện chốt ca/Ví bonus của KTV `NH021` hôm nay -> Phải tính theo ca 2.
3. Không làm ảnh hưởng đến đăng ký ca cho ngày mai (ngày mai `2026-06-05` vẫn tự động kích hoạt ca 3 chính xác).
