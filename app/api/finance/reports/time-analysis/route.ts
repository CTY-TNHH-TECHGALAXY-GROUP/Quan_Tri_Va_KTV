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
        
        // ─── Weekday Stats ──────────────────────────────────────────────────
        const weekdayMap: Record<number, { weekday: string, revenue: number, orders: number }> = {
            1: { weekday: 'Thứ 2', revenue: 0, orders: 0 },
            2: { weekday: 'Thứ 3', revenue: 0, orders: 0 },
            3: { weekday: 'Thứ 4', revenue: 0, orders: 0 },
            4: { weekday: 'Thứ 5', revenue: 0, orders: 0 },
            5: { weekday: 'Thứ 6', revenue: 0, orders: 0 },
            6: { weekday: 'Thứ 7', revenue: 0, orders: 0 },
            0: { weekday: 'Chủ Nhật', revenue: 0, orders: 0 }
        };

        completedBookings.forEach((b: any) => {
            const timeInfo = FinanceReportService.getVnDateInfo(b.createdAt || b.bookingDate || '');
            if (timeInfo) {
                const dateObj = new Date(timeInfo.dateStr + 'T00:00:00');
                if (!isNaN(dateObj.getTime())) {
                    const dayIndex = dateObj.getDay();
                    if (weekdayMap[dayIndex]) {
                        weekdayMap[dayIndex].revenue += Number(b.totalAmount) || 0;
                        weekdayMap[dayIndex].orders += 1;
                    }
                }
            }
        });

        const weekdayBreakdown = [
            weekdayMap[1], weekdayMap[2], weekdayMap[3], weekdayMap[4],
            weekdayMap[5], weekdayMap[6], weekdayMap[0] // Sort T2 -> CN
        ];

        // ─── Time Breakdown (Hourly) ─────────────────────────────────────────
        const timeBreakdown = new Array(24).fill(0).map((_, i) => ({
            timeRange: `${i.toString().padStart(2, '0')}:00`,
            orders: 0,
            revenue: 0
        }));

        completedBookings.forEach((b: any) => {
            const timeInfo = FinanceReportService.getVnDateInfo(b.createdAt || b.bookingDate || '');
            if (timeInfo && typeof timeInfo.hour === 'number') {
                const hour = timeInfo.hour;
                timeBreakdown[hour].orders++;
                timeBreakdown[hour].revenue += Number(b.totalAmount) || 0;
            }
        });

        // ─── KTV Working Time ───────────────────────────────────────────────
        const ktvMap: Record<string, { ktvId: string, ktvCode: string, ktvName: string, totalServices: number, totalWorkingMinutes: number, totalRevenueContribution: number, uniqueBookings: Set<string> }> = {};
        
        items.forEach(i => {
            if (Array.isArray(i.technicianCodes) && i.technicianCodes.length > 0) {
                i.technicianCodes.forEach((code: string) => {
                    if (!ktvMap[code]) {
                        ktvMap[code] = { ktvId: code, ktvCode: code, ktvName: code, totalServices: 0, totalWorkingMinutes: 0, totalRevenueContribution: 0, uniqueBookings: new Set() };
                    }
                    ktvMap[code].uniqueBookings.add(i.bookingId);
                    ktvMap[code].totalServices = ktvMap[code].uniqueBookings.size;
                    
                    const svcInfo = svcMap[String(i.serviceId)];
                    const dur = svcInfo ? svcInfo.duration : 60;
                    ktvMap[code].totalWorkingMinutes += Math.round(dur / i.technicianCodes.length);
                    ktvMap[code].totalRevenueContribution += Math.round((Number(i.price) || 0) / i.technicianCodes.length);
                });
            }
        });

        const ktvWorkingTime = Object.values(ktvMap).map(k => {
            const { uniqueBookings, ...rest } = k;
            return rest;
        }).sort((a, b) => b.totalRevenueContribution - a.totalRevenueContribution);

        return NextResponse.json({ 
            success: true, 
            timeBreakdown,
            weekdayBreakdown,
            ktvWorkingTime
        });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ success: false, error: 'Failed to fetch time analysis data' }, { status: 500 });
    }
}
