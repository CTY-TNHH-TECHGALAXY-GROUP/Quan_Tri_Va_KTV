-- =============================================================================
-- MASTER NOTIFICATION TRIGGER: HỢP NHẤT TOÀN BỘ CHỨC NĂNG THÔNG BÁO
-- =============================================================================

-- 1. Xóa tất cả các trigger cũ liên quan đến Bookings để tránh xung đột & trùng lặp
DROP TRIGGER IF EXISTS tr_notify_on_new_booking ON public."Bookings";
DROP TRIGGER IF EXISTS tr_notify_ktv_on_assignment ON public."Bookings";
DROP TRIGGER IF EXISTS tr_notify_ktv_on_rating ON public."Bookings";
DROP TRIGGER IF EXISTS tr_master_notification_handler ON public."Bookings";

-- 2. Hàm xử lý Master
CREATE OR REPLACE FUNCTION public.fn_master_notification_handler()
RETURNS TRIGGER AS $$
DECLARE
    tech_list TEXT[];
    tech_code TEXT;
    reward_points INTEGER;
    num_techs INTEGER;
    curr_customer_name TEXT;
    location_info TEXT;
BEGIN
    -- Lấy thông tin cơ bản
    curr_customer_name := COALESCE(NEW."customerName", 'Khách vãng lai');
    
    -- Lấy thông tin vị trí (Phòng/Giường) nếu có
    location_info := 'Phòng ' || COALESCE(NEW."roomName", '???');
    IF NEW."bedId" IS NOT NULL AND NEW."bedId" != '' THEN
        location_info := location_info || ' - Giường ' || split_part(NEW."bedId", '-', array_length(string_to_array(NEW."bedId", '-'), 1));
    END IF;

    -- THỨ NHẤT: KHI CÓ ĐƠN HÀNG MỚI (INSERT) -> THÔNG BÁO CHO QUẦY/ADMIN (CÓ Tên khách)
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public."StaffNotifications" (
            "bookingId", "type", "message", "isRead", "createdAt"
        ) VALUES (
            NEW.id, 'NEW_ORDER',
            'Có đơn hàng mới #' || NEW."billCode" || ' từ khách ' || curr_customer_name,
            false, now()
        );
        RETURN NEW;
    END IF;

    -- THỨ HAI: KHI CẬP NHẬT ĐƠN HÀNG (UPDATE)
    IF (TG_OP = 'UPDATE') THEN
        
        -- A. THÔNG BÁO GÁN KTV (KTV Nhận đơn) - BẮT BUỘC KHÔNG IN TÊN KHÁCH
        -- Điều kiện: Đã gán KTV AND (KTV thay đổi OR Trạng thái chuyển sang PREPARING)
        IF (NEW."technicianCode" IS NOT NULL AND NEW."technicianCode" != '') AND 
           (OLD."technicianCode" IS DISTINCT FROM NEW."technicianCode" OR (OLD.status::text != NEW.status::text AND NEW.status::text = 'PREPARING')) 
        THEN
            tech_list := string_to_array(NEW."technicianCode", ',');
            FOREACH tech_code IN ARRAY tech_list
            LOOP
                tech_code := trim(tech_code);
                -- Gửi nếu đơn chuyển sang PREPARING (vừa điều phối xong) hoặc KTV mới được gán thêm
                IF (NEW.status::text = 'PREPARING') OR (OLD."technicianCode" IS NULL OR NOT (OLD."technicianCode" LIKE '%' || tech_code || '%')) THEN
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW.id, tech_code, 'NEW_ORDER',
                        'Bạn có đơn mới #' || NEW."billCode" || ' tại ' || location_info, -- KHÔNG CÓ TÊN KHÁCH
                        false, now()
                    );
                END IF;
            END LOOP;
        END IF;

        -- B. THÔNG BÁO ĐÁNH GIÁ (Thưởng/Khiếu nại)
        IF OLD.rating IS DISTINCT FROM NEW.rating THEN
            -- Thưởng KTV khi nhận 4-5 sao (Rating >= 4)
            IF NEW.rating >= 4 THEN
                tech_list := string_to_array(NEW."technicianCode", ',');
                num_techs := array_length(tech_list, 1);
                IF num_techs > 0 THEN
                    reward_points := ROUND(25.0 / num_techs, 0);
                    FOREACH tech_code IN ARRAY tech_list
                    LOOP
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW.id, trim(tech_code), 'REWARD',
                            'Chúc mừng! Bạn nhận được ' || reward_points || 'đ thưởng cho đơn #' || NEW."billCode",
                            false, now()
                        );
                    END LOOP;
                END IF;
            END IF;

            -- Cảnh báo Admin khi bị 1 sao (Complaints) - BẠN PHẢI BIẾT ĐƠN NÀO/KHÁCH NÀO
            IF NEW.rating = 1 THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, 'COMPLAINT',
                    'Khách ' || curr_customer_name || ' đánh giá TỆ cho đơn #' || NEW."billCode" || ': ' || COALESCE(NEW."feedbackNote", 'Không có ghi chú'),
                    false, now()
                );
            END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Đăng ký Trigger duy nhất cho bảng Bookings (INSERT/UPDATE)
CREATE TRIGGER tr_master_notification_handler
AFTER INSERT OR UPDATE ON public."Bookings"
FOR EACH ROW
EXECUTE FUNCTION public.fn_master_notification_handler();
