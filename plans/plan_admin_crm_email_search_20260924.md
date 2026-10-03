# [Mức 1] Sửa tìm email trong Khách Hàng Admin — 24/09/2026

## Phạm vi đã chốt

Chỉ xử lý ô tìm kiếm trên `/reception/crm` của Admin. Người dùng xác nhận logic WRB đã cập nhật; báo cáo này **không đề xuất sửa WRB, gộp hồ sơ, sửa Booking hoặc thay đổi dữ liệu**. Nút ⓘ ở Điều phối và phân quyền API là hai việc riêng, không nằm trong diff CRM này.

## Bằng chứng hiện tại

| Môi trường | Giao diện/API | Kết quả |
|---|---|---|
| Production `admin-nganha.vercel.app` | Chrome: nhập `nghik22@gmail.com`, tất cả bộ lọc ở “Tất cả” | Hiện 0 khách, thông báo không tìm thấy. |
| Production | GET `/api/customers?q=nghik22%40gmail.com` không cookie | HTTP 200, **3.667** hồ sơ, **18.319 ms** trong lần đo lại. |
| Preview `feat/bit-lo-hong-phase1` | GET cùng `q` | HTTP 200, **47** hồ sơ, **843 ms** trong lần đo lại. |
| Preview | Chrome nhập email và mở một hồ sơ | Hiển thị 47 khách, modal chi tiết mở được. |
| Supabase chỉ đọc | Customers có email trên | 47 hồ sơ, 47 phone khác nhau; email không UNIQUE. |

Các con số thời gian có thể dao động theo mạng và tải DB. Không xuất tên, phone hoặc dữ liệu hồ sơ trong tài liệu này.

## Nguyên nhân gốc ở Admin Production

1. `origin/main:app/api/customers/route.ts` khai báo `GET()` và không đọc `request.url`; tham số `q` không có tác dụng. Mỗi lần mở CRM, API tải toàn bộ Customers và Bookings kèm BookingItems để tính chỉ số.
2. `origin/main:app/reception/crm/page.tsx` gọi `API.CUSTOMERS` **một lần** khi mount, rồi lọc email trong mảng client. Tìm kiếm phụ thuộc việc lần tải toàn bộ ban đầu thành công.
3. `lib/apiClient.ts` đặt timeout mặc định 15.000 ms. API Production đo đầu cuối 18.319 ms; khả năng request bị abort là cao. Khi fetch lỗi, trang Production chỉ ghi console, `customers` vẫn rỗng và UI hiển thị “Không tìm thấy khách hàng nào phù hợp” — đánh đồng lỗi tải với không có dữ liệu.

Đây là lỗi đường đọc của Admin, không phải bằng chứng hồ sơ bị xóa hay Supabase secret key không hoạt động: API Production vẫn trả đủ 3.667 hồ sơ. Email cùng xuất hiện ở nhiều hồ sơ cũng không phải nguyên nhân khiến ô tìm kiếm phải trả 0; Preview tìm được cả 47.

## Diff cụ thể cần port lên Production

Preview đã chứa bản sửa tại commit `4e29434d`. Chỉ port phần CRM từ ba file bên dưới, review từng hunk trên `origin/main`; không lấy thay đổi `dispatch/page.tsx` hay merge cả nhánh vì ngoài phạm vi.

| File | Production hiện tại | Diff đích theo Preview |
|---|---|---|
| `app/api/customers/route.ts` | `GET()` quét toàn bảng bất kể từ khóa | `GET(request)` đọc `q`/`id`; `q` lọc `Customers` tại DB theo email/tên/phone/MST/công ty; sau đó chỉ lấy Bookings của Customer ID đã khớp để tính thống kê. `q` không khớp trả `data: []`; lỗi tải Bookings trả lỗi thay vì hồ sơ thiếu chỉ số. |
| `lib/customer-search.ts` | Chưa có trong Production | Port `customerSearchFilter`, `matchesCustomerSearch`, `phoneSearchVariants`, `searchPattern`; bảo đảm escape ký tự `%`, `_` trong tìm kiếm. |
| `app/reception/crm/page.tsx` | Fetch một lần; lọc trên mảng có thể rỗng do lỗi tải; không hiện lỗi | Gửi `?q=<searchTerm>` sau debounce 300 ms; hủy kết quả request cũ bằng effect cleanup; hiện `loadError` và nút tải lại; chỉ hiện “không tìm thấy” sau response thành công với `data: []`. |

Hợp đồng request/response cần giữ:

