-- ============================================================
-- Per-Item Rating Notification Trigger (v2)
-- BookingItems dùng "technicianCodes" TEXT[] (array), KHÔNG phải "technicianCode"
-- ============================================================

-- 1. Hàm xử lý khi BookingItem có đánh giá
CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_item_rating()
RETURNS TRIGGER AS $$
DECLARE
    v_booking RECORD;
    v_tech_code TEXT;
    v_reward_points INTEGER := 25;
    v_rating_label TEXT;
BEGIN
    -- Chỉ chạy khi itemRating thay đổi từ NULL sang có giá trị
    IF OLD."itemRating" IS NOT NULL OR NEW."itemRating" IS NULL THEN
        RETURN NEW;
    END IF;

    -- Lấy thông tin booking (billCode + technicianCode booking-level)
    SELECT "billCode", "technicianCode" INTO v_booking
    FROM public."Bookings"
    WHERE id = NEW."bookingId"
    LIMIT 1;

    -- Lấy KTV từ item-level "technicianCodes" (TEXT[] array)
    -- Lấy phần tử đầu tiên, fallback sang booking-level
    IF NEW."technicianCodes" IS NOT NULL AND array_length(NEW."technicianCodes", 1) > 0 THEN
        v_tech_code := trim(NEW."technicianCodes"[1]);
    ELSE
        v_tech_code := v_booking."technicianCode";
    END IF;
    
    IF v_tech_code IS NULL OR v_tech_code = '' THEN
        RETURN NEW;
    END IF;

    -- Xác định label đánh giá
    CASE NEW."itemRating"
        WHEN 4 THEN v_rating_label := 'XUẤT SẮC 🤩';
        WHEN 3 THEN v_rating_label := 'TỐT 🙂';
        WHEN 2 THEN v_rating_label := 'BÌNH THƯỜNG 😐';
        WHEN 1 THEN v_rating_label := 'TỆ 😡';
        ELSE v_rating_label := 'Không xác định';
    END CASE;

    -- THƯỞNG: Rating >= 4 (Xuất sắc) → gửi cho TỪNG KTV trong mảng
    IF NEW."itemRating" >= 4 AND NEW."technicianCodes" IS NOT NULL THEN
        FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
        LOOP
            v_tech_code := trim(v_tech_code);
            IF v_tech_code != '' THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId",
                    v_tech_code,
                    'REWARD',
                    'Bạn nhận được ' || v_reward_points || 'đ đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                    false,
                    now()
                );
            END IF;
        END LOOP;
    ELSIF NEW."itemRating" >= 4 AND v_booking."technicianCode" IS NOT NULL THEN
        -- Fallback: gửi cho booking-level tech
        INSERT INTO public."StaffNotifications" (
            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
        ) VALUES (
            NEW."bookingId",
            trim(v_booking."technicianCode"),
            'REWARD',
            'Bạn nhận được ' || v_reward_points || 'đ đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
            false,
            now()
        );
    END IF;

    -- CẢNH BÁO: Rating = 1 (Tệ) → thông báo cho Admin + KTV
    IF NEW."itemRating" = 1 THEN
        -- Gửi cho Admin/Quầy
        INSERT INTO public."StaffNotifications" (
            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
        ) VALUES (
            NEW."bookingId",
            NULL,
            'COMPLAINT',
            'Khách đánh giá TỆ cho NV ' || COALESCE(v_tech_code, '?') || ' trong đơn #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
            false,
            now()
        );

        -- Gửi cho từng KTV bị đánh giá tệ
        IF NEW."technicianCodes" IS NOT NULL THEN
            FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
            LOOP
                v_tech_code := trim(v_tech_code);
                IF v_tech_code != '' THEN
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId",
                        v_tech_code,
                        'COMPLAINT',
                        'Bạn nhận được đánh giá TỆ 😡 từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false,
                        now()
                    );
                END IF;
            END LOOP;
        ELSIF v_booking."technicianCode" IS NOT NULL THEN
            INSERT INTO public."StaffNotifications" (
                "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
            ) VALUES (
                NEW."bookingId",
                trim(v_booking."technicianCode"),
                'COMPLAINT',
                'Bạn nhận được đánh giá TỆ 😡 từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                false,
                now()
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Tạo trigger trên BookingItems
DROP TRIGGER IF EXISTS tr_notify_ktv_on_item_rating ON public."BookingItems";
CREATE TRIGGER tr_notify_ktv_on_item_rating
AFTER UPDATE OF "itemRating" ON public."BookingItems"
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_ktv_on_item_rating();

-- 3. Vô hiệu hóa trigger CŨ trên Bookings.rating
DROP TRIGGER IF EXISTS tr_notify_ktv_on_rating ON public."Bookings";
