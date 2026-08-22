---
description: Tạo API route mới trong Next.js App Router với Supabase (Chuẩn S.O.L.I.D - Service Layer)
---

# 🔌 Tạo API Route Mới (Chuẩn S.O.L.I.D)

> **Trigger**: Khi cần endpoint mới để xử lý nghiệp vụ hoặc CRUD data từ Supabase.
> **Quy tắc cốt lõi (S.O.L.I.D - Single Responsibility)**: TUYỆT ĐỐI KHÔNG viết trực tiếp câu lệnh truy vấn Supabase (`supabase.from...`) hoặc logic nghiệp vụ phức tạp vào trong file `route.ts`. Phải tách thành tầng Service.

## Bước 1: Xác nhận thông tin

- **Resource name**: VD `bookings`, `customers`, `services`
- **Methods cần**: GET / POST / PUT / PATCH / DELETE
- **Cần authentication?** (hầu hết là CÓ)
- **Mức độ phức tạp**: Nếu chỉ là CRUD rất đơn giản (1 bảng) -> có thể viết nhanh. Nếu đụng chạm nhiều bảng hoặc có logic nghiệp vụ (VD: điểm danh, tính toán, bắn sự kiện) -> **Bắt buộc dùng Service Layer**.

## Bước 2: Naming convention & Cấu trúc thư mục

```
app/api/[resource-name]/route.ts                # Controller: Chỉ nhận Request và trả Response
app/api/[resource-name]/[resource]Service.ts    # Service: Chứa Business Logic và gọi Supabase
```

Ví dụ:
```
app/api/attendance/route.ts                     # Nhận HTTP Request
app/api/attendance/AttendanceService.ts         # Xử lý logic điểm danh
```

## Bước 3: Template — Service Layer (Tầng Nghiệp vụ)

Tạo file Service trước để xử lý toàn bộ logic:

```typescript
// app/api/[resource]/[Resource]Service.ts
import { createClient } from '@/lib/supabase';

export class ResourceService {
  /**
   * Ví dụ hàm lấy danh sách (GET)
   */
  static async getList(page: number, limit: number) {
    const supabase = createClient();
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('[table_name]')
      .select('*', { count: 'exact' })
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return { data, total: count, page, limit };
  }

  /**
   * Ví dụ hàm xử lý nghiệp vụ tạo mới (POST)
   */
  static async createItem(body: any, currentUserRole: string) {
    const supabase = createClient();

    // 1. Validate / Kiểm tra phân quyền (Role Check)
    if (currentUserRole !== 'ADMIN' && currentUserRole !== 'TECHNICIAN') {
        throw new Error('Bạn không có quyền thực hiện hành động này');
    }

    // 2. Logic nghiệp vụ (Tính toán, filter...)
    // ...

    // 3. Gọi Database
    const { data, error } = await supabase
      .from('[table_name]')
      .insert(body)
      .select()
      .single();

    if (error) throw new Error(error.message);
    
    // 4. (Tương lai) Phát ra sự kiện (Event Driven) nếu cần
    // EventEmitter.emit('ITEM_CREATED', data);

    return data;
  }
}
```

## Bước 4: Template — Controller (Tầng Giao tiếp HTTP)

File `route.ts` giờ đây cực kỳ mỏng và sạch sẽ, chỉ đóng vai trò "Người chuyển phát":

```typescript
// app/api/[resource]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ResourceService } from './[Resource]Service';
import { useAuth } from '@/lib/hooks/useAuth'; // Hoặc middleware lấy user session

// GET — List all
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Gọi tầng Service
    const result = await ResourceService.getList(page, limit);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[GET /api/[resource]]:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — Create new
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Giả lập lấy role của user đang request (nếu cần)
    const userRole = 'ADMIN'; 

    // Gọi tầng Service xử lý toàn bộ logic nặng
    const data = await ResourceService.createItem(body, userRole);

    return NextResponse.json({ data }, { status: 201 });
  } catch (error: any) {
    console.error('[POST /api/[resource]]:', error.message);
    // Tùy biến mã lỗi dựa theo loại Error nếu cần
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
```

## Bước 5: Checklist cuối cùng

- [ ] Route.ts đã hoàn toàn "sạch bóng" logic tính toán và lệnh `supabase.from()` chưa?
- [ ] Mọi nghiệp vụ có phụ thuộc vào Role (vai trò) đã được check kỹ trong Service chưa?
- [ ] Error handling: try/catch + ném Error từ Service ra Route.ts để trả về HTTP status code phù hợp.
- [ ] Types: Định nghĩa request/response types trong `lib/types.ts`
- [ ] KHÔNG hardcode Supabase URL/Key — dùng `createClient()`

## Bước 6: Thông báo user

> *"API route `/api/[resource]` đã được tạo theo mô hình Service Layer (S.O.L.I.D). Hãy kiểm tra và commit:*
> *`feat: thêm API [resource] với kiến trúc Service`"*
