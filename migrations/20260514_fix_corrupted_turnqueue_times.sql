-- Cập nhật lại thời gian cho các bản ghi TurnQueue bị sai trong ngày hôm nay
-- GIẢI PHÁP TRIỆT ĐỂ: Vì hiện tại đã là ~19:00 tối, mọi KTV nào có giờ rảnh "nhỏ hơn 16:00 chiều" (như 12:34) ĐỀU LÀ DO BỊ LỖI LÙI 7 TIẾNG.
-- Script này sẽ quét toàn bộ những KTV có giờ rảnh < 17:00 và cộng bù 7 tiếng.
-- Chú ý: Bỏ qua kiểm tra start_time vì có thể start_time bị rỗng (NULL) dẫn đến việc script cũ không chạy.

UPDATE "TurnQueue"
SET 
    "start_time" = ("start_time" + interval '7 hours')::time,
    "estimated_end_time" = ("estimated_end_time" + interval '7 hours')::time
WHERE "date" = CURRENT_DATE
  AND "estimated_end_time" IS NOT NULL
  AND "estimated_end_time" < '17:00:00'::time;
