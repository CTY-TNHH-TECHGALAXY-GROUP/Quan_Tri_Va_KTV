'use server';

import { requireBusinessUser, requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function saveTurnQueueEdits(date: string, action: 'ORDER' | 'RESET' | 'DELTA', payload: unknown) {
    try {
        if (!await requireBusinessUser()) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        await requirePermission('turn_tracking');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['ORDER', 'RESET', 'DELTA'].includes(action)) {
            throw new Error('Dữ liệu chỉnh lượt không hợp lệ.');
        }
        const db = getSupabaseAdmin();
        if (!db) throw new Error('Không kết nối được máy chủ.');
        const { data, error } = await db.rpc('turn_queue_apply_edits', { p_date: date, p_action: action, p_payload: payload });
        if (error) throw error;
        return { success: true, data };
    } catch (error: any) {
        return { success: false, error: error?.message || 'Không lưu được thay đổi. Bản nháp vẫn được giữ.' };
    }
}
