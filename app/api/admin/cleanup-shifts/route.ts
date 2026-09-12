import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/admin/cleanup-shifts
 * Dọn dẹp dữ liệu rác trong bảng KTVShifts:
 * 1. Dedup: Chỉ giữ 1 bản ghi ACTIVE mới nhất cho mỗi employeeId, chuyển các bản ghi cũ sang REPLACED.
 * 2. Cleanup: Chuyển sang REPLACED tất cả bản ghi của nhân viên đã nghỉ việc.
 * 
 * ⚠️ CHỈ DÙNG KHI CẦN DỌN DẸP DỮ LIỆU — KHÔNG CHẠY TỰ ĐỘNG.
 */
export async function POST() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // 1. Fetch all ACTIVE shifts
        const { data: allActive, error: fetchError } = await supabase
            .from('KTVShifts')
            .select('*')
            .eq('status', 'ACTIVE')
            .order('createdAt', { ascending: false });

        if (fetchError || !allActive) {
            return NextResponse.json({ success: false, error: fetchError?.message || 'No data' }, { status: 500 });
        }

        // 2. Fetch active staff
        const { data: activeStaff } = await supabase
            .from('Staff')
            .select('id')
            .eq('status', 'ĐANG LÀM');
        const activeStaffIds = new Set(activeStaff?.map(s => s.id) || []);

        // 3. Group by employeeId
        const grouped = new Map<string, typeof allActive>();
        for (const shift of allActive) {
            if (!grouped.has(shift.employeeId)) {
                grouped.set(shift.employeeId, []);
            }
            grouped.get(shift.employeeId)!.push(shift);
        }

        let replacedCount = 0;
        const idsToReplace: string[] = [];

        for (const [employeeId, shifts] of grouped) {
            // Case A: Nhân viên đã nghỉ việc → đánh dấu TẤT CẢ bản ghi là REPLACED
            if (!activeStaffIds.has(employeeId)) {
                for (const s of shifts) {
                    idsToReplace.push(s.id);
                }
                continue;
            }

            // Case B: Nhân viên đang làm nhưng có nhiều bản ghi ACTIVE → giữ lại bản ghi mới nhất
            if (shifts.length > 1) {
                // shifts đã được sort theo createdAt DESC, nên shifts[0] là mới nhất
                for (let i = 1; i < shifts.length; i++) {
                    idsToReplace.push(shifts[i].id);
                }
            }
        }

        // 4. Batch update
        if (idsToReplace.length > 0) {
            const { error: updateError } = await supabase
                .from('KTVShifts')
                .update({ status: 'REPLACED' })
                .in('id', idsToReplace);

            if (updateError) {
                return NextResponse.json({
                    success: false,
                    error: `Update failed: ${updateError.message}`,
                }, { status: 500 });
            }
            replacedCount = idsToReplace.length;
        }

        const summary = {
            totalActiveBeforeCleanup: allActive.length,
            totalEmployees: grouped.size,
            totalActiveAfterCleanup: allActive.length - replacedCount,
            replacedDuplicates: replacedCount,
            removedInactiveStaff: Array.from(grouped.keys()).filter(id => !activeStaffIds.has(id)),
        };

        console.log('✅ [Cleanup] Shift cleanup completed:', summary);

        return NextResponse.json({
            success: true,
            message: `Dọn dẹp xong! Đã chuyển ${replacedCount} bản ghi trùng/rác sang REPLACED.`,
            summary,
        });

    } catch (error: any) {
        console.error('❌ [Cleanup] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
