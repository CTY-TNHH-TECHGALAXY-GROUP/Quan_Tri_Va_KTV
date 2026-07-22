-- =============================================================================
-- Migration: Fix KTV_NEW_ORDER type in master notification trigger
-- 
-- ROOT CAUSE: Migration 20260426 (fix_excellent_notifications) ghi đè lên
-- trigger fn_master_notification_handler nhưng QUÊN đổi type từ 'NEW_ORDER'
-- thành 'KTV_NEW_ORDER' cho phần gán KTV. Khiến quầy nhận thông báo KTV.
--
-- FIX: Cập nhật trigger để gửi 'KTV_NEW_ORDER' khi gán KTV vào đơn.
-- =============================================================================

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
        -- Bảo mật AccessToken cho các đơn hàng từ Web khách hàng
        IF (NEW.source IN ('WEB_BOOKING', 'HOME_BOOKING', 'VIP_BOOKING', 'STANDARD_BOOKING', 'MIXED_WALK_IN', 'MIXED_BOOKING')) THEN
            IF (NEW."accessToken" IS NULL OR NEW."accessToken" != 'NGANHA_SECURE_TOKEN_2026') THEN
                -- Nếu Token không đúng, bỏ qua không tạo thông báo (Chống Spam)
                RETURN NEW;
            END IF;
        END IF;

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
        -- 🔧 FIX: Đổi type từ 'NEW_ORDER' → 'KTV_NEW_ORDER' để quầy không nhận nhầm
        IF (NEW."technicianCode" IS NOT NULL AND NEW."technicianCode" != '') AND 
           (OLD."technicianCode" IS DISTINCT FROM NEW."technicianCode" OR (OLD.status::text != NEW.status::text AND NEW.status::text = 'PREPARING')) 
        THEN
            tech_list := string_to_array(NEW."technicianCode", ',');
            FOREACH tech_code IN ARRAY tech_list
            LOOP
                tech_code := trim(tech_code);
                IF (NEW.status::text = 'PREPARING') OR (OLD."technicianCode" IS NULL OR NOT (OLD."technicianCode" LIKE '%' || tech_code || '%')) THEN
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW.id, tech_code, 'KTV_NEW_ORDER',
                        'Bạn có đơn mới #' || NEW."billCode" || ' tại ' || location_info,
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
                
                -- THÊM: Báo cho Quầy
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, 'FEEDBACK',
                    'Đơn hàng #' || NEW."billCode" || ' được đánh giá XUẤT SẮC (' || NEW.rating || ' sao)!',
                    false, now()
                );
            END IF;

            -- Cảnh báo Admin khi bị 1 sao (Complaints)
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
