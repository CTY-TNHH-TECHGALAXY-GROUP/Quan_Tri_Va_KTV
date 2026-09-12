-- =============================================================================
-- FIX: Đổi notification type cho KTV từ 'NEW_ORDER' → 'KTV_NEW_ORDER'
-- Lý do: 'NEW_ORDER' dùng chung cho quầy (khách đặt mới) và KTV (được gán đơn)
--         → Client-side skip NEW_ORDER cho KTV → KTV không nghe âm thanh
-- Giải pháp: Tách riêng type để NotificationProvider xử lý đúng
-- =============================================================================

-- Drop old trigger first
DROP TRIGGER IF EXISTS tr_master_notification_handler ON public."Bookings";

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

    -- ═══════════════════════════════════════════════════════════════
    -- THỨ NHẤT: KHI CÓ ĐƠN HÀNG MỚI (INSERT) → THÔNG BÁO CHO QUẦY/ADMIN
    -- Type: 'NEW_ORDER' (không có employeeId → quầy nhận)
    -- ═══════════════════════════════════════════════════════════════
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

    -- ═══════════════════════════════════════════════════════════════
    -- THỨ HAI: KHI CẬP NHẬT ĐƠN HÀNG (UPDATE)
    -- ═══════════════════════════════════════════════════════════════
    IF (TG_OP = 'UPDATE') THEN
        
        -- A. THÔNG BÁO GÁN KTV (CHỈ KHI THAY ĐỔI technicianCode)
        -- 🔧 FIX: Đổi type từ 'NEW_ORDER' → 'KTV_NEW_ORDER' để phân biệt với đơn mới của quầy
        IF (NEW."technicianCode" IS NOT NULL AND NEW."technicianCode" != '') AND 
           (OLD."technicianCode" IS DISTINCT FROM NEW."technicianCode") 
        THEN
            tech_list := string_to_array(NEW."technicianCode", ',');
            FOREACH tech_code IN ARRAY tech_list
            LOOP
                tech_code := trim(tech_code);
                -- Chỉ thông báo cho KTV mới được thêm vào (trước đó chưa có)
                IF (OLD."technicianCode" IS NULL OR NOT (OLD."technicianCode" LIKE '%' || tech_code || '%')) THEN
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
            tech_list := string_to_array(NEW."technicianCode", ',');
            num_techs := array_length(tech_list, 1);

            -- THƯỞNG: Khi nhận 4-5 sao
            IF NEW.rating >= 4 AND num_techs > 0 THEN
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

            -- KHIẾU NẠI: Khi bị 1-2 sao (Rating <= 2)
            IF NEW.rating <= 2 THEN
                -- 1. Thông báo cho Admin/Quầy (Global)
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, 'COMPLAINT',
                    'Khách ' || curr_customer_name || ' đánh giá TỆ (' || NEW.rating || ' sao) cho đơn #' || NEW."billCode" || ': ' || COALESCE(NEW."feedbackNote", 'Không có ghi chú'),
                    false, now()
                );

                -- 2. Thông báo riêng cho từng KTV trong bill đó
                IF num_techs > 0 THEN
                    FOREACH tech_code IN ARRAY tech_list
                    LOOP
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW.id, trim(tech_code), 'COMPLAINT',
                            'Cảnh báo: Bạn vừa nhận đánh giá thấp (' || NEW.rating || ' sao) cho đơn #' || NEW."billCode",
                            false, now()
                        );
                    END LOOP;
                END IF;
            END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger
CREATE TRIGGER tr_master_notification_handler
AFTER INSERT OR UPDATE ON public."Bookings"
FOR EACH ROW
EXECUTE FUNCTION public.fn_master_notification_handler();
