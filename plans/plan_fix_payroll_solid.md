# Kế hoạch sửa lỗi tính Lương & Bảng chấm công (Chuẩn SOLID)

## Phân tích hiện trạng & Hướng giải quyết theo SOLID

Theo yêu cầu giữ vững kiến trúc phần mềm, đảm bảo Single Responsibility Principle (SRP) và Open-Closed Principle (OCP), các lỗi sẽ được sửa theo hướng sau:

1. **Lỗi tính phút đi trễ luôn bằng 0**:
   - **Nguyên nhân**: Dùng key `CA1` không khớp với database (`SHIFT_1`).
   - **Giải pháp SOLID**: `SHIFT_START_TIMES` (Data map) nằm riêng biệt trong `Payroll.logic.ts` hoặc có thể đẩy vào file config/i18n. Tạm thời chỉnh sửa chính xác các key thành `SHIFT_1`, `SHIFT_2`... đảm bảo logic không bị hard-code sai lệch.

2. **Lỗi cộng dồn Ngày nghỉ có phép ảo (Tương lai)**:
   - **Nguyên nhân**: Các ngày lớn hơn hiện tại bị gán `off`.
   - **Giải pháp SOLID (SRP)**: Logic hook (`Payroll.logic.ts`) chỉ có trách nhiệm xử lý dữ liệu hợp lệ. Việc chặn các ngày tương lai ngay từ khâu sinh danh sách (`processedData`) đảm bảo UI không phải viết thêm logic IF/ELSE để ẩn chúng đi. (Data layer sạch).

3. **Hiển thị thô cột "Ca đăng ký" (UI)**:
   - **Nguyên nhân**: Bê nguyên value `SHIFT_1` từ DB lên UI.
   - **Giải pháp SOLID (OCP & SRP)**: Cập nhật file `Payroll.i18n.ts` (Text Dictionary) để chứa bản dịch của các ca làm việc. UI (`Payroll.tsx`) chỉ gọi `t[lang].shifts[row.shiftType]`, tránh viết các biểu thức ternary lồng nhau (`shiftType === 'SHIFT_1' ? ...`) trực tiếp trong View.

---

## Chi tiết chỉnh sửa:

### 1. File `Payroll.i18n.ts`
Thêm cấu hình dịch cho ca làm việc:
```typescript
shifts: {
    SHIFT_1: 'Ca 1',
    SHIFT_2: 'Ca 2',
    SHIFT_3: 'Ca 3',
    FREE: 'Ca Tự Do',
    REQUEST: 'Làm Yêu Cầu',
    OFF: 'OFF'
}
```

### 2. File `Payroll.logic.ts`
Cập nhật config giờ:
```typescript
const SHIFT_START_TIMES: Record<string, string> = {
  'SHIFT_1': '09:00',
  'SHIFT_2': '11:00',
  'SHIFT_3': '17:00',
  'FREE': '09:00',
  'REQUEST': '09:00',
};
```
Và thêm bộ lọc:
```typescript
if (day > new Date()) {
    return; // Skip future dates in eachDayOfInterval loop
}
```

### 3. File `Payroll.tsx`
Render cột Ca:
```tsx
<span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${row.shiftType === 'OFF' ? 'bg-slate-50 text-slate-400' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
    {t[lang].shifts[row.shiftType] || row.shiftType}
</span>
```
