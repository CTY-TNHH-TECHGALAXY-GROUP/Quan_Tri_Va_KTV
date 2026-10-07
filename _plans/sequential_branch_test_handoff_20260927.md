# Branch test nối tiếp A/B — hướng dẫn bàn giao

Branch: `feat/sequential-two-slot-handoff-20260926`. Nền trước sửa sâu: `bc06814f`.

## Đã thực hiện

- Áp patch runtime và migration mới vào branch test; không chỉ commit plan/patch.
- Giữ gán tay KTV ngoài, quota bỏ qua/nợ phòng và cơ chế B bắt đầu sớm đã duyệt.
- Thêm test regression trực tiếp trên source: `scripts/test_sequential_deep_fixes.cjs`.
- Thêm lệnh tổng: `node scripts/test_sequential_branch.cjs` gồm 14 script regression, dispatch live guard và TypeScript. Dừng ngay khi có lỗi.
- Cập nhật fixture START/RELEASE sang hợp đồng RPC atomic; child phụ trong fixture không chứa việc độc lập, thêm assertion riêng cho child có B chưa làm.
- Sửa thêm demo B→C→B: hàng mới đọc tên/ghi chú đã lưu theo đúng mã nhân viên, đồng bộ ô nhập và tên tài khoản. KTV mới chưa có metadata vẫn trống; quay lại người đã chỉnh thì giữ bản chỉnh của người đó.
- Không migrate DB dùng chung, không merge production. Patch đề xuất và audit trước sửa được giữ làm lịch sử; `audit_sequential_*_second.cjs` là tái hiện lỗi trên nền cũ, không phải gate regression bản mới.

## Test ngay bằng localStorage, chưa cần migrate

Trong checkout của branch, cài dependencies dự án, chạy `npm run dev`, mở:

```text
/reception/dispatch/sequential-demo
/reception/dispatch/sequential-demo?account=DEMO-A
/reception/dispatch/sequential-demo?account=DEMO-B
```

Mở admin/A/B trong 3 tab cùng browser profile. Dữ liệu demo dùng `localStorage[dispatch-sequential-demo-v2]`. Bảng này test tương tác/hiển thị; không xác minh DB transaction, trigger, quyền, Storage, realtime server hay push.

## Test source và SQL local

```sh
node scripts/test_sequential_branch.cjs
```

Các script cần `ts-node`, `tsconfig-paths`, alias `pglite-2` như môi trường kiểm hiện tại. Nếu máy test chỉ cài dependencies từ package.json và thiếu các công cụ test này, cài riêng bằng `npm install --no-save --package-lock=false` với các phiên bản ghi ở phần kết quả kiểm bên dưới. Các công cụ này không phải dependency runtime của bản sửa.

```sh
npm install --no-save --package-lock=false ts-node@10.9.2 tsconfig-paths@3.15.0 pglite-2@npm:@electric-sql/pglite@0.2.17
```

## Kết quả trước commit

`node scripts/test_sequential_branch.cjs`: **PASS toàn bộ 16 script + live guard + TypeScript** trên source đã áp sửa. `git diff --check`: PASS. Không dùng các script tái hiện lỗi lịch sử làm gate bản đã sửa.

Các file bản sao không được Git theo dõi có hậu tố ` 2.ts`/` 2.tsx` không thuộc danh sách sửa và không được đưa vào commit.

## Các bước còn lại để test flow thật

1. **Checkout đúng branch/commit** đã push. Chạy source regression trước khi mở môi trường thật.
2. **Chọn Supabase DB test cô lập** hoặc bản local có đủ schema. Thiết lập `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` và các cấu hình auth/storage theo môi trường test. Không lấy nhầm key DB đang vận hành.
3. **Đối chiếu migration history của DB test.** Chạy các migration còn thiếu theo thứ tự toàn chain. Riêng tính năng này có 5 migration:

   ```text
   20260925120000_live_sequential_handoff.sql
   20260926120000_dispatch_edit_history.sql
   20260926140000_ktv_finish_service_atomic.sql
   20260927120000_sequential_operational_consistency.sql
   20260927150000_sequential_scoped_lifecycle.sql
   ```

   DB trắng cần schema và các migration phụ thuộc trước đó; không chạy riêng 5 file này trên DB trắng. Dùng quy trình migration của project, xác nhận kết nối DB test trước khi thực thi. Reload schema cache sau migration nếu RPC chưa được nhận diện. Kiểm EXECUTE cho service_role; client không được gọi trực tiếp các RPC nội bộ mới.
4. **Tạo dữ liệu test:** tài khoản admin/A/B, mã Staff gồm KTV ngoài, phòng/giường, TurnQueue ngày service, booking và dịch vụ 60 phút. Cấu hình quota bỏ qua 2 cho ca nợ phòng; bucket ảnh và auth phải hoạt động trên DB test.
5. **Chạy build và app/Preview** với biến môi trường test. Push branch không đồng nghĩa migration đã chạy; thiếu RPC sẽ báo lỗi thay vì fallback ghi từng item. Preview tự động chỉ có nếu repository đã được kết nối deployment; chưa xác minh kết nối/URL Preview trong lượt commit.
6. **Nghiệm thu 5 flow:** A30/B30 từ mới; A full60→A30+B; A trước/B trống rồi gán sau; đổi B→C→B và sửa tên/giờ hai lần; nợ 2 phòng + nhận đơn mới + trả nợ cũ. Mỗi ca phải kiểm admin/A/B, refresh và lịch sử sửa.
7. **Gate kỹ thuật:** qua 0h/điều phối sớm, API lỗi, ảnh lỗi, timeout sau commit, stale revision, thao tác đồng thời, realtime/push. Chỉ đề nghị merge/migrate môi trường vận hành sau khi các gate này đạt.

## Giới hạn kiểm hiện tại

SQL local dùng PGlite và fixture; không thay thế kiểm concurrency nhiều connection với full schema/trigger trên PostgreSQL. Test UI local dùng component/hook/SSR và demo; không thay thế kiểm push hoặc hai thiết bị thật. Build/Preview gắn DB test và migrations DB thật là bước riêng sau commit.
