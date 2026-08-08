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
        const { completedBookings } = await FinanceReportService.getBaseData(supabase, dateFrom, dateTo, lang);
        
        // ─── New Customers ──────────────────────────────────────────────────
        const { data: newCustomerList } = await supabase
            .from('Customers')
            .select('id, fullName, phone, email, createdAt')
            .gte('createdAt', `${dateFrom}T00:00:00`)
            .lte('createdAt', `${dateTo}T23:59:59`)
            .order('createdAt', { ascending: false })
            .limit(50);

        // ─── Top Customers (VIP) ────────────────────────────────────────────
        const customerMap: Record<string, any> = {};
        completedBookings.forEach((b: any) => {
            if (!b.customerId) return;
            const cid = b.customerId;
            if (!customerMap[cid]) customerMap[cid] = { id: cid, orders: 0, revenue: 0 };
            customerMap[cid].orders += 1;
            customerMap[cid].revenue += Number(b.totalAmount) || 0;
        });

        let topCustomersData: any[] = [];
        const topCustomerIds = Object.keys(customerMap).sort((a, b) => customerMap[b].revenue - customerMap[a].revenue).slice(0, 50);
        
        if (topCustomerIds.length > 0) {
            const { data: topCus } = await supabase
                .from('Customers')
                .select('id, fullName, phone, email')
                .in('id', topCustomerIds);
            
            topCustomersData = (topCus || []).map((c: any) => ({
                id: c.id,
                name: c.fullName || 'Khách',
                phone: c.phone || '',
                email: c.email || '',
                orders: customerMap[c.id]?.orders || 0,
                revenue: customerMap[c.id]?.revenue || 0
            })).sort((a, b) => b.revenue - a.revenue);
        }

        // ─── Language Breakdown ─────────────────────────────────────────────
        const langBreakdown: Record<string, { revenue: number, orders: number }> = {};
        completedBookings.forEach((b: any) => {
            const bLang = (b.customerLang || 'VN').toUpperCase();
            if (!langBreakdown[bLang]) langBreakdown[bLang] = { revenue: 0, orders: 0 };
            langBreakdown[bLang].revenue += Number(b.totalAmount) || 0;
            langBreakdown[bLang].orders += 1;
        });
        const languageBreakdown = Object.entries(langBreakdown).map(([key, value]) => ({
            key, lang: key, revenue: value.revenue, orders: value.orders
        }));

        return NextResponse.json({ 
            success: true, 
            newCustomerList: (newCustomerList || []).map((c: any) => ({
                id: c.id,
                name: c.fullName || 'Khách',
                phone: c.phone || '',
                email: c.email || '',
                createdAt: c.createdAt ? (c.createdAt.endsWith('Z') || c.createdAt.match(/[+-]\d{2}:?\d{2}$/) ? c.createdAt : c.createdAt + 'Z') : null,
            })),
            topCustomersData,
            languageBreakdown
        });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ success: false, error: 'Failed to fetch customers data' }, { status: 500 });
    }
}
