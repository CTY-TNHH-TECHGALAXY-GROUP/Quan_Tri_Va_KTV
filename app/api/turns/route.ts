import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        let date = searchParams.get('date');
        if (!date) {
            const d = new Date();
            const vnTime = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
            date = vnTime.getFullYear() + '-' + String(vnTime.getMonth() + 1).padStart(2, '0') + '-' + String(vnTime.getDate()).padStart(2, '0');
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data, error } = await supabase
            .from('TurnQueue')
            .select('*')
            .eq('date', date)
            .order('turns_completed', { ascending: true })
            .order('queue_position', { ascending: true });

        if (error) throw error;

        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(date);

        // Lấy lại dữ liệu mới nhất sau khi đồng bộ
        const { data: newData, error: newError } = await supabase
            .from('TurnQueue')
            .select('*')
            .eq('date', date)
            .order('turns_completed', { ascending: true })
            .order('queue_position', { ascending: true });

        
        if (newError) throw newError;

        // --- TYPE_D Sorting Logic ---
        const employeeIds = newData.map((r: any) => r.employee_id);
        const { data: staffData } = await supabase.from('Staff').select('id, work_type').in('id', employeeIds);
        const staffWorkTypeMap: Record<string, string> = {};
        (staffData || []).forEach((s: any) => { staffWorkTypeMap[s.id] = s.work_type || 'TYPE_A'; });

        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        
        const typeDIds = (staffData || []).filter((s: any) => s.work_type === 'TYPE_D').map((s: any) => s.id);
        const monthlyHoursMap: Record<string, number> = {};
        if (typeDIds.length > 0) {
            const { data: mhData } = await supabase.from('KTVMonthlyServiceHours')
                .select('staff_id, net_hours')
                .in('staff_id', typeDIds)
                .eq('month', month)
                .eq('year', year);
            (mhData || []).forEach((m: any) => { monthlyHoursMap[m.staff_id] = Number(m.net_hours) || 0; });
        }

        const others = newData.filter((r: any) => staffWorkTypeMap[r.employee_id] !== 'TYPE_D');
        const typeD = newData.filter((r: any) => staffWorkTypeMap[r.employee_id] === 'TYPE_D');
        
        // Output TYPE_D sorted by monthly_hours DESC
        typeD.sort((a: any, b: any) => (monthlyHoursMap[b.employee_id] || 0) - (monthlyHoursMap[a.employee_id] || 0));

        const finalData = [...others, ...typeD];

        return NextResponse.json({ success: true, data: finalData });

    } catch (error: any) {
        console.error('API Error (Turns):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
