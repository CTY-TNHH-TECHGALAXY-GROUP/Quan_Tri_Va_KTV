import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * GET /api/finance/payroll/shifts?dateFrom=2026-05-01&dateTo=2026-05-31
 * Lấy lịch sử ca làm việc (vượt qua RLS)
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    if (!dateFrom || !dateTo) {
        return NextResponse.json({ success: false, error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not init' }, { status: 500 });

    try {
        const [shiftsRes, leavesRes] = await Promise.all([
            supabase
                .from('KTVShifts')
                .select('employeeId, effectiveFrom, shiftType')
                .lte('effectiveFrom', dateTo)
                .in('status', ['ACTIVE', 'REPLACED'])
                .order('employeeId', { ascending: true })
                .order('effectiveFrom', { ascending: true })
                .order('createdAt', { ascending: true }),
            supabase
                .from('KTVLeaveRequests')
                .select('*')
                .gte('date', dateFrom)
                .lte('date', dateTo)
                .eq('status', 'APPROVED')
        ]);

        if (shiftsRes.error) throw shiftsRes.error;
        if (leavesRes.error) throw leavesRes.error;

        return NextResponse.json({ 
            success: true, 
            data: {
                shifts: shiftsRes.data || [],
                leaves: leavesRes.data || []
            } 
        });
    } catch (err: any) {
        console.error('❌ [Payroll Shifts API]', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
