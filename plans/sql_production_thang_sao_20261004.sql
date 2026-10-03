-- =====================================================================================
-- PRODUCTION — Thang đánh giá 4/5 sao (admin + kiosk + journey WRB)
-- Ngày soạn: 04/10/2026 · Nguồn: nhánh test/sequential-two-slot-handoff-20260928
-- Gồm 4 migration (đã chạy trên TEST eknggruuiuadwldacpmb ngày 02–03/10):
--   20261002110000_rating_scale_columns          thêm cột rating_scale (mặc định 4) cho Bookings / BookingItems / BookingGuests
--   20261002120000_rating_notifications_by_scale  thông báo "Xuất sắc"/chê theo thang của đúng đánh giá đó
--   20261002130000_ktvd_ledger_rating_scale       sổ Loại D lưu rating_scale; ktvd_commit_recompute ghi cột này (thiếu → 4)
--   20261003091000_enable_feedback_notification_rule  bật luật thông báo FEEDBACK cho đúng KTV được chấm
--
-- AN TOÀN VỚI CODE PRODUCTION HIỆN TẠI: mọi dữ liệu cũ / mọi lần ghi không gửi thang đều = 4,
-- y như hôm nay. Thang 5 chỉ có hiệu lực khi code mới (admin + WRB) lên và admin chọn 5 sao.
--
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor của project PRODUCTION → dán cả file → Run.
-- Cả file chạy trong 1 transaction: lỗi ở đâu thì không có gì được ghi.
-- =====================================================================================

