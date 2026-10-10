import { NextResponse } from 'next/server';
import { HandlerContext, HandlerResult } from '../_shared/utils';

/** Work release and cleaning debt are independent; never infer completion from an item ID. */
export async function handleReleaseKTV(ctx: HandlerContext): Promise<HandlerResult> {
    const { supabase, technicianCode, bookingId, body } = ctx;
    // Ghi log lý do: Vercel chỉ lưu mã 409, trước đây phải tra DB mới biết vì sao bàn giao hỏng
    // (ca T027 10/10/2026 bấm 12 lần không rõ nguyên nhân).
    const fail = (error: string): HandlerResult => {
        console.error(`[RELEASE_KTV] ${bookingId} / ${technicianCode}: ${error}`);
        return { bookingUpdatePayload: {}, earlyResponse: NextResponse.json({ success: false, error }, { status: 409 }) };
    };
    if (!technicianCode) return fail('Thiếu mã KTV.');
    const inputs = body.photosBase64 ?? [];
    if (!Array.isArray(inputs) || inputs.length > 20) return fail('Danh sách ảnh không hợp lệ.');
    const urls: string[] = [];
    try {
        for (const raw of inputs) {
            const match = typeof raw === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw) : null;
            if (!match) return fail('Ảnh bàn giao không hợp lệ.');
            const bytes = Buffer.from(match[2], 'base64');
            const mime = match[1].toLowerCase();
            const valid = mime === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
                : mime === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
                : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
            if (!bytes.length || bytes.length > 5 * 1024 * 1024 || !valid) return fail('Ảnh bàn giao sai định dạng hoặc quá 5 MB.');
            const { data, error } = await supabase.storage.from('attendance').upload(
                `handover-photos/${crypto.randomUUID()}.${mime === 'jpeg' ? 'jpg' : mime}`, bytes,
                { contentType: `image/${mime}`, upsert: false });
            if (error || !data?.path) return fail('Chưa tải được đầy đủ ảnh. Ảnh trên thiết bị được giữ lại; thử lại.');
            const { data: url } = supabase.storage.from('attendance').getPublicUrl(data.path);
            if (!url?.publicUrl) return fail('Chưa đọc được URL ảnh.');
            urls.push(url.publicUrl);
        }
        const { data, error } = await supabase.rpc('ktv_release_work_atomic', {
            p_booking_id: bookingId, p_employee_id: technicianCode, p_photo_urls: urls,
            p_item_ids: Array.isArray(body.handoverItemIds) ? body.handoverItemIds : null,
        });
        if (error || !data?.success || !data.booking) {
            // Kèm lý do kỹ thuật rút gọn: ca T027 04/10 báo chung chung, phải tra DB mới biết là
            // promotion bị chặn bởi phân công cũ còn ACTIVE.
            const detail = String(error?.message || data?.error || data?.message || '').replace(/\s+/g, ' ').slice(0, 160);
            return fail('Chưa xác nhận được bàn giao. Tải lại trước khi thử lại; ảnh trên thiết bị được giữ nguyên.'
                + (detail ? ` (Hệ thống: ${detail})` : ''));
        }
        return { bookingUpdatePayload: {}, bookingPersisted: true, bookingData: data.booking };
    } catch (error: any) { return fail(error?.message || 'Bàn giao thất bại.'); }
}
