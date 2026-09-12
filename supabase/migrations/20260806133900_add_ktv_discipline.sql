-- Bảng quản lý điểm chuyên cần KTV
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

-- Bảng lưu lịch sử trừ điểm
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

-- Khởi tạo rules trong SystemConfigs (Insert if not exists)
INSERT INTO "public"."SystemConfigs" ("key", "value", "description", "created_at", "updated_at")
VALUES (
    'ktv_discipline_rules',
    '[
      {"code": "RECEPTION_COMPLAINT", "name": "Quầy complain", "points": 5},
      {"code": "HANDOVER_REJECT", "name": "Lỗi bàn giao quầy không duyệt", "points": 5},
      {"code": "ORDER_REJECT", "name": "Từ chối nhận đơn hàng", "points": 10}
    ]'::jsonb,
    'Cấu hình quy tắc trừ điểm kỷ luật KTV',
    now(),
    now()
) ON CONFLICT ("key") DO NOTHING;
