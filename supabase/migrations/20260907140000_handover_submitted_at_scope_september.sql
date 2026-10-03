-- ================================================================
-- Chỉ áp luật auto-duyệt bàn giao từ 01/09/2026 trở đi
-- ================================================================
-- VÌ SAO
--
-- Migration trước (20260907130000) lấp `handover_submitted_at` từ mọi mốc
-- `segments[].handoverTime` tìm được, kéo về tận tháng 7. Hệ quả: cron auto-duyệt
-- vừa được sửa sẽ quét luôn một loạt đơn cũ hàng tháng trời.
--
-- Chủ tiệm chốt: chỉ xét từ 01/09/2026, dữ liệu cũ hơn để nguyên. Đơn cũ giờ
-- không ai kiểm chứng lại được nữa, duyệt bù hàng loạt chỉ làm nhiễu sổ sách.
--
-- CÁCH GIỮ RANH GIỚI
--
-- Không hard-code ngày vào cron. Ranh giới nằm ở DỮ LIỆU: đơn cũ không có
-- `handover_submitted_at` thì cron vĩnh viễn không nhìn thấy (nó lọc
-- `handover_submitted_at IS NOT NULL`). Cron vẫn sạch, không biết gì về 01/09.
-- ================================================================

-- ─── 1. Trả đơn TRƯỚC 01/09 về trạng thái "để yên" ───
-- Xoá mốc mà migration trước vừa lấp cho chúng.
UPDATE "BookingItems"
   SET "handover_submitted_at" = NULL
 WHERE "handover_submitted_at" IS NOT NULL
   AND "handover_submitted_at" < '2026-09-01T00:00:00+07:00';

-- ─── 2. Lấp mốc cho đơn TỪ 01/09 đã nộp ảnh mà chưa có mốc ───
-- Nhóm này nộp qua đường cũ nên không để lại `handoverTime` trong segments.
-- Dùng `timeEnd` (giờ kết thúc dịch vụ) làm mốc thay thế — không chính xác bằng
-- giờ nộp thật, nhưng các đơn này đều đã quá hạn duyệt từ lâu nên sai lệch vài
-- phút không đổi kết quả. Đơn không có cả `timeEnd` thì bỏ qua, không đoán bừa.
UPDATE "BookingItems"
   SET "handover_submitted_at" = "timeEnd"
 WHERE "handover_submitted_at" IS NULL
   AND "handover_status" = 'PENDING'
   AND "handover_images" IS NOT NULL
   AND "handover_images" NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
   AND "timeEnd" >= '2026-09-01T00:00:00+07:00';
