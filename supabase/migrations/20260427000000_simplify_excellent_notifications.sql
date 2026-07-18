-- ============================================================
-- Migration: Simplify Excellent Rating Notifications
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_item_rating()
RETURNS TRIGGER AS $$
DECLARE
    v_booking RECORD;
    v_tech_code TEXT;
    v_ktv_ratings JSONB;
    v_old_ktv_ratings JSONB;
    v_rating_label TEXT;
    v_ktv_rating INTEGER;
    v_old_ktv_rating INTEGER;
BEGIN
    -- Ch? ch?y n?u rating có thay d?i
    IF (OLD."itemRating" IS NOT DISTINCT FROM NEW."itemRating") 
       AND (OLD."ktvRatings" IS NOT DISTINCT FROM NEW."ktvRatings") THEN
        RETURN NEW;
    END IF;

    -- L?y thông tin booking
    SELECT "billCode", "technicianCode" INTO v_booking
    FROM public."Bookings"
    WHERE id = NEW."bookingId"
    LIMIT 1;

    v_ktv_ratings := COALESCE(NEW."ktvRatings", '{}'::JSONB);
    v_old_ktv_ratings := COALESCE(OLD."ktvRatings", '{}'::JSONB);

    -- --- 1. X? LÝ THEO M?NG KTVRATINGS (Per-KTV) ------------------------
    IF v_ktv_ratings != '{}'::JSONB AND NEW."technicianCodes" IS NOT NULL THEN

        FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
        LOOP
            v_tech_code := trim(v_tech_code);
            IF v_tech_code = '' THEN CONTINUE; END IF;

            v_ktv_rating := COALESCE((v_ktv_ratings->>v_tech_code)::INTEGER, 0);
            v_old_ktv_rating := COALESCE((v_old_ktv_ratings->>v_tech_code)::INTEGER, 0);

            -- CH? X? LÝ N?U RATING C?A KTV NÀY M?I ÐU?C C?P NH?T
            IF v_ktv_rating != v_old_ktv_rating AND v_ktv_rating > 0 THEN
                CASE v_ktv_rating
                    WHEN 4 THEN v_rating_label := 'XU?T S?C';
                    WHEN 3 THEN v_rating_label := 'T?T';
                    WHEN 2 THEN v_rating_label := 'BÌNH THU?NG';
                    WHEN 1 THEN v_rating_label := 'T?';
                    ELSE v_rating_label := 'Không xác d?nh';
                END CASE;

                IF v_ktv_rating >= 4 THEN
                    -- KTV xu?t s?c ? nh?n thu?ng
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", v_tech_code, 'REWARD',
                        'B?n v?a nh?n du?c dánh giá ' || v_rating_label || ' t? don hàng #' || COALESCE(v_booking."billCode", '???'),
                        false, now()
                    );
                    -- THÊM: Báo cho Qu?y
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", NULL, 'FEEDBACK',
                        'KTV ' || v_tech_code || ' nh?n dánh giá ' || v_rating_label || ' t? don #' || COALESCE(v_booking."billCode", '???'),
                        false, now()
                    );
                ELSIF v_ktv_rating = 1 THEN
                    -- KTV b? dánh giá t? ? c?nh báo
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", v_tech_code, 'COMPLAINT',
                        'B?n nh?n du?c dánh giá T? t? don hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false, now()
                    );
                    -- C?nh báo Admin
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", NULL, 'COMPLAINT',
                        'Khách dánh giá T? cho NV ' || v_tech_code || ' trong don #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false, now()
                    );
                END IF;
            END IF;
        END LOOP;

        RETURN NEW;
    END IF;

    -- --- 2. X? LÝ THEO ITEMRATING CHUNG (Fallback) ------------------------
    IF OLD."itemRating" IS DISTINCT FROM NEW."itemRating" AND NEW."itemRating" IS NOT NULL THEN
        CASE NEW."itemRating"
            WHEN 4 THEN v_rating_label := 'XU?T S?C';
            WHEN 3 THEN v_rating_label := 'T?T';
            WHEN 2 THEN v_rating_label := 'BÌNH THU?NG';
            WHEN 1 THEN v_rating_label := 'T?';
            ELSE v_rating_label := 'Không xác d?nh';
        END CASE;

        IF NEW."technicianCodes" IS NOT NULL AND array_length(NEW."technicianCodes", 1) > 0 THEN
            v_tech_code := trim(NEW."technicianCodes"[1]);
        ELSE
            v_tech_code := v_booking."technicianCode";
        END IF;

        IF v_tech_code IS NULL OR v_tech_code = '' THEN
            RETURN NEW;
        END IF;

        IF NEW."itemRating" >= 4 THEN
            IF NEW."technicianCodes" IS NOT NULL THEN
                FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
                LOOP
                    v_tech_code := trim(v_tech_code);
                    IF v_tech_code != '' THEN
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW."bookingId", v_tech_code, 'REWARD',
                            'B?n v?a nh?n du?c dánh giá ' || v_rating_label || ' t? don hàng #' || COALESCE(v_booking."billCode", '???'),
                            false, now()
                        );
                        -- THÊM: Báo cho Qu?y
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW."bookingId", NULL, 'FEEDBACK',
                            'KTV ' || v_tech_code || ' nh?n dánh giá ' || v_rating_label || ' t? don #' || COALESCE(v_booking."billCode", '???'),
                            false, now()
                        );
                    END IF;
                END LOOP;
            ELSIF v_booking."technicianCode" IS NOT NULL THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", trim(v_booking."technicianCode"), 'REWARD',
                    'B?n v?a nh?n du?c dánh giá ' || v_rating_label || ' t? don hàng #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
                -- THÊM: Báo cho Qu?y
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", NULL, 'FEEDBACK',
                    'KTV ' || trim(v_booking."technicianCode") || ' nh?n dánh giá ' || v_rating_label || ' t? don #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
            END IF;
        ELSIF NEW."itemRating" = 1 THEN
            INSERT INTO public."StaffNotifications" (
                "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
            ) VALUES (
                NEW."bookingId", NULL, 'COMPLAINT',
                'Khách dánh giá T? cho NV ' || COALESCE(v_tech_code, '?') || ' trong don #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
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
                            'B?n nh?n du?c dánh giá T? t? don hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                            false, now()
                        );
                    END IF;
                END LOOP;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.fn_master_notification_handler()
