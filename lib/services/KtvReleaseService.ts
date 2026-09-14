import type { SupabaseClient } from '@supabase/supabase-js';
import { punishTurnIfIdle } from '@/lib/turn-punish';

/**
 * ================================================================
 * NHẢ KTV CHƯA BẮT ĐẦU KHỎI MỘT DỊCH VỤ
 * ================================================================
 * Dùng khi quầy bấm "Kết thúc" (khách về sớm) mà còn KTV chưa bắt đầu — người
 * sau trong chuỗi nối tiếp, hoặc người song song chưa vào. Họ không vào phòng
 * nên KHÔNG giữ lại để dọn/bàn giao như người đang làm: nhả ngay.
 *
 * Quyết định 14/09/2026 (plans/plan_ket_thuc_som_nguoi_chua_bat_dau.md):
 *   · 0 tiền, 0 giờ — chặng đã được tước trước khi gọi hàm này
 *     (`markNotStartedOnEarlyLeave`).
 *   · "Không làm là trừ tua" — loại theo sổ tua (A/B/C) mất lượt. Loại D xếp
 *     theo giờ tích luỹ, không có tua để trừ.
 *
 * Bước nhả TurnQueue / KtvAssignments giống nhánh "chưa bắt đầu" của
 * `BookingModificationService.cancelBookingItem` — hai chỗ phải giữ đồng bộ.
 *
 * ⚠️ Gọi SAU khi đã lưu segments đã tước: `punishTurnIfIdle` đọc lại chặng để
 * biết KTV còn việc nào trong bill không.
 * ================================================================
 */
export async function releaseNotStartedKtvFromItem(
    supabase: SupabaseClient,
    opts: { bookingId: string; itemId: string; employeeId: string; businessDate: string }
): Promise<{ turnPunished: boolean }> {
    const { bookingId, itemId, employeeId, businessDate } = opts;
    if (!bookingId || !itemId || !employeeId || !businessDate) return { turnPunished: false };

    try {
        // 1. Hàng đợi: bỏ dịch vụ này khỏi dòng của KTV. Hết dịch vụ → về chờ.
        const { data: turns } = await supabase
            .from('TurnQueue')
            .select('id, status, booking_item_ids')
            .eq('employee_id', employeeId)
            .eq('current_order_id', bookingId)
            .contains('booking_item_ids', [itemId]);

        for (const turn of (turns || []) as any[]) {
            const remaining = (turn.booking_item_ids || []).filter((id: string) => id !== itemId);
            if (remaining.length > 0) {
                await supabase.from('TurnQueue')
                    .update({ booking_item_id: remaining.join(','), booking_item_ids: remaining })
                    .eq('id', turn.id);
            } else {
                await supabase.from('TurnQueue').update({
                    status: turn.status === 'off' ? 'off' : 'waiting',
                    current_order_id: null, booking_item_id: null, booking_item_ids: [],
                    room_id: null, bed_id: null, start_time: null, estimated_end_time: null,
                }).eq('id', turn.id);
            }
        }

        // 2. Phiếu phân công của đúng dịch vụ này → huỷ, kéo đơn kế tiếp lên.
        await supabase.from('KtvAssignments')
            .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
            .eq('employee_id', employeeId)
            .eq('business_date', businessDate)
            .eq('booking_item_id', itemId)
            .in('status', ['ACTIVE', 'QUEUED', 'READY']);

        await supabase.rpc('promote_next_assignment', {
            p_employee_id: employeeId,
            p_business_date: businessDate,
        });

        // 3. Tua: chỉ loại theo sổ tua. punishTurnIfIdle tự bỏ qua nếu KTV còn việc khác trong bill.
        const { data: staff } = await supabase
            .from('Staff').select('work_type').eq('id', employeeId).maybeSingle();
        const followsTurnBook = String((staff as any)?.work_type || 'TYPE_A') !== 'TYPE_D';
        const turnPunished = followsTurnBook
            ? await punishTurnIfIdle(supabase, { bookingId, employeeId, date: businessDate })
            : false;

        return { turnPunished };
    } catch (e: any) {
        // Dịch vụ đã được chốt ở bước trước — nhả hỏng thì chỉ ghi log, không làm hỏng lệnh Kết thúc.
        console.error(`[releaseNotStartedKtvFromItem] ${employeeId} / ${itemId}:`, e?.message || e);
        return { turnPunished: false };
    }
}