-- [0] Chặn chạy nhầm: phải là DB có bảng KTVDTurnLedger và hàm ktvd_commit_recompute (writer v2, 20260922090000).
DO $$
BEGIN
  IF to_regclass('public."KTVDTurnLedger"') IS NULL THEN
    RAISE EXCEPTION 'Thiếu bảng KTVDTurnLedger — DB này chưa có migration 20260922090000, dừng.';
  END IF;
  IF to_regprocedure('public.ktvd_commit_recompute(integer,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Thiếu hàm ktvd_commit_recompute — DB này chưa có migration 20260922090000, dừng.';
  END IF;
END $$;

BEGIN;


-- ───────────────────────────── 20261002110000_rating_scale_columns ─────────────────────────────
-- plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md (GĐ1, 02/10/2026)
-- Mỗi đánh giá lưu kèm thang lúc chấm (4 hoặc 5 sao). Mặc định 4 = toàn bộ đánh giá cũ,
-- nên đổi thang trong Cài đặt không làm đổi tiền / thưởng / báo cáo của đánh giá đã có.
-- ADD COLUMN ... DEFAULT hằng số chỉ ghi metadata (không viết lại bảng).
ALTER TABLE "Bookings"      ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
ALTER TABLE "BookingItems"  ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
ALTER TABLE "BookingGuests" ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;

DO $$ BEGIN
  ALTER TABLE "Bookings"      ADD CONSTRAINT bookings_rating_scale_check      CHECK (rating_scale IN (4,5));
  ALTER TABLE "BookingItems"  ADD CONSTRAINT bookingitems_rating_scale_check  CHECK (rating_scale IN (4,5));
  ALTER TABLE "BookingGuests" ADD CONSTRAINT bookingguests_rating_scale_check CHECK (rating_scale IN (4,5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN "Bookings".rating_scale      IS 'Thang sao lúc chấm rating (4|5). Diễn giải rating theo cột này.';
COMMENT ON COLUMN "BookingItems".rating_scale  IS 'Thang sao lúc chấm itemRating/ktvRatings (4|5).';
COMMENT ON COLUMN "BookingGuests".rating_scale IS 'Thang sao lúc chấm rating/ktv_ratings của khách (4|5).';

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002110000', 'rating_scale_columns') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261002120000_rating_notifications_by_scale ─────────────────────────────
-- plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md (GĐ4, 02/10/2026)
-- Thông báo đánh giá theo thang của ĐÚNG đánh giá đó (rating_scale 4|5): "XUẤT SẮC"/thưởng chỉ
-- khi đạt mức cao nhất của thang; nhãn lấy theo cấu hình admin `rating_labels` (nội bộ),
-- thiếu thì dùng chữ mặc định — cùng quy tắc với lib/services/RatingScaleService.ts.
-- Thân 2 trigger copy nguyên bản đang chạy, chỉ thay các chỗ viết cứng thang 4.
CREATE OR REPLACE FUNCTION rating_is_excellent(p_rating numeric, p_scale integer)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_rating, 0) >= CASE WHEN p_scale = 5 THEN 5 ELSE 4 END;
$$;

CREATE OR REPLACE FUNCTION rating_label_internal(p_rating numeric, p_scale integer)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scale integer := CASE WHEN p_scale = 5 THEN 5 ELSE 4 END;
  v_level integer := LEAST(GREATEST(round(COALESCE(p_rating, 0))::integer, 0), v_scale);
  v_custom text;
BEGIN
  IF v_level <= 0 THEN RETURN 'Không xác định'; END IF;
  SELECT NULLIF(btrim(jsonb_unwrap_string(value)->(v_scale::text)->(v_level::text)->>'internal'), '')
    INTO v_custom FROM "SystemConfigs" WHERE key = 'rating_labels';
  IF v_custom IS NOT NULL THEN RETURN upper(v_custom); END IF;
  RETURN CASE
    WHEN v_level >= v_scale THEN 'XUẤT SẮC'
    WHEN v_scale = 5 AND v_level = 4 THEN 'TUYỆT VỜI'
    WHEN v_scale = 5 AND v_level = 3 THEN 'CHƯA ỔN LẮM'
    WHEN v_scale = 5 AND v_level = 2 THEN 'THẤT VỌNG'
    WHEN v_scale = 5 THEN 'CỰC KỲ TỆ'
    WHEN v_level = 3 THEN 'TỐT'
    WHEN v_level = 2 THEN 'BÌNH THƯỜNG'
    ELSE 'TỆ' END;
END $$;
REVOKE ALL ON FUNCTION rating_label_internal(numeric, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_notify_ktv_on_item_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $fn$
DECLARE
    v_booking RECORD;
    v_tech_code TEXT;
    v_ktv_ratings JSONB;
    v_old_ktv_ratings JSONB;
    v_rating_label TEXT;
    v_ktv_rating INTEGER;
  v_scale INTEGER := CASE WHEN NEW.rating_scale = 5 THEN 5 ELSE 4 END;
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
                v_rating_label := rating_label_internal(v_ktv_rating, v_scale);

                IF rating_is_excellent(v_ktv_rating, v_scale) THEN
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
                        'Bạn nhận được đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false, now()
                    );
                    -- Cảnh báo Admin
                    INSERT INTO public."StaffNotifications" (
                        "bookingId", "employeeId", "type", "message", "isRead", "createdAt"
                    ) VALUES (
                        NEW."bookingId", NULL, 'COMPLAINT',
                        'Khách đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' cho NV ' || v_tech_code || ' trong đơn #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                        false, now()
                    );
                END IF;
            END IF;
        END LOOP;

        RETURN NEW;
    END IF;

    -- ─── 2. XỬ LÝ THEO ITEMRATING CHUNG (Fallback) ────────────────────────
    IF OLD."itemRating" IS DISTINCT FROM NEW."itemRating" AND NEW."itemRating" IS NOT NULL THEN
        v_rating_label := rating_label_internal(NEW."itemRating", v_scale);

        IF NEW."technicianCodes" IS NOT NULL AND array_length(NEW."technicianCodes", 1) > 0 THEN
            v_tech_code := trim(NEW."technicianCodes"[1]);
        ELSE
            v_tech_code := v_booking."technicianCode";
        END IF;

        IF v_tech_code IS NULL OR v_tech_code = '' THEN
            RETURN NEW;
        END IF;

        IF rating_is_excellent(NEW."itemRating", v_scale) THEN
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
                'Khách đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' cho NV ' || COALESCE(v_tech_code, '?') || ' trong đơn #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
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
                            'Bạn nhận được đánh giá ' || COALESCE(v_rating_label, 'TỆ') || ' từ đơn hàng #' || COALESCE(v_booking."billCode", '???') || '. ' || COALESCE(NEW."itemFeedback", ''),
                            false, now()
                        );
                    END IF;
                END LOOP;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$
;

CREATE OR REPLACE FUNCTION public.fn_master_notification_handler()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $fn$
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
            IF rating_is_excellent(NEW.rating, NEW.rating_scale) THEN
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
$fn$
;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002120000', 'rating_notifications_by_scale') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261002130000_ktvd_ledger_rating_scale ─────────────────────────────
-- plans/plan_thang_danh_gia_4_5_sao_va_khau_tru_abc_20261002.md (GĐ4, 02/10/2026)
-- Sổ Loại D lưu thang của `rating_used` (4|5) để ví / lịch sử gọi đúng tên mức sao và truy vết
-- được trừ/thưởng. Mặc định 4 = mọi dòng cũ. Thân ktvd_commit_recompute copy nguyên bản đang
-- chạy, chỉ thêm cột rating_scale vào 4 danh sách cột.
ALTER TABLE "KTVDTurnLedger" ADD COLUMN IF NOT EXISTS rating_scale smallint NOT NULL DEFAULT 4;
DO $$ BEGIN
  ALTER TABLE "KTVDTurnLedger" ADD CONSTRAINT ktvdturnledger_rating_scale_check CHECK (rating_scale IN (4,5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.ktvd_commit_recompute(p_formula_revision integer, p_writer_commit text, p_entries jsonb, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_expected INTEGER;
  v_matched INTEGER;
  v_rows_written INTEGER := 0;
  v_rows_voided INTEGER := 0;
  v_rows_locked INTEGER := 0;
BEGIN
  IF p_formula_revision <> 2 THEN
    RAISE EXCEPTION 'Unsupported KTV commission formula revision: %', p_formula_revision;
  END IF;
  IF COALESCE(BTRIM(p_writer_commit), '') = '' THEN
    RAISE EXCEPTION 'writer_commit is required';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'entries and rows must be JSON arrays';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT e.booking_item_id)
    INTO v_expected, v_matched
  FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT);
  IF v_expected = 0 OR v_expected <> v_matched THEN
    RAISE EXCEPTION 'entries must contain unique booking_item_id values';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    WHERE e.booking_item_id IS NULL OR e.generation IS NULL
  ) THEN
    RAISE EXCEPTION 'each entry requires booking_item_id and generation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(staff_id TEXT, booking_item_id TEXT)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
      WHERE e.booking_item_id = r.booking_item_id
    )
  ) THEN
    RAISE EXCEPTION 'result contains a booking item outside the claimed queue entries';
  END IF;

  -- Serialize against source-trigger enqueues for these exact queue rows.
  PERFORM q."booking_item_id"
  FROM public."KTVDRecomputeQueue" q
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = q."booking_item_id"
  FOR UPDATE OF q;

  SELECT COUNT(*) INTO v_matched
  FROM public."KTVDRecomputeQueue" q
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = q."booking_item_id"
   AND e.generation = q."generation";
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'KTV recompute source changed or queue entry is missing';
  END IF;

  PERFORM set_config('app.ktvd_formula_revision', p_formula_revision::TEXT, true);

  SELECT COUNT(*) INTO v_rows_locked
  FROM public."KTVDTurnLedger" l
  JOIN jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
    ON e.booking_item_id = l."booking_item_id"
  WHERE l."entry_status" = 'LOCKED';

  INSERT INTO public."KTVDTurnLedger" AS ledger (
    "staff_id", "booking_item_id", "booking_id", "guest_id", "group_id", "work_date",
    "bill_code", "bill_suffix", "service_id", "service_name", "rate_category", "booking_time_start",
    "assigned_minutes", "actual_minutes", "paid_minutes", "custom_minutes",
    "rate_per_60m", "rating_used", "rating_source", "rating_scale", "deduction_rate",
    "commission_gross", "commission_net", "bonus_amount", "tax_amount", "tip",
    "item_status", "is_provisional", "entry_status", "handover_status", "handover_comment",
    "co_workers", "has_other_type_coworker", "source", "computed_at", "formula_revision", "writer_commit"
  )
  SELECT
    r.staff_id, r.booking_item_id, r.booking_id, r.guest_id, r.group_id, r.work_date,
    r.bill_code, COALESCE(r.bill_suffix, ''), r.service_id, r.service_name, r.rate_category, r.booking_time_start,
    r.assigned_minutes, r.actual_minutes, r.paid_minutes, r.custom_minutes,
    r.rate_per_60m, r.rating_used, r.rating_source, COALESCE(r.rating_scale, 4), r.deduction_rate,
    r.commission_gross, r.commission_net, COALESCE(r.bonus_amount, 0), r.tax_amount, r.tip,
    r.item_status, r.is_provisional, r.entry_status, r.handover_status, r.handover_comment,
    COALESCE(r.co_workers, ARRAY[]::TEXT[]), COALESCE(r.has_other_type_coworker, FALSE),
    'EVENT', NOW(), p_formula_revision, p_writer_commit
  FROM jsonb_to_recordset(p_rows) AS r(
    staff_id TEXT, booking_item_id TEXT, booking_id TEXT, guest_id TEXT, group_id TEXT, work_date DATE,
    bill_code TEXT, bill_suffix TEXT, service_id TEXT, service_name TEXT, rate_category TEXT,
    booking_time_start TIMESTAMP, assigned_minutes NUMERIC, actual_minutes NUMERIC, paid_minutes NUMERIC,
    custom_minutes NUMERIC, rate_per_60m NUMERIC, rating_used INTEGER, rating_source TEXT, rating_scale SMALLINT,
    deduction_rate NUMERIC, commission_gross NUMERIC, commission_net NUMERIC, bonus_amount NUMERIC,
    tax_amount NUMERIC, tip NUMERIC, item_status TEXT, is_provisional BOOLEAN, entry_status TEXT,
    handover_status TEXT, handover_comment TEXT, co_workers TEXT[], has_other_type_coworker BOOLEAN
  )
  ON CONFLICT ("staff_id", "booking_item_id") DO UPDATE SET
    "booking_id" = EXCLUDED."booking_id", "guest_id" = EXCLUDED."guest_id",
    "group_id" = EXCLUDED."group_id", "work_date" = EXCLUDED."work_date",
    "bill_code" = EXCLUDED."bill_code", "bill_suffix" = EXCLUDED."bill_suffix",
    "service_id" = EXCLUDED."service_id", "service_name" = EXCLUDED."service_name",
    "rate_category" = EXCLUDED."rate_category", "booking_time_start" = EXCLUDED."booking_time_start",
    "assigned_minutes" = EXCLUDED."assigned_minutes", "actual_minutes" = EXCLUDED."actual_minutes",
    "paid_minutes" = EXCLUDED."paid_minutes", "custom_minutes" = EXCLUDED."custom_minutes",
    "rate_per_60m" = EXCLUDED."rate_per_60m", "rating_used" = EXCLUDED."rating_used", "rating_scale" = EXCLUDED."rating_scale",
    "rating_source" = EXCLUDED."rating_source", "deduction_rate" = EXCLUDED."deduction_rate",
    "commission_gross" = EXCLUDED."commission_gross", "commission_net" = EXCLUDED."commission_net",
    "bonus_amount" = EXCLUDED."bonus_amount", "tax_amount" = EXCLUDED."tax_amount", "tip" = EXCLUDED."tip",
    "item_status" = EXCLUDED."item_status", "is_provisional" = EXCLUDED."is_provisional",
    "entry_status" = EXCLUDED."entry_status", "handover_status" = EXCLUDED."handover_status",
    "handover_comment" = EXCLUDED."handover_comment", "co_workers" = EXCLUDED."co_workers",
    "has_other_type_coworker" = EXCLUDED."has_other_type_coworker", "source" = EXCLUDED."source",
    "computed_at" = EXCLUDED."computed_at", "formula_revision" = EXCLUDED."formula_revision",
    "writer_commit" = EXCLUDED."writer_commit"
  WHERE ledger."entry_status" <> 'LOCKED';
  GET DIAGNOSTICS v_rows_written = ROW_COUNT;

  UPDATE public."KTVDTurnLedger" l
  SET "entry_status" = 'VOID', "source" = 'EVENT', "computed_at" = NOW(),
      "formula_revision" = p_formula_revision, "writer_commit" = p_writer_commit
  WHERE l."entry_status" NOT IN ('LOCKED', 'VOID')
    AND EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
      WHERE e.booking_item_id = l."booking_item_id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(staff_id TEXT, booking_item_id TEXT)
      WHERE r.staff_id = l."staff_id" AND r.booking_item_id = l."booking_item_id"
    );
  GET DIAGNOSTICS v_rows_voided = ROW_COUNT;

  DELETE FROM public."KTVDRecomputeQueue" q
  USING jsonb_to_recordset(p_entries) AS e(booking_item_id TEXT, generation BIGINT)
  WHERE q."booking_item_id" = e.booking_item_id
    AND q."generation" = e.generation;
  GET DIAGNOSTICS v_matched = ROW_COUNT;
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'KTV queue acknowledgement lost a source generation';
  END IF;

  RETURN jsonb_build_object(
    'itemsRequested', v_expected,
    'rowsWritten', v_rows_written,
    'rowsVoided', v_rows_voided,
    'rowsSkippedLocked', v_rows_locked
  );