```diff
- GET /api/customers          -> mọi khách, kể cả khi người dùng đang tìm email
+ GET /api/customers?q=email  -> chỉ các Customer khớp email
+ GET /api/customers?id=CUS…  -> đúng một Customer ID, phục vụ chi tiết
+ GET /api/customers?q=none   -> { success: true, data: [] }
+ DB/history error            -> lỗi rõ ràng, UI cho tải lại
```

Ở client, thay lời gọi mount-only bằng request phụ thuộc `searchTerm`:

```diff
- const data = await apiClient.get(API.CUSTOMERS);
- setCustomers(data.data || []);
- // catch: chỉ console.error, danh sách vẫn []
+ const query = new URLSearchParams({ q: searchTerm.trim() });
+ const data = await apiClient.get(`${API.CUSTOMERS}?${query}`, { timeout: 60000 });
+ if (!data.success) throw new Error(data.error || 'Không tải được khách hàng');
+ if (active) setCustomers(data.data || []);
+ // catch: setLoadError(...); phân biệt lỗi tải với không tìm thấy
```

Các đoạn trên là diff định hướng để review. Bản patch **đã được chuẩn bị riêng từ `origin/main`** là `plans/admin_crm_email_search_main_20260924.patch` (3 file, +175/-41). Commit `4e29434d` là nguồn hành vi đã chạy trên Preview; patch gốc của commit có thêm thay đổi Điều phối, nên không áp nguyên patch đó cho phạm vi lần này.

## Ảnh hưởng chéo KTV ↔ Quản lý

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Tìm Customer | Dashboard KTV không dùng CRM search này | `/reception/crm` và `/api/customers` | Bảng Customers/Bookings | Chỉ đổi đường đọc của Admin; không đổi đơn hay trạng thái KTV. |
| Tiền/tua/giờ | Ledger giữ nguyên | CRM tiếp tục dùng công thức thống kê hiện có | BookingItems/Bookings | Port đúng công thức hiện hành; không sửa số tiền/tua. |
| Refresh | KTV giữ nguyên | Tìm mới khi thay `q`, focus hoặc tải lại | API response | Không để response cũ ghi đè từ khóa mới. |
| Quyền xem | Không cấp quyền mới | Trang CRM có `customer_management` | Auth hiện hành | Vấn đề API không JWT đã phát hiện là hạng mục an ninh riêng Mức 2; cần xử lý khẩn, nhưng không trộn vào diff tìm kiếm. |

## Nghiệm thu

1. Production sau deploy: tìm chính xác `nghik22@gmail.com` trả 47 hồ sơ, không trả 3.667; UI hiện kết quả và số phân trang đúng.
2. Tìm email không tồn tại trả 0 và “Không tìm thấy”; lỗi mạng/DB hiển thị lỗi tải và nút thử lại, không giả thành 0.
3. Gõ nhanh hai từ khóa; chỉ kết quả của từ khóa cuối được hiển thị. Đổi bộ lọc, xóa từ khóa, quay lại tab vẫn trả dữ liệu đúng.
4. Kiểm số liệu và mở chi tiết một Customer trong 47 hồ sơ; không gộp các hồ sơ vì trùng email.
5. Typecheck/build Admin; so sánh response `q` và `id` giữa Production mới và Preview trước khi kết luận hoàn tất.

## Tiến độ sau khi người dùng yêu cầu bắt đầu sửa

- Đã áp diff vào worktree riêng `/private/tmp/admin-crm-email-search-20260924`, branch `fix/admin-crm-email-search-20260924`, gốc `origin/main` tại `ef8c70e4`; không chạm workspace Preview đang có thay đổi khác.
- Đã loại phần thay đổi hiển thị tên KTV và các helper không dùng trong CRM. Diff cuối chỉ gồm `app/api/customers/route.ts`, `app/reception/crm/page.tsx`, `lib/customer-search.ts`.
- TypeScript `tsc --noEmit --incremental false`: qua. `npm run build`: qua khi có quyền mạng tải Google Fonts; lần chạy sandbox trước đó lỗi DNS fonts.googleapis.com, không phải lỗi code.
- API cục bộ dùng DB thật, chỉ đọc: `q=nghik22@gmail.com` → HTTP 200, 47 hồ sơ, 1.349 ms; từ khóa không tồn tại → 200, 0 hồ sơ, 670 ms; `id` mẫu → 200, 1 hồ sơ, 944 ms. `git diff --check` và `git apply --reverse --check` cho patch đều qua.
- Chưa commit, push hoặc deploy theo quy tắc Git của `CLAUDE.md`. Vì vậy Production đang chạy bản cũ; nghiệm thu giao diện Production tại mục trên chưa thể đánh dấu xong.

Vấn đề API Customers trả dữ liệu khi không có JWT vẫn là P0 riêng, đã được báo ở phân tích trước; không nên quên khi chuẩn bị phát hành.