RETURNS TRIGGER AS $$
DECLARE
    tech_list TEXT[];
    tech_code TEXT;
    curr_customer_name TEXT;
    location_info TEXT;
BEGIN
    -- L?y thông tin co b?n
    curr_customer_name := COALESCE(NEW."customerName", 'Khách vãng lai');
    
    -- L?y thông tin v? trí (Phòng/Giu?ng) n?u có
    location_info := 'Phòng ' || COALESCE(NEW."roomName", '???');
    IF NEW."bedId" IS NOT NULL AND NEW."bedId" != '' THEN
        location_info := location_info || ' - Giu?ng ' || split_part(NEW."bedId", '-', array_length(string_to_array(NEW."bedId", '-'), 1));
    END IF;

    -- TH? NH?T: KHI CÓ ÐON HÀNG M?I (INSERT) -> THÔNG BÁO CHO QU?Y/ADMIN (CÓ Tên khách)
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public."StaffNotifications" (
            "bookingId", "type", "message", "isRead", "createdAt"
        ) VALUES (
            NEW.id, 'NEW_ORDER',
            'Có don hàng m?i #' || NEW."billCode" || ' t? khách ' || curr_customer_name,
            false, now()
        );
        RETURN NEW;
    END IF;

    -- TH? HAI: KHI C?P NH?T ÐON HÀNG (UPDATE)
    IF (TG_OP = 'UPDATE') THEN
        
        -- A. THÔNG BÁO GÁN KTV (KTV Nh?n don) - B?T BU?C KHÔNG IN TÊN KHÁCH
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
                        NEW.id, tech_code, 'NEW_ORDER',
                        'B?n có don m?i #' || NEW."billCode" || ' t?i ' || location_info,
                        false, now()
                    );
                END IF;
            END LOOP;
        END IF;

        -- B. THÔNG BÁO ÐÁNH GIÁ (Thu?ng/Khi?u n?i)
        IF OLD.rating IS DISTINCT FROM NEW.rating THEN
            -- Thu?ng KTV khi nh?n 4-5 sao (Rating >= 4)
            IF NEW.rating >= 4 THEN
                tech_list := string_to_array(NEW."technicianCode", ',');
                IF array_length(tech_list, 1) > 0 THEN
                    FOREACH tech_code IN ARRAY tech_list
                    LOOP
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW.id, trim(tech_code), 'REWARD',
                            'B?n v?a nh?n du?c dánh giá XU?T S?C t? don hàng #' || NEW."billCode",
                            false, now()
                        );
                    END LOOP;
                END IF;
                
                -- THÊM: Báo cho Qu?y
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, 'FEEDBACK',
                    'Ðon hàng #' || NEW."billCode" || ' du?c dánh giá XU?T S?C (' || NEW.rating || ' sao)!',
                    false, now()
                );
            END IF;

            -- C?nh báo Admin khi b? 1 sao (Complaints)
            IF NEW.rating = 1 THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW.id, 'COMPLAINT',
                    'Khách ' || curr_customer_name || ' dánh giá T? cho don #' || NEW."billCode" || ': ' || COALESCE(NEW."feedbackNote", 'Không có ghi chú'),
                    false, now()
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
