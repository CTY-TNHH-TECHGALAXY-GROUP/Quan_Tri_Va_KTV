-- ============================================================
-- Migration: Add ktvRatings JSONB column to BookingItems
-- Cho phép lưu rating riêng từng KTV khi 2+ KTV cùng 1 dịch vụ
-- Format: { "NH001": 4, "NH002": 3 }
-- ============================================================

ALTER TABLE public."BookingItems" 
ADD COLUMN IF NOT EXISTS "ktvRatings" JSONB DEFAULT '{}';

-- ============================================================
-- FIX: Per-Item Rating Notification - Per-KTV rating support
-- Đọc ktvRatings JSONB để biết rating riêng từng KTV
-- Logic thưởng:
--   - Nếu chỉ 1 KTV xuất sắc (≥4) → nhận trọn 25đ
--   - Nếu nhiều KTV cùng xuất sắc → chia đều 25đ
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_item_rating()
RETURNS TRIGGER AS $$
DECLARE
    v_booking RECORD;
    v_tech_code TEXT;
    v_ktv_ratings JSONB;
    v_num_excellent INTEGER := 0;
    v_reward_points INTEGER;
    v_rating_label TEXT;
    v_ktv_rating INTEGER;
BEGIN
    -- Chỉ chạy khi itemRating thay đổi từ NULL sang có giá trị
    -- HOẶC khi ktvRatings thay đổi (per-KTV rating)
    IF (OLD."itemRating" IS NOT NULL AND NEW."ktvRatings" IS NOT DISTINCT FROM OLD."ktvRatings") 
       OR NEW."itemRating" IS NULL THEN
        RETURN NEW;
    END IF;

    -- Lấy thông tin booking
    SELECT "billCode", "technicianCode" INTO v_booking
    FROM public."Bookings"
    WHERE id = NEW."bookingId"
    LIMIT 1;

    -- Lấy ktvRatings JSONB
    v_ktv_ratings := COALESCE(NEW."ktvRatings", '{}'::JSONB);

    -- Xác định label đánh giá cho itemRating chính
    CASE NEW."itemRating"
        WHEN 4 THEN v_rating_label := 'XUẤT SẮC 🤩';
        WHEN 3 THEN v_rating_label := 'TỐT 🙂';
        WHEN 2 THEN v_rating_label := 'BÌNH THƯỜNG 😐';
        WHEN 1 THEN v_rating_label := 'TỆ 😡';
        ELSE v_rating_label := 'Không xác định';
    END CASE;

    -- ─── Per-KTV Rating Flow (khi có ktvRatings) ─────────────────────
    IF v_ktv_ratings != '{}'::JSONB AND NEW."technicianCodes" IS NOT NULL 
       AND array_length(NEW."technicianCodes", 1) > 1 THEN
        
        -- Đếm số KTV xuất sắc (rating >= 4)
        v_num_excellent := 0;
        FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
        LOOP
            v_tech_code := trim(v_tech_code);
            v_ktv_rating := COALESCE((v_ktv_ratings->>v_tech_code)::INTEGER, 0);
            IF v_ktv_rating >= 4 THEN
                v_num_excellent := v_num_excellent + 1;
            END IF;
        END LOOP;

        -- Tính điểm thưởng: chia cho số KTV xuất sắc (không chia cho tổng KTV)
        v_reward_points := CASE 
            WHEN v_num_excellent > 0 THEN ROUND(25.0 / v_num_excellent)::INTEGER
            ELSE 25
        END;

        -- Gửi thông báo cho từng KTV dựa trên rating riêng của họ
        FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
        LOOP
            v_tech_code := trim(v_tech_code);
            IF v_tech_code = '' THEN CONTINUE; END IF;

            v_ktv_rating := COALESCE((v_ktv_ratings->>v_tech_code)::INTEGER, 0);

            -- Xác định label cho KTV này
            CASE v_ktv_rating
                WHEN 4 THEN v_rating_label := 'XUẤT SẮC 🤩';
                WHEN 3 THEN v_rating_label := 'TỐT 🙂';
                WHEN 2 THEN v_rating_label := 'BÌNH THƯỜNG 😐';
                WHEN 1 THEN v_rating_label := 'TỆ 😡';
                ELSE v_rating_label := 'Không xác định';
            END CASE;

            IF v_ktv_rating >= 4 THEN
                -- KTV xuất sắc → nhận thưởng
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", v_tech_code, 'REWARD',
                    'Bạn nhận được ' || v_reward_points || 'đ đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
            ELSIF v_ktv_rating = 1 THEN
                -- KTV bị đánh giá tệ → cảnh báo
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", v_tech_code, 'COMPLAINT',
                    'Bạn nhận được đánh giá TỆ 😡 từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                    false, now()
                );
                -- Cảnh báo Admin
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", NULL, 'COMPLAINT',
                    'Khách đánh giá TỆ cho NV ' || v_tech_code || ' trong đơn #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                    false, now()
                );
            END IF;
        END LOOP;

        RETURN NEW;
    END IF;

    -- ─── Fallback: Single-KTV Flow (giữ nguyên logic cũ) ────────────
    IF NEW."technicianCodes" IS NOT NULL AND array_length(NEW."technicianCodes", 1) > 0 THEN
        v_tech_code := trim(NEW."technicianCodes"[1]);
    ELSE
        v_tech_code := v_booking."technicianCode";
    END IF;

    IF v_tech_code IS NULL OR v_tech_code = '' THEN
        RETURN NEW;
    END IF;

    -- Single KTV xuất sắc → full 25đ
    IF NEW."itemRating" >= 4 AND NEW."technicianCodes" IS NOT NULL THEN
        FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
        LOOP
            v_tech_code := trim(v_tech_code);
            IF v_tech_code != '' THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", v_tech_code, 'REWARD',
                    'Bạn nhận được 25đ đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
            END IF;
        END LOOP;
    ELSIF NEW."itemRating" >= 4 AND v_booking."technicianCode" IS NOT NULL THEN
        INSERT INTO public."StaffNotifications" (
            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
        ) VALUES (
            NEW."bookingId", trim(v_booking."technicianCode"), 'REWARD',
            'Bạn nhận được 25đ đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
            false, now()
        );
    END IF;

    -- CẢNH BÁO Rating = 1
    IF NEW."itemRating" = 1 THEN
        INSERT INTO public."StaffNotifications" (
            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
        ) VALUES (
            NEW."bookingId", NULL, 'COMPLAINT',
            'Khách đánh giá TỆ cho NV ' || COALESCE(v_tech_code, '?') || ' trong đơn #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
            false, now()
        );
        IF NEW."technicianCodes" IS NOT NULL THEN
            FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
            LOOP
                v_tech_code := trim(v_tech_code);
                IF v_tech_code != '' THEN
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", v_tech_code, 'COMPLAINT',
                        'Bạn nhận được đánh giá TỆ 😡 từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false, now()
                    );
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: lắng nghe cả itemRating VÀ ktvRatings thay đổi
DROP TRIGGER IF EXISTS tr_notify_ktv_on_item_rating ON public."BookingItems";
CREATE TRIGGER tr_notify_ktv_on_item_rating
AFTER UPDATE OF "itemRating", "ktvRatings" ON public."BookingItems"
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_ktv_on_item_rating();

-- Vô hiệu hóa trigger CŨ
DROP TRIGGER IF EXISTS tr_notify_ktv_on_rating ON public."Bookings";
