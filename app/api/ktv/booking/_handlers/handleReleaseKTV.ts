import { HandlerContext } from '../_shared/utils';

/** Upload proof first, then commit the handover and queue change in one database transaction. */
export async function handleReleaseKTV(ctx: HandlerContext): Promise<void> {
    const { supabase, technicianCode, today, bookingId, body } = ctx;
    const photos = body.photosBase64 ?? [];
    if (!technicianCode || !Array.isArray(photos) || photos.length > 20) {
        throw new Error('Dữ liệu bàn giao không hợp lệ');
    }
    const urls: string[] = [];
    for (const raw of photos) {
        const match = typeof raw === 'string'
            ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw) : null;
        if (!match) throw new Error('Ảnh bàn giao không hợp lệ');
        const bytes = Buffer.from(match[2], 'base64');
        const mime = match[1].toLowerCase();
        const valid = mime === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : mime === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
        if (!bytes.length || bytes.length > 5 * 1024 * 1024 || !valid) throw new Error('Ảnh bàn giao sai định dạng hoặc quá 5 MB');
        const { data, error } = await supabase.storage.from('attendance').upload(
            `handover-photos/${crypto.randomUUID()}.${mime === 'jpeg' ? 'jpg' : mime}`, bytes,
            { contentType: `image/${mime}`, upsert: false });
        if (error || !data?.path) throw new Error('Tải ảnh bàn giao thất bại');
        const { data: publicUrl } = supabase.storage.from('attendance').getPublicUrl(data.path);
        if (!publicUrl?.publicUrl) throw new Error('Không đọc được ảnh bàn giao');
        urls.push(publicUrl.publicUrl);
    }
    const { data, error } = await supabase.rpc('ktv_release_work_root_atomic', {
        p_booking_id: bookingId, p_employee_id: technicianCode,
        p_business_date: today, p_photo_urls: urls,
    });
    if (error || !data?.success) throw new Error('Chưa xác nhận được bàn giao; tải lại trước khi thử lại');
}
