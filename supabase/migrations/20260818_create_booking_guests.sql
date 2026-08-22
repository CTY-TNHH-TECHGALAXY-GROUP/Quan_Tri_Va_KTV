-- Tạo bảng BookingGuests theo schema kiến trúc 3 cấp
CREATE TABLE IF NOT EXISTS "BookingGuests" (
    id              TEXT PRIMARY KEY,
    booking_id      TEXT NOT NULL REFERENCES "Bookings"(id) ON DELETE CASCADE,
    guest_index     INTEGER NOT NULL DEFAULT 1,
    guest_label     TEXT NOT NULL DEFAULT '',
    customer_name   TEXT,
    gender          TEXT,
    nationality     TEXT,
    bed_id          TEXT REFERENCES "Beds"(id),
    room_id         TEXT,
    notes           TEXT,
    focus_area      TEXT,
    status          TEXT NOT NULL DEFAULT 'WAITING',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(booking_id, guest_index)
);

-- Thêm cột guest_id vào BookingItems (có thể null lúc đầu cho backward compatibility)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='BookingItems' AND column_name='guest_id') THEN
        ALTER TABLE "BookingItems" ADD COLUMN guest_id TEXT REFERENCES "BookingGuests"(id);
    END IF;
END $$;

-- Tạo index để truy vấn nhanh
CREATE INDEX IF NOT EXISTS idx_booking_items_guest_id ON "BookingItems"(guest_id);

-- Enable Realtime cho bảng mới
DO $$
BEGIN
    -- Check if table is already in publication
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND tablename = 'BookingGuests'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE "BookingGuests";
    END IF;
END $$;
