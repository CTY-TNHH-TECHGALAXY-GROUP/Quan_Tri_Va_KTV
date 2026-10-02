import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireBusinessUser, authErrorResponse } from '@/lib/auth-server';
import { validateImageUpload } from '@/lib/upload-guard';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        // Bucket public: người lạ không được đẩy file lên.
        const actor = await requireBusinessUser();
        if (!actor && process.env.AUTH_ENFORCE_API === '1') {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file');
        const customerId = formData.get('customerId');

        if (!file || typeof customerId !== 'string' || !customerId.trim()) {
            return NextResponse.json({ success: false, error: 'Thiếu file ảnh hoặc mã khách hàng (customerId)' }, { status: 400 });
        }

        const checked = await validateImageUpload(file);
        if (!checked.ok) {
            return NextResponse.json({ success: false, error: checked.error }, { status: checked.status });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Lỗi khởi tạo hệ thống (Supabase)' }, { status: 500 });
        }

        // Đuôi file lấy từ MIME đã kiểm, không lấy từ tên file client gửi.
        const safeCustomerId = customerId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `customers/${safeCustomerId}/avatar_${uuidv4()}.${checked.ext}`;

        // Upload file lên bucket 'avatars'
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, checked.buffer, {
                contentType: checked.mime,
                upsert: true
            });

        if (uploadError) {
            console.error('❌ [Upload Avatar] Lỗi upload ảnh:', uploadError);
            return NextResponse.json({ success: false, error: 'Lỗi tải ảnh lên server' }, { status: 500 });
        }

        if (!uploadData?.path) {
             return NextResponse.json({ success: false, error: 'Không lấy được đường dẫn ảnh' }, { status: 500 });
        }

        // Lấy public URL
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(uploadData.path);
        const publicUrl = publicUrlData.publicUrl;

        // Cập nhật URL vào database bảng Customers
        const { error: dbError } = await supabase
            .from('Customers')
            .update({ avatar_url: publicUrl, updatedAt: new Date().toISOString() })
            .eq('id', customerId);

        if (dbError) {
            console.error('❌ [Upload Avatar] Lỗi cập nhật DB:', dbError);
            return NextResponse.json({ success: false, error: 'Ảnh đã upload nhưng lỗi lưu link vào DB' }, { status: 500 });
        }

        return NextResponse.json({ success: true, url: publicUrl });

    } catch (error: any) {
        const authRes = authErrorResponse(error);
        if (authRes) return authRes;
        console.error('API Error (Upload Avatar):', error);
        return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
    }
}
