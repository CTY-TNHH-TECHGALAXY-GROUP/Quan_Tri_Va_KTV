-- Khởi tạo bảng Reminders
CREATE TABLE IF NOT EXISTS public."Reminders" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Chèn dữ liệu mặc định (Seed Data)
INSERT INTO public."Reminders" (content, order_index) VALUES
    ('NHẮC KHÁCH KIỂM TRA ĐỒ', 1),
    ('TẮT THIẾT BỊ', 2),
    ('TẮT THIẾT BỊ CHỤP HÌNH BÀN GIAO', 3),
    ('KHÔNG NÓI CHUYỆN RIÊNG', 4),
    ('KIỂM TRA NƯỚC NÓNG TRƯỚC KHI GỘI', 5),
    ('LÁT CÓ THỢ LÊN', 6),
    ('ĐỌC KỸ BILL', 7),
    ('ĐỔ XÔ NƯỚC Ở V3', 8),
    ('ĐỔ XÔ NƯỚC Ở PG', 9);

-- Bật RLS
ALTER TABLE public."Reminders" ENABLE ROW LEVEL SECURITY;

-- Policy đơn giản cho phép authenticated users đọc/ghi
CREATE POLICY "Enable read access for all authenticated users" 
ON public."Reminders" FOR SELECT 
TO authenticated USING (true);

CREATE POLICY "Enable insert access for all authenticated users" 
ON public."Reminders" FOR INSERT 
TO authenticated WITH CHECK (true);

CREATE POLICY "Enable update access for all authenticated users" 
ON public."Reminders" FOR UPDATE 
TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete access for all authenticated users" 
ON public."Reminders" FOR DELETE 
TO authenticated USING (true);
