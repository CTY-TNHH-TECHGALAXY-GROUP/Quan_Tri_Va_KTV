# Kế hoạch sửa lỗi biên dịch Supabase Types (supabase_types.ts)

## Nguyên nhân gốc rễ (Root Cause)
Trong file `supabase_types.ts` trên repo (commit `148d26d`), khi định nghĩa enum `Role` được cập nhật thêm các quyền `"SUPPORT"` và `"LEAD_RECEPTIONIST"`, do lỗi cú pháp nên các dòng này đã bị đặt ngoài dấu ngoặc nhọn đóng `}` của block `Enums`. 

Cụ thể, kiểu `Database["public"]["Enums"]` bị hiểu sai thành:
```typescript
type Enums = {
  BookingStatus: "COMPLETED" | "DONE" | "FEEDBACK" | "CANCELLED" | "PREPARING" | "IN_PROGRESS" | "NEW"
  Role: "TECHNICIAN" | "ADMIN" | "MANAGER" | "RECEPTIONIST"
}
| "SUPPORT"
| "LEAD_RECEPTIONIST"
```
Do đó, khi các file code khác truy cập `Database["public"]["Enums"]["BookingStatus"]` (dòng 155), TypeScript báo lỗi vì kiểu union ngoài cùng chứa chuỗi `"SUPPORT"` và `"LEAD_RECEPTIONIST"`, vốn không có thuộc tính `BookingStatus`.

## Trạng thái hiện tại ở Local
Ở local workspace, file `supabase_types.ts` hiện tại **đã được sửa đúng cú pháp** (đưa `"SUPPORT"` và `"LEAD_RECEPTIONIST"` vào bên trong block `Enums` và gộp đúng vào enum `Role`). 
Chúng tôi đã chạy thử `npm run build` ở local và hệ thống đã vượt qua bước kiểm tra kiểu (Type check) thành công.

## Đề xuất điều chỉnh & Kế hoạch thực hiện
Để đảm bảo tính tường minh của cú pháp và tránh các lỗi phân tích cú pháp (parsing) của TypeScript trong tương lai, chúng ta sẽ thực hiện các bước sau:

1. **Chuẩn hóa cú pháp (Formatting)**:
   Thêm dấu chấm phẩy `;` rõ ràng để ngăn cách giữa các thuộc tính `BookingStatus` và `Role` trong literal type `Enums` tại file `supabase_types.ts`.
   
2. **Commit và đẩy code lên repo**:
   Commit file `supabase_types.ts` và gợi ý thông điệp commit theo chuẩn Conventional Commits.

---

## Chi tiết thay đổi đề xuất

### 1. File `supabase_types.ts`

#### [MODIFY] `supabase_types.ts`
Thêm dấu chấm phẩy `;` vào sau giá trị cuối cùng của mỗi enum trong block `Enums`:

```diff
     Enums: {
       BookingStatus:
         | "NEW"
         | "IN_PROGRESS"
         | "DONE"
         | "CANCELLED"
         | "PREPARING"
         | "COMPLETED"
-        | "FEEDBACK"
+        | "FEEDBACK";
       Role:
         | "ADMIN"
         | "MANAGER"
         | "RECEPTIONIST"
         | "TECHNICIAN"
         | "SUPPORT"
-        | "LEAD_RECEPTIONIST"
+        | "LEAD_RECEPTIONIST";
     }
```

---

## Kế hoạch Xác minh (Verification Plan)

### Kiểm tra tự động
- Chạy lại kiểm tra kiểu bằng typescript local:
  ```bash
  npx tsc supabase_types.ts --noEmit
  ```
- Hoặc kiểm tra Next.js build local hoàn tất (đang chạy và sắp xong):
  ```bash
  npm run build
  ```

### Kiểm tra thủ công
- Gửi commit lên để Vercel build lại trên GitHub PR / Deployments.
