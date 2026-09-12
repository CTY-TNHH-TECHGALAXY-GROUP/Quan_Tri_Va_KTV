# Kế hoạch sửa lỗi hiển thị sai múi giờ (UTC vs Local) trên Vercel

## 1. 🔍 Nguyên nhân gốc rễ (Root Cause)
- Qua kiểm tra chi tiết, nguyên nhân khiến thời gian Lộ trình thực hiện hiển thị là `04:45` và `05:45` thay vì `11:45` và `12:45` là do sự khác biệt múi giờ giữa môi trường Local và Vercel.
- Khi người thứ 1 bấm bắt đầu, hệ thống tạo ra một mốc thời gian ISO (ví dụ: `2024-05-09T04:15:00.000Z` - là 11h15 giờ VN nhưng theo chuẩn UTC).
- Có một hàm lõi tên là `formatToHourMinute` và `getDynamicEndTime` đang parse chuỗi ISO UTC này thành `Date` object và gọi hàm `.getHours()` / `.getMinutes()`. 
- Ở **Local (Việt Nam)**, server chạy múi giờ địa phương (UTC+7), `.getHours()` trả về `11` -> Hiển thị đúng `11:15`.
- Khi up lên **Vercel**, server Node.js chạy ở múi giờ **UTC** mặc định. Hàm `.getHours()` trả về múi giờ server, tức là `4` -> Hiển thị sai thành `04:15`. Rồi KTV thứ 2 cộng 30 phút thành `04:45`. Lỗi này đồng bộ sai dữ liệu truyền cho Dashboard.

## 2. 🛠️ Giải pháp (Solution)
Để giải quyết vĩnh viễn và an toàn trước mọi loại lỗi liên quan đến múi giờ trên mọi môi trường (Local / Vercel), thay vì dùng `d.getHours()` (phụ thuộc môi trường), ta sẽ tự ép cộng 7 tiếng và dùng `.getUTCHours()` (tuyệt đối). Đối với việc cộng phút cho chặng tiếp theo, ta dùng toán học thủ công thay vì qua Date object.

**Chi tiết cần sửa:**
Cập nhật 2 hàm `formatToHourMinute` và `getDynamicEndTime` đang bị duplicate và sử dụng `.getHours()` ở 5 file sau:
1. `app/api/ktv/booking/route.ts`
2. `app/reception/dispatch/actions.ts`
3. `app/reception/dispatch/page.tsx`
4. `app/reception/dispatch/_components/dispatch-timeline.ts`
5. `app/reception/dispatch/_components/KanbanBoard.tsx`

**Logic mới của hàm `formatToHourMinute`:**
```typescript
const formatToHourMinute = (isoString: string | null | undefined): string => {
    if (!isoString) return '--:--';
    if (/^\d{1,2}:\d{2}$/.test(isoString)) return isoString;
    let parseString = isoString;
    if (!isoString.endsWith('Z') && !isoString.includes('+')) parseString = isoString.replace(' ', 'T') + 'Z';
    const d = new Date(parseString);
    if (isNaN(d.getTime())) return isoString;
    
    // Ép sang múi giờ VN (+7) và lấy giờ UTC tuyệt đối để an toàn trên mọi server
    const dVn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return `${String(dVn.getUTCHours()).padStart(2, '0')}:${String(dVn.getUTCMinutes()).padStart(2, '0')}`;
};
```

**Logic mới của hàm `getDynamicEndTime`:**
```typescript
const getDynamicEndTime = (startStr?: string | null, durationMins: number = 60) => {
    if (!startStr) return '--:--';
    const formatted = formatToHourMinute(startStr);
    if (formatted === '--:--') return '--:--';
    let [h, m] = formatted.split(':').map(Number);
    m += durationMins;
    h += Math.floor(m / 60);
    m = m % 60;
    h = h % 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
```

User hãy review và duyệt (OK) để tôi thực hiện replace content ở các file trên nhé.
