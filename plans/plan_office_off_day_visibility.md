# Kế hoạch chi tiết và Actual Diff: Sửa thẻ Office ngày OFF & Flow điểm danh OFF

> Kế hoạch toàn diện đã được gộp tại: [`plans/plan_attendance_off_office.md`](./plan_attendance_off_office.md)
> 
> Vui lòng xem chi tiết đầy đủ tại file [`plans/plan_attendance_off_office.md`](./plan_attendance_off_office.md), bao gồm:
> - P0: Chẩn đoán & xử lý timeout điểm danh ngày đi làm (ECONNRESET/aborted).
> - P1: Thẻ Office & Modal ngày OFF cho KTV Loại D (hiện "Hôm nay là OFF", tách effect độc lập, sửa bug modal fallback 100).
> - P2: OFF nhận tua → điểm danh bắt buộc nhập giờ tan làm (HH:mm), đồng bộ registration & attendance, hỗ trợ gia hạn ca.
> - Bảng khảo sát ảnh hưởng chéo KTV ↔ Quản lý theo CLAUDE.md §4.
> - Bảng hệ quả nghiệp vụ Spa theo CLAUDE.md §13 (17 khía cạnh).
> - Actual Unified Diff hoàn chỉnh (Zero Placeholders) cho toàn bộ 11 files.
> - Ma trận kiểm thử & phương án lùi (Rollback).
