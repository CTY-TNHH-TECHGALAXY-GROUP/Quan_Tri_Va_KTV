# Bộ kiểm thử QA — 6 hạng mục vận hành

Chạy cả bộ:

```bash
npm run test:qa
```

Chạy riêng một hạng mục:

```bash
npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_01_03_hours_sort.ts
```

`qa_01_03_hours_sort.ts` nhận thêm tham số tháng: `... qa_01_03_hours_sort.ts 2026-08`.

## Các kịch bản

| File | Hạng mục | Đụng DB? |
|---|---|---|
| `qa_01_03_hours_sort.ts` | #1 Office Sort đúng chuẩn · #3 Bảng xếp hạng giờ tích lũy với đơn thật | Chỉ đọc |
| `qa_02_deduct_workdate.ts` | #2 Trừ điểm đúng ngày phát sinh vi phạm | Ghi rồi xoá (phiếu ngày 2020-01-15/16) |
| `qa_04_multi_service_order.ts` | #4 Một đơn nhiều dịch vụ, nhận/từ chối từng cái | Ghi rồi xoá (đơn `QA-MULTI-04`) |
| `qa_05_skip_limit.ts` | #5 Giới hạn bỏ qua dọn phòng lần thứ 3 | Ghi rồi xoá (đơn `QA-SKIP-05`) |
| `qa_06_feature_flags.ts` | #6 Bật/tắt riêng từng tính năng, không ảnh hưởng chéo | Chỉ đọc |

## Quy ước

- **Dọn sạch là bắt buộc.** Mọi kịch bản có ghi DB đều xoá trong `finally`, kể cả
  khi assert fail giữa chừng. Dữ liệu QA dùng id cố định tiền tố
  `00000000-0000-4000-8000-...` và mã bill `QA-*` để nhận ra ngay nếu còn sót.
- **Không tự chế lại công thức.** Kịch bản gọi thẳng service thật
  (`KtvOfficeScoreService`, `HandoverService`, `KtvOrderTargetService`…). Chép tay
  công thức vào test là test đi kiểm tra bản chép, không kiểm tra sản phẩm.
- **Chuẩn sắp xếp gốc** là `KtvTypeDTurnService.getTurnQueue` — cái quyết định
  thứ tự nhận tua thật: `net_hours DESC → check_in_order ASC → employee_id ASC`.
  Mọi bảng xếp hạng khác phải khớp với nó.
- Kịch bản có nhánh chỉ lộ ra trong khung 00:00–06:00 (mốc cắt ngày làm việc) thì
  **đóng băng đồng hồ** để mô phỏng, không chờ tới 2h sáng mới chạy được.
