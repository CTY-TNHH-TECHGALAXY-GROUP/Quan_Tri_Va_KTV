-- 1. Bảng quản lý điểm chuyên cần KTV
CREATE TABLE IF NOT EXISTS "public"."KTVDisciplinePoints" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "staff_id" text NOT NULL,
    "month" integer NOT NULL,
    "year" integer NOT NULL,
    "total_points" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "KTVDisciplinePoints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KTVDisciplinePoints_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."Staff"("id") ON DELETE CASCADE,
    CONSTRAINT "KTVDisciplinePoints_month_check" CHECK ((("month" >= 1) AND ("month" <= 12)))
);

CREATE UNIQUE INDEX IF NOT EXISTS ktv_discipline_points_staff_month_year_idx ON "public"."KTVDisciplinePoints" USING btree ("staff_id", "month", "year");

-- 2. Bảng lưu lịch sử trừ điểm
CREATE TABLE IF NOT EXISTS "public"."KTVDisciplineLedger" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "staff_id" text NOT NULL,
    "rule_code" text NOT NULL,
    "points_deducted" integer NOT NULL,
    "reason" text,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "KTVDisciplineLedger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KTVDisciplineLedger_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."Staff"("id") ON DELETE CASCADE
);

-- Thêm các cột mới vào Ledger (Idempotent)
ALTER TABLE "public"."KTVDisciplineLedger"
ADD COLUMN IF NOT EXISTS "booking_id" text,
ADD COLUMN IF NOT EXISTS "images" jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'APPROVED';

-- 3. Tạo bảng Đánh giá Quầy của KTV (KTVReviewReception)
CREATE TABLE IF NOT EXISTS "public"."KTVReviewReception" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "ktv_id" text NOT NULL,
    "reception_id" text,
    "booking_id" text NOT NULL,
    "rating" integer NOT NULL DEFAULT 5,
    "note" text,
    "images" jsonb DEFAULT '[]'::jsonb,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "KTVReviewReception_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KTVReviewReception_ktv_id_fkey" FOREIGN KEY ("ktv_id") REFERENCES "public"."Staff"("id") ON DELETE CASCADE,
    CONSTRAINT "KTVReviewReception_rating_check" CHECK (("rating" >= 1) AND ("rating" <= 5))
);

-- Index tìm kiếm nhanh
CREATE INDEX IF NOT EXISTS ktv_review_reception_booking_id_idx ON "public"."KTVReviewReception" USING btree ("booking_id");
CREATE INDEX IF NOT EXISTS ktv_review_reception_ktv_id_idx ON "public"."KTVReviewReception" USING btree ("ktv_id");

-- 4. Tạo bảng Notifications
CREATE TABLE IF NOT EXISTS "public"."StaffNotifications" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "staff_id" text NOT NULL,
    "title" text NOT NULL,
    "message" text NOT NULL,
    "type" text DEFAULT 'INFO',
    "is_read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "StaffNotifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffNotifications_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."Staff"("id") ON DELETE CASCADE
);
