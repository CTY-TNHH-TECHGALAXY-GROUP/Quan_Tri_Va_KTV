import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { FinanceReportService } from '@/lib/services/FinanceReportService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const lang = searchParams.get('lang') || 'all';

    if (!dateFrom || !dateTo) {
        return NextResponse.json({ success: false, error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });

    try {
        const { completedBookings, items, svcMap } = await FinanceReportService.getBaseData(supabase, dateFrom, dateTo, lang);
        
        // ─── Service Breakdown ──────────────────────────────────────────────
        const svcBreakdown: Record<string, any> = {};
        items.forEach(item => {
            const sid = String(item.serviceId);
            const svcInfo = svcMap[sid];
            if (!svcBreakdown[sid]) {
                svcBreakdown[sid] = {
                    id: sid,
                    name: svcInfo ? svcInfo.name : sid,
                    revenue: 0,
                    count: 0,
                    duration: svcInfo ? svcInfo.duration : 60,
                    category: svcInfo ? svcInfo.category : 'Khác'
                };
            }
            svcBreakdown[sid].revenue += Number(item.price) || 0;
            svcBreakdown[sid].count += Number(item.quantity) || 1;
        });

        const serviceBreakdown = Object.values(svcBreakdown)
            .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
            .filter(s => s.revenue > 0 || s.count > 0);

        // Calculate fallback for Bookings without items but have revenue
        const emptyBookings = completedBookings.filter((b: any) => !items.some((i: any) => i.bookingId === b.id) && Number(b.totalAmount) > 0);
        if (emptyBookings.length > 0) {
            const extraRev = emptyBookings.reduce((sum: number, b: any) => sum + Number(b.totalAmount || 0), 0);
            serviceBreakdown.push({
                name: 'Dịch vụ khác / Chưa phân loại',
                revenue: extraRev,
                count: emptyBookings.length,
                duration: 0,
                category: 'Khác'
            });
        }

        // ─── Menu Evaluation ────────────────────────────────────────────────
        const { data: allActiveServices } = await supabase.from('Services').select('id, code, nameVN, duration, category').eq('isActive', true);
        const menuEvaluation = (allActiveServices || []).map((s: any) => {
            const soldService = serviceBreakdown.find(sb => sb.id === String(s.id));
            return {
                id: s.id,
                code: s.code,
                name: s.nameVN || s.code,
                duration: s.duration,
                category: s.category,
                orders: soldService ? soldService.count : 0,
                revenue: soldService ? soldService.revenue : 0
            };
        }).sort((a, b) => a.orders - b.orders);

        const serviceList = Object.values(svcBreakdown).map(s => s.name);

        return NextResponse.json({ 
            success: true, 
            serviceBreakdown, 
            menuEvaluation,
            serviceList
        });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ success: false, error: 'Failed to fetch services data' }, { status: 500 });
    }
}
