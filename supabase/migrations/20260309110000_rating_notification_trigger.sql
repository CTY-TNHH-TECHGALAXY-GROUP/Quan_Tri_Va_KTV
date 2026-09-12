-- 1. Thêm cột employeeId vào StaffNotifications để biết thông báo gửi cho ai
ALTER TABLE public."StaffNotifications" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;

-- 2. Hàm xử lý khi Booking có đánh giá
CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_rating()
RETURNS TRIGGER AS $$
DECLARE
    tech_list TEXT[];
    tech_code TEXT;
    num_techs INTEGER;
    reward_points NUMERIC;
BEGIN
    -- PHẦN 1: THƯỞNG CHO KTV (Rating >= 4: Xuất sắc)
    -- Chỉ chạy khi rating thay đổi từ dưới 4 lên >= 4
    IF (OLD.rating IS NULL OR OLD.rating < 4) AND NEW.rating >= 4 THEN
        -- Tách danh sách KTV từ chuỗi technicianCode (ví dụ: "NH001, NH002")
        tech_list := string_to_array(NEW."technicianCode", ',');
        num_techs := array_length(tech_list, 1);
        
        IF num_techs > 0 THEN
            -- Chia đều 25 điểm cho số lượng KTV và làm tròn
            reward_points := ROUND(25.0 / num_techs, 0);
            
            FOREACH tech_code IN ARRAY tech_list
            LOOP
                -- Thêm thông báo thưởng cho từng KTV (employeeId được set để KTV tự nhận)
                INSERT INTO public."StaffNotifications" (
                    "bookingId",
                    "employeeId",
                    "type",
                    "message",
                    "isRead",
                    "createdAt"
                ) VALUES (
                    NEW.id,
                    trim(tech_code),
                    'REWARD',
                    'Bạn nhận được ' || reward_points::INTEGER || 'đ đánh giá XUẤT SẮC từ đơn hàng #' || NEW."billCode",
                    false,
                    now()
                );
            END LOOP;
        END IF;
    END IF;

    -- PHẦN 2: THÔNG BÁO CHO QUẦY/ADMIN KHI CÓ ĐÁNH GIÁ TỆ (Rating = 1)
    -- Bỏ qua mức 2 (Bình thường) theo yêu cầu
    IF (OLD.rating IS NULL OR OLD.rating > 1) AND NEW.rating = 1 THEN
        INSERT INTO public."StaffNotifications" (
            "bookingId",
            "employeeId",
            "type",
            "message",
            "isRead",
            "createdAt"
        ) VALUES (
            NEW.id,
            NULL, -- employeeId = NULL nghĩa là thông báo chung cho Quầy/Admin
            'COMPLAINT',
            'Khách hàng đánh giá TỆ cho đơn hàng #' || NEW."billCode" || '. Nội dung: ' || COALESCE(NEW."feedbackNote", 'Không có ghi chú'),
            false,
            now()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Tạo Trigger tự động gửi thông báo khi cập nhật rating
DROP TRIGGER IF EXISTS tr_notify_ktv_on_rating ON public."Bookings";
CREATE TRIGGER tr_notify_ktv_on_rating
AFTER UPDATE OF rating ON public."Bookings"
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_ktv_on_rating();
