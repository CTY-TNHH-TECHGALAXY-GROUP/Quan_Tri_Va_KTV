import { NextResponse, after } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvTypeDTurnService } from '@/lib/services/KtvTypeDTurnService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        let date = searchParams.get('date');
        const workType = searchParams.get('workType'); // TYPE_A | TYPE_B | TYPE_C | TYPE_D | null

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        if (!date) {
            const { getBusinessToday } = await import('@/lib/business-date');
            date = await getBusinessToday(supabase);
        }

        // Sync turns first (count tua from TurnLedger)
        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(date);

        // Fetch TurnQueue with Staff info
        const { data: rawData, error } = await supabase
            .from('TurnQueue')
            .select(`
                *,
                Staff!inner ( id, work_type, full_name )
            `)
            .eq('date', date);

        if (error) throw error;
        if (!rawData || rawData.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // Flatten Staff info onto each turn record
        const allTurns = rawData.map((t: any) => ({
            ...t,
            work_type: t.Staff?.work_type || 'TYPE_A',
            staff_name: t.Staff?.full_name || '',
            Staff: undefined // Remove nested object from response
        }));

        // --- Determine which types to include ---
        const VALID_TYPES = ['TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'];
        let filtered: any[];

        if (workType && VALID_TYPES.includes(workType)) {
            // Specific type filter
            filtered = allTurns.filter((t: any) => t.work_type === workType);
        } else {
            // Default "Tất cả" = A + B + D — ❗ EXCLUDE C
            filtered = allTurns.filter((t: any) => t.work_type !== 'TYPE_C');
        }

        // --- Sort by type group ---
        const typeA = filtered.filter((t: any) => t.work_type === 'TYPE_A');
        const typeB = filtered.filter((t: any) => t.work_type === 'TYPE_B');
        const typeC = filtered.filter((t: any) => t.work_type === 'TYPE_C');
        const typeD = filtered.filter((t: any) => t.work_type === 'TYPE_D');

        // A & B: sort by turns_completed ASC → check_in_order ASC → employee_id ASC
        const sortABC = (a: any, b: any) => {
            if ((a.turns_completed || 0) !== (b.turns_completed || 0)) {
                return (a.turns_completed || 0) - (b.turns_completed || 0);
            }
            if ((a.check_in_order || 0) !== (b.check_in_order || 0)) {
                return (a.check_in_order || 0) - (b.check_in_order || 0);
            }
            return (a.employee_id || '').localeCompare(b.employee_id || '');
        };

        typeA.sort(sortABC);
        typeB.sort(sortABC);
        typeC.sort(sortABC);

        // D: sort by net_hours DESC → check_in_order ASC → employee_id ASC
        if (typeD.length > 0) {
            const typeDIds = typeD.map((t: any) => t.employee_id);
            // Tháng/năm theo NGÀY LÀM VIỆC đang xét (`date`), không theo ngày lịch —
            // lúc 02:00 ngày 01/09 thì ngày làm việc vẫn là 31/08.
            const year = Number(date.slice(0, 4));
            const month = Number(date.slice(5, 7));

            // Tua vừa xong còn nằm trong hàng đợi cho tới khi có người rút ra tính.
            // Rút ngay phần của những KTV đang xem để giờ tích lũy cập nhật tức thì,
            // giống cách màn Lịch sử và Ví đang làm.
            const { drainQueueForStaff, drainQueueBackground } = await import('@/lib/services/KtvDLedgerWriter');
            await drainQueueForStaff(supabase, typeDIds);

            // Phần hàng đợi không thuộc KTV nào trong bảng thì dọn SAU khi đã trả
            // response — xem `drainQueueBackground`. Không có bước này thì hàng đợi
            // vẫn phình vô hạn vì trigger đẩy vào cả item của loại A/B/C.
            after(async () => { await drainQueueBackground(supabase); });

            const hoursMap = await KtvTypeDTurnService.getMonthlyNetHours(supabase, typeDIds, month, year);

            // Enrich with net_hours
            typeD.forEach((t: any) => {
                t.net_hours = hoursMap[t.employee_id] || 0;
            });

            // Sort: net_hours DESC → check_in_order ASC → employee_id ASC
            typeD.sort((a: any, b: any) => {
                if ((b.net_hours || 0) !== (a.net_hours || 0)) {
                    return (b.net_hours || 0) - (a.net_hours || 0);
                }
                if ((a.check_in_order || 0) !== (b.check_in_order || 0)) {
                    return (a.check_in_order || 0) - (b.check_in_order || 0);
                }
                return (a.employee_id || '').localeCompare(b.employee_id || '');
            });
        }

        // Combine: [A] → [B] → [C] → [D] (C only when specifically filtered)
        const finalData = [...typeA, ...typeB, ...typeC, ...typeD];

        return NextResponse.json({ success: true, data: finalData });

    } catch (error: any) {
        console.error('API Error (Turns):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
