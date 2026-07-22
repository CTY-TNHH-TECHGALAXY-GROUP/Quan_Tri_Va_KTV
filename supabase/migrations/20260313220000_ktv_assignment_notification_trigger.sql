-- Hàm thông báo khi gán KTV (Bản sửa lỗi triệt để - Đã loại bỏ CONFIRMED)
CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_assignment()
RETURNS TRIGGER AS $$
DECLARE
    tech_list TEXT[];
    tech_code TEXT;
    is_newly_assigned BOOLEAN;
    is_dispatched BOOLEAN;
BEGIN
    -- Kiểm tra xem có KTV được gán hay không
    IF NEW."technicianCode" IS NULL OR NEW."technicianCode" = '' THEN
        RETURN NEW;
    END IF;

    -- Kiểm tra các điều kiện để bắn thông báo:
    -- 1. KTV mới được gán (trước đó chưa có)
    -- 2. Danh sách KTV thay đổi
    -- 3. Đơn hàng chuyển sang trạng thái điều phối (PREPARING)
    
    is_newly_assigned := (OLD."technicianCode" IS NULL) OR (OLD."technicianCode" != NEW."technicianCode");
    is_dispatched := (OLD.status::text != NEW.status::text) AND (NEW.status::text = 'PREPARING');

    IF is_newly_assigned OR is_dispatched THEN
        tech_list := string_to_array(NEW."technicianCode", ',');
        
        FOREACH tech_code IN ARRAY tech_list
        LOOP
            tech_code := trim(tech_code);
            -- Gửi thông báo cho KTV mới hoặc khi vừa điều phối xong
            IF is_dispatched OR OLD."technicianCode" IS NULL OR NOT (OLD."technicianCode" LIKE '%' || tech_code || '%') THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, tech_code, 'NEW_ORDER',
                    'Bạn có đơn hàng mới #' || NEW."billCode" || ' từ khách ' || NEW."customerName",
                    false, now()
                );
            END IF;
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Thiết lập lại trigger
DROP TRIGGER IF EXISTS tr_notify_ktv_on_assignment ON public."Bookings";
CREATE TRIGGER tr_notify_ktv_on_assignment
AFTER UPDATE OF status, "technicianCode" ON public."Bookings"
FOR EACH ROW EXECUTE FUNCTION public.fn_notify_ktv_on_assignment();
