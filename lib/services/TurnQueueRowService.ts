import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tạo / mở lại dòng TurnQueue của KTV — dùng chung cho "Oria xin chào"
 * (B/C qua `KtvOnlineService`, D qua `KtvTypeDOnlineService`) và cổng điều phối
 * (`processDispatch`). Chốt 14/09/2026, plan `plans/plan_dieu_phoi_ktv_chua_diem_danh.md`.
 *
 * Hai lỗi cũ lý do tách ra đây:
 *   · Oria xin chào ghi `status:'waiting'` vô điều kiện → KTV được quầy phân đơn
 *     trước (dòng `assigned`/`working`) rồi mới bấm là đơn đang làm bị ghi đè
 *     thành "Sẵn sàng": quầy phân chồng, phiếu ACTIVE bị đóng sớm.
 *   · RPC `dispatch_confirm_booking` không set `check_in_order`/`queue_position`
 *     → DB DEFAULT 1 → người chưa điểm danh được phân đơn chen lên #1 tua.
 */

const BUSY_STATUSES = ['assigned', 'working'];

const maxOrderOfDay = async (supabase: SupabaseClient, businessDate: string) => {
    const [{ data: posRow }, { data: checkInRow }] = await Promise.all([
        supabase.from('TurnQueue').select('queue_position').eq('date', businessDate)
            .order('queue_position', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
        supabase.from('TurnQueue').select('check_in_order').eq('date', businessDate)
            .order('check_in_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ]);
    return {
        maxPosition: Number((posRow as any)?.queue_position) || 0,
        maxCheckIn: Number((checkInRow as any)?.check_in_order) || 0,
    };
};

export type ArrivalResult = 'inserted' | 'reopened' | 'kept_busy' | 'failed';

/**
 * KTV bấm "Oria xin chào".
 *   · Chưa có dòng → tạo `waiting` ở cuối hàng.
 *   · Dòng đang `assigned`/`working` → GIỮ NGUYÊN (không đè đơn đang làm).
 *   · Dòng khác (`off`, `waiting`…) → `waiting`; `moveToEndWhenIdle` thì dời xuống
 *     cuối hàng như hành vi cũ của loại B, loại D giữ chỗ cũ.
 *
 * Lỗi chỉ log, không ném — giữ đúng hành vi cũ: bản ghi điểm danh đã lưu trước
 * bước này, không được biến lần bấm thành "thất bại".
 */
export async function applyArrivalToTurnQueue(
    supabase: SupabaseClient,
    opts: { staffId: string; businessDate: string; moveToEndWhenIdle: boolean }
): Promise<ArrivalResult> {
    const { staffId, businessDate, moveToEndWhenIdle } = opts;
    try {
        const { data: existing, error } = await supabase
            .from('TurnQueue')
            .select('id, status')
            .eq('employee_id', staffId)
            .eq('date', businessDate)
            .maybeSingle();
        if (error) throw error;

        if (existing && BUSY_STATUSES.includes(String((existing as any).status))) return 'kept_busy';

        if (existing) {
            const patch: Record<string, unknown> = { status: 'waiting' };
            if (moveToEndWhenIdle) {
                const { maxPosition, maxCheckIn } = await maxOrderOfDay(supabase, businessDate);
                patch.queue_position = maxPosition + 1;
                patch.check_in_order = maxCheckIn + 1;
            }
            const { error: updateError } = await supabase.from('TurnQueue').update(patch).eq('id', (existing as any).id);
            if (updateError) throw updateError;
            return 'reopened';
        }

        const { maxPosition, maxCheckIn } = await maxOrderOfDay(supabase, businessDate);
        const { error: insertError } = await supabase.from('TurnQueue').upsert({
            employee_id: staffId,
            date: businessDate,
            status: 'waiting',
            queue_position: maxPosition + 1,
            check_in_order: maxCheckIn + 1,
            turns_completed: 0,
        }, { onConflict: 'employee_id,date', ignoreDuplicates: true });
        if (insertError) throw insertError;
        return 'inserted';
    } catch (err: any) {
        console.error('[applyArrivalToTurnQueue] không lên tua được cho', staffId, err?.message || err);
        return 'failed';
    }
}

/**
 * Quầy xác nhận phân đơn cho KTV CHƯA có dòng TurnQueue hôm đó: tạo trước dòng
 * `waiting` ở CUỐI hàng, rồi RPC điều phối upsert nó thành `assigned` (RPC không
 * đụng `check_in_order`/`queue_position` của dòng đã có).
 * `ignoreDuplicates`: dòng có sẵn (race) thì giữ nguyên.
 */
export async function ensureTurnRowsAtEnd(
    supabase: SupabaseClient,
    staffIds: string[],
    businessDate: string
): Promise<void> {
    const ids = Array.from(new Set(staffIds.filter(Boolean)));
    if (ids.length === 0) return;
    try {
        const { maxPosition, maxCheckIn } = await maxOrderOfDay(supabase, businessDate);
        const rows = ids.map((id, i) => ({
            employee_id: id,
            date: businessDate,
            status: 'waiting',
            queue_position: maxPosition + i + 1,
            check_in_order: maxCheckIn + i + 1,
            turns_completed: 0,
        }));
        const { error } = await supabase.from('TurnQueue').upsert(rows, { onConflict: 'employee_id,date', ignoreDuplicates: true });
        if (error) throw error;
    } catch (err: any) {
        console.error('[ensureTurnRowsAtEnd] không tạo được dòng TurnQueue:', ids, err?.message || err);
    }
}
