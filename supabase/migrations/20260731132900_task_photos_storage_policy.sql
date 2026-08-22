-- Chạy script này trong SQL Editor của Supabase để cấp quyền cho bucket 'task-photos'

-- 1. Tạo bucket (nếu chưa có)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('task-photos', 'task-photos', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Cho phép mọi người đọc ảnh (do public)
CREATE POLICY "Cho phép xem ảnh task-photos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'task-photos');

-- 3. Cho phép nhân viên (đã login) upload ảnh
CREATE POLICY "Cho phép up ảnh task-photos" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'task-photos');

-- 4. Cho phép nhân viên xóa/sửa ảnh của họ (nếu cần)
CREATE POLICY "Cho phép sửa ảnh task-photos" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING (bucket_id = 'task-photos');

CREATE POLICY "Cho phép xóa ảnh task-photos" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (bucket_id = 'task-photos');