END;
$fn$
;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261002130000', 'ktvd_ledger_rating_scale') ON CONFLICT (version) DO NOTHING;

-- ───────────────────────────── 20261003091000_enable_feedback_notification_rule ─────────────────────────────
-- 03/10/2026: kiosk feedback now writes its FEEDBACK notification (column fix in
-- app/reception/feedback/_components/actions.ts). Turn the FEEDBACK rule on so the rated KTV
-- sees it — ONLY that KTV: no role broadcast (allowed_roles []) + include_target_employee.
UPDATE "SystemConfigs"
SET value = jsonb_set(
      COALESCE(jsonb_unwrap_string(value), '{}'::jsonb),
      '{FEEDBACK}',
      COALESCE(jsonb_unwrap_string(value)->'FEEDBACK', '{}'::jsonb)
        || '{"enabled": true, "label": "Khách đánh giá KTV", "allowed_roles": [], "include_target_employee": true, "require_on_shift": false}'::jsonb,
      true),
    updated_at = now()
WHERE key = 'notification_rules';

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261003091000', 'enable_feedback_notification_rule') ON CONFLICT (version) DO NOTHING;

COMMIT;

-- =====================================================================================
-- [Kiểm tra sau khi chạy] — chạy riêng, mọi dòng phải ra như ghi chú
-- =====================================================================================
-- 1) 4 bảng có cột rating_scale, mặc định 4:
-- SELECT table_name, column_default FROM information_schema.columns
--  WHERE column_name = 'rating_scale' AND table_schema = 'public' ORDER BY 1;
--   → Bookings, BookingGuests, BookingItems, KTVDTurnLedger · default 4
-- 2) Dữ liệu cũ đều là thang 4 (0 dòng khác 4):
-- SELECT count(*) FROM "BookingItems" WHERE rating_scale <> 4;
-- 3) Hàm mới có mặt:
-- SELECT proname FROM pg_proc WHERE proname IN ('rating_is_excellent','rating_label_internal','fn_notify_ktv_on_item_rating','fn_master_notification_handler','ktvd_commit_recompute');
-- 4) Luật FEEDBACK đã bật:
-- SELECT value->'FEEDBACK' FROM "SystemConfigs" WHERE key = 'notification_rules';
-- 5) Đã ghi lịch sử migration:
-- SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('20261002110000','20261002120000','20261002130000','20261003091000');
