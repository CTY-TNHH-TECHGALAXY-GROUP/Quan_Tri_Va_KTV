import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * ================================================================
 * TẢI ẢNH KÈM ĐÁNH GIÁ QUẦY (màn Reward bên app KTV)
 * ================================================================
 * ⚠️ VÌ SAO PHẢI QUA MÁY CHỦ:
 * Trước 11/09/2026 màn Reward tải ảnh thẳng từ trình duyệt bằng `supabase` ở
 * `@/lib/supabase` — client anon TRẦN, không đọc cookie đăng nhập. Kho
 * `task-photos` chỉ cho tải lên `TO authenticated`, nên mọi lần tải đều bị RLS
 * chặn ("new row violates row-level security policy"). KTV thấy "Tải ảnh thất
 * bại!", đánh giá gửi đi không có ảnh. Kiểm DB: 0 ảnh `ktv_review_` từng vào kho.
 *
 * Mọi chỗ tải ảnh khác của app KTV (selfie bắt đầu, ảnh bàn giao, ảnh task) đều
 * đã đi qua máy chủ bằng service role. Chỗ này làm theo, nên không còn phụ thuộc
 * phiên đăng nhập bên trình duyệt có hay không.
 */
const MAX_BYTES = 10 * 1024 * 1024;   // khớp giới hạn của bucket

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const techCode = String(formData.get('techCode') || '').trim();

        if (!file || !techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu ảnh hoặc mã KTV' }, { status: 400 });
        }
        if (!String(file.type || '').startsWith('image/')) {
            return NextResponse.json({ success: false, error: 'Chỉ nhận file ảnh' }, { status: 400 });
        }
        if (file.size > MAX_BYTES) {
            return NextResponse.json({ success: false, error: 'Ảnh quá 10MB' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const fileName = `ktv_review/${techCode}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());

        const { error: upErr } = await supabase.storage
            .from('task-photos')
            .upload(fileName, buffer, { contentType: file.type, upsert: false });

        if (upErr) {
            console.error('[review-reception/upload]', upErr.message);
            return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
        }

        const { data: urlData } = supabase.storage.from('task-photos').getPublicUrl(fileName);
        return NextResponse.json({ success: true, url: urlData?.publicUrl || null });
    } catch (err: any) {
        console.error('[review-reception/upload]', err?.message || err);
        return NextResponse.json({ success: false, error: err?.message || 'Lỗi máy chủ' }, { status: 500 });
    }
}
