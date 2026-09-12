import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const customerId = formData.get('customerId') as string;

        if (!file || !customerId) {
            return NextResponse.json({ success: false, error: 'Thiếu file ảnh hoặc mã khách hàng (customerId)' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Lỗi khởi tạo hệ thống (Supabase)' }, { status: 500 });
        }

        // Tạo tên file ngẫu nhiên để tránh trùng lặp
        const fileExt = file.name.split('.').pop() || 'png';
        // Theo yêu cầu của user: Đặt trong thư mục con customers/[customerId]/[filename]
        const fileName = `customers/${customerId}/avatar_${uuidv4()}.${fileExt}`;
        const buffer = Buffer.from(await file.arrayBuffer());

        // Upload file lên bucket 'avatars'
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, buffer, {
                contentType: file.type,
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
        console.error('API Error (Upload Avatar):', error);
        return NextResponse.json({ success: false, error: error.message || 'Lỗi server' }, { status: 500 });
    }
}
