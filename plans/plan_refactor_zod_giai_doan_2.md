# Kế hoạch Refactor API bằng Zod (Giai đoạn 2)

Tiếp tục hành trình chuẩn hóa API, trong Giai đoạn 2 này chúng ta sẽ tập trung vào nhóm **Admin Config** và **CRM (Khách hàng & Phòng)**.

## Proposed Changes

---

### [NEW] `lib/schemas/admin.schema.ts`
Tạo file chứa các quy tắc dành cho Admin:
- **SystemSettingSchema:** Cập nhật các cấu hình biến hệ thống.
- **StaffFeatureSchema:** Phân quyền tính năng nhân viên.
- **WifiIpSchema:** Cấu hình IP Wi-Fi.

### [NEW] `lib/schemas/crm.schema.ts`
Tạo file chứa các quy tắc dành cho Khách hàng & Phòng:
- **RoomPatchSchema:** Kiểm tra khi update config phòng (`roomId`, `prep_procedure`, `clean_procedure`).
- **CustomerPatchSchema:** Kiểm tra ghi chú khách hàng (`id`, `notes`).

### [NEW] `lib/schemas/finance.schema.ts`
Tạo file cho mảng Tài chính:
- **WithdrawalSchema:** Rút tiền.
- **PayrollOverrideSchema:** Ghi đè lương.

---

### Refactor API Controllers
Sửa lại các endpoint tương ứng bằng mẫu (pattern) chuẩn của Zod:
```typescript
const parseResult = Schema.safeParse(body);
if (!parseResult.success) {
    return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
}
```

#### [MODIFY] Nhóm Admin
- `app/api/admin/settings/system/route.ts`
- `app/api/admin/settings/system/advanced/route.ts`
- `app/api/admin/staff-features/route.ts`
- `app/api/admin/update-wifi-ip/route.ts`

#### [MODIFY] Nhóm CRM
- `app/api/rooms/route.ts`
- `app/api/customers/route.ts`

#### [MODIFY] Nhóm Finance
- `app/api/finance/payroll/override/route.ts`
- `app/api/finance/withdrawals/[id]/route.ts`
