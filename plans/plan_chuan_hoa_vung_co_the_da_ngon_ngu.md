# Kế hoạch Chuẩn hoá & Đa Ngôn Ngữ Vùng Cơ Thể & Yêu Cầu Khách (EN, CN, JP, KR -> VN)

## 1. Mục tiêu
Chuẩn hoá việc dịch toàn bộ các vùng cơ thể (đặc biệt là Đầu gối `Knee`, `膝盖`, `膝`, `무릎` -> `Đầu gối`) và nhận diện Toàn thân (`Full Body`, `Whole Body`, `全身`, `전신` -> `Toàn thân` hoặc khi chọn >= 8 vùng) cũng như Lực massage từ các ngôn ngữ quốc tế (EN, CN, JP, KR) sang Tiếng Việt cho toàn bộ hệ thống nội bộ (KTV Dashboard, Bảng điều phối tiếp tân, Web Booking, API).

## 2. Bảng Tra Cứu Đa Ngôn Ngữ

| Vị trí (VN) | ID Hệ Thống | Tiếng Anh (EN) | Tiếng Trung (CN) | Tiếng Nhật (JP) | Tiếng Hàn (KR) |
|---|---|---|---|---|---|
| **Toàn thân** | `WHOLE_BODY` / `FULL_BODY` | Whole Body, Full Body | 全身 | 全身 | 전신, 전체 |
| **Đầu** | `HEAD` | Head | 头部, 头 | 頭, 頭部 | 머리, 두피 |
| **Cổ** | `NECK` | Neck | 颈部, 脖子, 颈 | 首, 首筋 | 목 |
| **Vai** | `SHOULDER` | Shoulder, Shoulders | 肩部, 肩膀, 肩 | 肩 | 어깨 |
| **Tay** | `ARM` | Arm, Arms | 手臂, 手, 臂 | 腕, 手 | 팔 |
| **Lưng** | `BACK` | Back | 背部, 背 | 背中, 背 | 등, 허리 |
| **Đùi** | `THIGH` | Thigh, Thighs | 大腿 | 太もも, 太腿, もも | 허벅지 |
| **Đầu gối** | `KNEE` | Knee, Knees | 膝盖, 膝 | 膝, ひざ | 무릎 |
| **Bắp chân** | `CALF` | Calf, Calves | 小腿 | ふくらはぎ, 脹脛 | 종아리 |
| **Bàn chân** | `FOOT` | Foot, Feet | 脚部, 脚, 足 | 足, 足裏, 脚 | 발, 발바닥 |

## 3. Lực Massage (Strength)
- **Nhẹ**: `Light`, `Soft`, `轻轻`, `轻`, `柔和`, `弱め`, `弱い`, `약`, `약하게`
- **Vừa**: `Medium`, `Normal`, `Moderate`, `适中`, `中等`, `中`, `普通`, `보통`
- **Mạnh**: `Strong`, `Hard`, `Firm`, `用力`, `强`, `重`, `強め`, `強い`, `강`, `강하게`

## 4. Các file triển khai
1. `lib/booking.logic.ts`: Thêm `BODY_PART_MAP`, `STRENGTH_MAP`, `formatBodyAreas(raw)`, `normalizeStrength(raw)`.
2. `app/api/ktv/booking/_handlers/handleGetBooking.ts`: Áp dụng `formatBodyAreas` cho focus/avoid và `normalizeStrength` cho strength.
3. `app/reception/dispatch/useDispatchBoard.logic.ts`: Áp dụng `formatBodyAreas` và `normalizeStrength`.
4. `app/reception/dispatch/_components/DispatchStaffRow.tsx`: Dùng `formatBodyAreas(focus)`, hiển thị `Toàn thân` thay vì `Full Body`.
5. `app/reception/dispatch/_components/QuickDispatchTable.tsx`: Dùng `formatBodyAreas(customerReqs.focus)`, hiển thị `Toàn thân` thay vì `Full Body`.
6. `app/reception/web-booking/WebBookingCard.tsx`: Dùng `formatBodyAreas` & `normalizeStrength`.
7. `app/reception/web-booking/WebBookingDetailPanel.tsx`: Dùng `formatBodyAreas` & `normalizeStrength`.
8. `app/ktv/dashboard/page.tsx`: Dùng `formatBodyAreas` & `normalizeStrength`.
