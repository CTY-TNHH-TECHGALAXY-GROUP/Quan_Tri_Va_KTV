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
    -- Chỉ chạy nếu rating có thay đổi
    IF (OLD."itemRating" IS NOT DISTINCT FROM NEW."itemRating") 
       AND (OLD."ktvRatings" IS NOT DISTINCT FROM NEW."ktvRatings") THEN
        RETURN NEW;
    END IF;

    -- Lấy thông tin booking
    SELECT "billCode", "technicianCode" INTO v_booking
    FROM public."Bookings"
    WHERE id = NEW."bookingId"
    LIMIT 1;

    v_ktv_ratings := COALESCE(NEW."ktvRatings", '{}'::JSONB);
    v_old_ktv_ratings := COALESCE(OLD."ktvRatings", '{}'::JSONB);

    -- ─── 1. XỬ LÝ THEO MẢNG KTVRATINGS (Per-KTV) ────────────────────────
    IF v_ktv_ratings != '{}'::JSONB AND NEW."technicianCodes" IS NOT NULL THEN

        FOREACH v_tech_code IN ARRAY NEW."technicianCodes"
        LOOP
            v_tech_code := trim(v_tech_code);
            IF v_tech_code = '' THEN CONTINUE; END IF;

            v_ktv_rating := COALESCE((v_ktv_ratings->>v_tech_code)::INTEGER, 0);
            v_old_ktv_rating := COALESCE((v_old_ktv_ratings->>v_tech_code)::INTEGER, 0);

            -- CHỈ XỬ LÝ NẾU RATING CỦA KTV NÀY MỚI ĐƯỢC CẬP NHẬT
            IF v_ktv_rating != v_old_ktv_rating AND v_ktv_rating > 0 THEN
                CASE v_ktv_rating
                    WHEN 4 THEN v_rating_label := 'XUẤT SẮC';
                    WHEN 3 THEN v_rating_label := 'TỐT';
                    WHEN 2 THEN v_rating_label := 'BÌNH THƯỜNG';
                    WHEN 1 THEN v_rating_label := 'TỆ';
                    ELSE v_rating_label := 'Không xác định';
                END CASE;

                IF v_ktv_rating >= 4 THEN
                    -- KTV xuất sắc → nhận thưởng
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", v_tech_code, 'REWARD',
                        'Bạn vừa nhận được đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                        false, now()
                    );
                    -- THÊM: Báo cho Quầy
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", NULL, 'FEEDBACK',
                        'KTV ' || v_tech_code || ' nhận đánh giá ' || v_rating_label || ' từ đơn #' || COALESCE(v_booking."billCode", '???'),
                        false, now()
                    );
                ELSIF v_ktv_rating = 1 THEN
                    -- KTV bị đánh giá tệ → cảnh báo
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", v_tech_code, 'COMPLAINT',
                        'Bạn nhận được đánh giá TỆ từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
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
            END IF;
        END LOOP;

        RETURN NEW;
    END IF;

    -- ─── 2. XỬ LÝ THEO ITEMRATING CHUNG (Fallback) ────────────────────────
    IF OLD."itemRating" IS DISTINCT FROM NEW."itemRating" AND NEW."itemRating" IS NOT NULL THEN
        CASE NEW."itemRating"
            WHEN 4 THEN v_rating_label := 'XUẤT SẮC';
            WHEN 3 THEN v_rating_label := 'TỐT';
            WHEN 2 THEN v_rating_label := 'BÌNH THƯỜNG';
            WHEN 1 THEN v_rating_label := 'TỆ';
            ELSE v_rating_label := 'Không xác định';
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
                            'Bạn vừa nhận được đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                            false, now()
                        );
                        -- THÊM: Báo cho Quầy
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW."bookingId", NULL, 'FEEDBACK',
                            'KTV ' || v_tech_code || ' nhận đánh giá ' || v_rating_label || ' từ đơn #' || COALESCE(v_booking."billCode", '???'),
                            false, now()
                        );
                    END IF;
                END LOOP;
            ELSIF v_booking."technicianCode" IS NOT NULL THEN
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", trim(v_booking."technicianCode"), 'REWARD',
                    'Bạn vừa nhận được đánh giá ' || v_rating_label || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
                -- THÊM: Báo cho Quầy
                INSERT INTO public."StaffNotifications" (
                    "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                ) VALUES (
                    NEW."bookingId", NULL, 'FEEDBACK',
                    'KTV ' || trim(v_booking."technicianCode") || ' nhận đánh giá ' || v_rating_label || ' từ đơn #' || COALESCE(v_booking."billCode", '???'),
                    false, now()
                );
            END IF;
        ELSIF NEW."itemRating" = 1 THEN
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
                            'Bạn nhận được đánh giá TỆ từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
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
                IF array_length(tech_list, 1) > 0 THEN
                    FOREACH tech_code IN ARRAY tech_list
                    LOOP
                        INSERT INTO public."StaffNotifications" (
                            "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                        ) VALUES (
                            NEW.id, trim(tech_code), 'REWARD',
                            'Bạn vừa nhận được đánh giá XUẤT SẮC từ đơn hàng #' || NEW."billCode",
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
