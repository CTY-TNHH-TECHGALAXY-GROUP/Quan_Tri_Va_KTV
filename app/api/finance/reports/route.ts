import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// 🔧 CONFIG
const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'FEEDBACK'];
const KTV_RANKING_STATUSES = ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'DONE', 'COMPLETED', 'FEEDBACK'];
const OPERATING_HOURS_PER_DAY = 12; // Spa mở cửa 12h/ngày

/**
 * GET /api/finance/reports?dateFrom=2026-03-01&dateTo=2026-03-31&groupBy=day&hourFrom=10&hourTo=14
 * Returns comprehensive revenue & reports data
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const groupBy = (searchParams.get('groupBy') || 'day') as 'hour' | 'day' | 'week' | 'month';
    const hourFrom = searchParams.get('hourFrom') ? parseInt(searchParams.get('hourFrom')!, 10) : null;
    const hourTo = searchParams.get('hourTo') ? parseInt(searchParams.get('hourTo')!, 10) : null;
    const lang = searchParams.get('lang') || 'all';

    const getMinsFromTimes = (start: string, end: string) => {
        if (!start || !end) return 0;
        const [h1, m1] = start.split(':').map(Number);
        const [h2, m2] = end.split(':').map(Number);
        if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return 0;
        let mins1 = h1 * 60 + m1;
        let mins2 = h2 * 60 + m2;
        if (mins2 < mins1) mins2 += 24 * 60; // cross midnight
        return mins2 - mins1;
    };

    const getVnDateInfo = (dateString: string, cutoff: number = 0) => {
        if (!dateString) return null;
        let ds = dateString;
        if (!ds.endsWith('Z') && !ds.match(/[+-]\d{2}:?\d{2}$/)) {
            ds += 'Z';
        }
        const originalDate = new Date(ds);
        if (isNaN(originalDate.getTime())) return null;
        
        const shiftedDate = new Date(originalDate.getTime() - cutoff * 60 * 60 * 1000);
        
        const options: Intl.DateTimeFormatOptions = { 
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hour12: false
        };
        
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const partsShifted = formatter.formatToParts(shiftedDate);
        const partsOriginal = formatter.formatToParts(originalDate);
        const getPart = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find(p => p.type === type)?.value || '00';
        
        const year = getPart(partsShifted, 'year');
        const month = getPart(partsShifted, 'month');
        const day = getPart(partsShifted, 'day');
        let hour = parseInt(getPart(partsOriginal, 'hour'), 10);
        if (hour === 24) hour = 0;
        
        return {
            dateStr: `${year}-${month}-${day}`, // YYYY-MM-DD
            monthStr: `${year}-${month}`,       // YYYY-MM
            hour: hour
        };
    };

    if (!dateFrom || !dateTo) {
        return NextResponse.json({ success: false, error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    // Convert VN date string to UTC timestamp string for Supabase query
    const startOfVnDayToUtc = (dateStr: string, cutoff: number = 0) => {
        const [year, month, day] = dateStr.split('-');
        const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), cutoff - 7, 0, 0, 0));
        return d.toISOString();
    };
    
    const endOfVnDayToUtc = (dateStr: string, cutoff: number = 0) => {
        const [year, month, day] = dateStr.split('-');
        const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1, cutoff - 7, 0, 0, -1));
        return d.toISOString();
    };

    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
    }

    try {
        const { data: cutoffConfig } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'spa_day_cutoff_hours')
            .single();
            
        const cutoffHours = cutoffConfig?.value ? Number(cutoffConfig.value) : 0;

        const utcFrom = startOfVnDayToUtc(dateFrom, cutoffHours);
        const utcTo = endOfVnDayToUtc(dateTo, cutoffHours);

        const commConfig = await KtvCommissionService.getCommissionConfig(supabase as any);
        // ─── 1. Fetch completed bookings in date range ───────────────────
        const { data: bookings, error: bErr } = await supabase
            .from('Bookings')
            .select('id, billCode, bookingDate, createdAt, status, totalAmount, tip, technicianCode, customerId, customerLang, source')
            .gte('bookingDate', utcFrom)
            .lte('bookingDate', utcTo)
            .neq('status', 'CANCELLED')
            .order('bookingDate', { ascending: true });

        if (bErr) throw bErr;
        const allBookings = bookings || [];

        // ─── 1b. Fetch CANCELLED bookings for cancellation rate ──────────
        const { count: cancelledCount } = await supabase
            .from('Bookings')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'CANCELLED')
            .gte('bookingDate', utcFrom)
            .lte('bookingDate', utcTo);

        // Apply language filter if specified
        const LANG_ALIASES: Record<string, string[]> = {
            'vi': ['vi', 'vn'], 'ko': ['ko', 'kr'], 'zh': ['zh', 'cn'],
            'en': ['en'], 'jp': ['jp', 'ja'],
        };
        const PAID_SOURCES = ['VIP_WALK_IN', 'STANDARD_WALK_IN', 'MIXED_WALK_IN', 'VIP_MENU', 'STANDARD_MENU'];
        let completedBookings = (allBookings || []).filter(b => 
            COMPLETED_STATUSES.includes(b.status) || PAID_SOURCES.includes(b.source)
        );
        
        if (lang && lang !== 'all') {
            const aliases = Object.entries(LANG_ALIASES).find(([, v]) => v.includes(lang.toLowerCase()));
            const matchLangs = aliases ? aliases[1] : [lang.toLowerCase()];
            completedBookings = completedBookings.filter(b => {
                const bLang = (b.customerLang || 'vi').toLowerCase();
                return matchLangs.includes(bLang);
            });
        }

        // ─── 2. Fetch all items for KTV Ranking (Real-time) ────────────
        const { data: allRankedBookings } = await supabase
            .from('Bookings')
            .select('id, technicianCode, totalAmount, status')
            .in('status', KTV_RANKING_STATUSES)
            .gte('bookingDate', utcFrom)
            .lte('bookingDate', utcTo);

        const allRankedBookingIds = (allRankedBookings || []).map(b => b.id);
        const completedBookingIds = completedBookings.map(b => b.id);
        const uniqueIdsToFetch = [...new Set([...allRankedBookingIds, ...completedBookingIds])];

        let allItems: any[] = [];
        
        if (uniqueIdsToFetch.length > 0) {
            const batchSize = 50;
            for (let i = 0; i < uniqueIdsToFetch.length; i += batchSize) {
                const batch = uniqueIdsToFetch.slice(i, i + batchSize);
                const { data: batchItems } = await supabase
                    .from('BookingItems')
                    .select('id, bookingId, serviceId, price, tip, itemRating, technicianCodes, roomName, quantity, segments')
                    .in('bookingId', batch);
                if (batchItems) allItems.push(...batchItems);
            }
        }

        // Items for revenue (filtered by completed bookings)
        const items = allItems.filter(item => 
            completedBookings.some(cb => cb.id === item.bookingId)
        );

        // ─── 3. Fetch Services for names, duration, category ─────────────
        const serviceIds = [...new Set(allItems.map(i => i.serviceId).filter(Boolean))];
        const svcMap: Record<string, { name: string, duration: number, category: string }> = {};
        if (serviceIds.length > 0) {
            const { data: svcs } = await supabase
                .from('Services')
                .select('id, code, nameVN, duration, category')
                .in('id', serviceIds);
            (svcs || []).forEach((s: any) => {
                const name = s.nameVN || s.code || String(s.id);
                const dur = Number(s.duration) || 60;
                const cat = s.category || 'Khác';
                if (s.id) svcMap[String(s.id)] = { name, duration: dur, category: cat };
                if (s.code) svcMap[String(s.code)] = { name, duration: dur, category: cat };
            });
            // Fallback by code
            const unresolvedIds = serviceIds.filter(sid => !svcMap[String(sid)]);
            if (unresolvedIds.length > 0) {
                const { data: svcsByCode } = await supabase
                    .from('Services')
                    .select('id, code, nameVN, duration, category')
                    .in('code', unresolvedIds);
                (svcsByCode || []).forEach((s: any) => {
                    const name = s.nameVN || s.code;
                    const dur = Number(s.duration) || 60;
                    const cat = s.category || 'Khác';
                    if (s.id) svcMap[String(s.id)] = { name, duration: dur, category: cat };
                    if (s.code) svcMap[String(s.code)] = { name, duration: dur, category: cat };
                });
            }
        }

        // ─── 4. Fetch new customers in date range ────────────────────────
        const { data: newCustomerList, count: newCustomerCount } = await supabase
            .from('Customers')
            .select('id, fullName, phone, email, createdAt', { count: 'exact' })
            .gte('createdAt', utcFrom)
            .lte('createdAt', utcTo)
            .order('createdAt', { ascending: false })
            .limit(50);

        // ─── 5. Fetch Beds count for occupancy calculation ───────────────
        const { count: totalBeds } = await supabase
            .from('Beds')
            .select('id', { count: 'exact', head: true });

        // ─── 6. Calculate previous period for comparison ─────────────────
        const fromDate = new Date(dateFrom);
        const toDate = new Date(dateTo);
        const periodDays = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        
        const prevTo = new Date(fromDate);
        prevTo.setDate(prevTo.getDate() - 1);
        const prevFrom = new Date(prevTo);
        prevFrom.setDate(prevFrom.getDate() - periodDays + 1);
        
        const prevFromStr = prevFrom.toISOString().split('T')[0];
        const prevToStr = prevTo.toISOString().split('T')[0];
        
        const prevUtcFrom = startOfVnDayToUtc(prevFromStr);
        const prevUtcTo = endOfVnDayToUtc(prevToStr);

        const { data: prevBookings } = await supabase
            .from('Bookings')
            .select('id, totalAmount, customerId')
            .in('status', COMPLETED_STATUSES)
            .gte('bookingDate', prevUtcFrom)
            .lte('bookingDate', prevUtcTo);

        const { count: prevNewCustomers } = await supabase
            .from('Customers')
            .select('id', { count: 'exact', head: true })
            .gte('createdAt', prevUtcFrom)
            .lte('createdAt', prevUtcTo);

        // ─── 7. Fetch SystemConfigs for commission calculation ────────────
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['ktv_commission_per_60min', 'ktv_commission_milestones']);

        const configMap: Record<string, any> = {};
        (configs || []).forEach((c: any) => { configMap[c.key] = c.value; });
        const commissionRate = Number(configMap['ktv_commission_per_60min'] || 100000);
        const DEFAULT_MILESTONES: Record<string, number> = {
            '1': 2000, '30': 50000, '45': 75000, '60': 100000,
            '70': 117000, '90': 150000, '120': 200000, '180': 300000, '300': 500000
        };
        let milestones: Record<string, number> = DEFAULT_MILESTONES;
        if (configMap['ktv_commission_milestones']) {
            try { milestones = typeof configMap['ktv_commission_milestones'] === 'string'
                ? JSON.parse(configMap['ktv_commission_milestones'])
                : configMap['ktv_commission_milestones'];
            } catch { /* use default */ }
        }

        const calcCommission = (durationMins: number): number => {
            const key = String(durationMins);
            if (milestones[key]) return Number(milestones[key]);
            return Math.round((durationMins / 60) * commissionRate / 1000) * 1000;
        };

        // ─── 8. Fetch Services with duration for commission calc ──────────
        let svcDurationMap: Record<string, number> = {};
        Object.keys(svcMap).forEach(k => {
            svcDurationMap[k] = svcMap[k].duration;
        });

        // ─── Calculate Summaries ──────────────────────────────────────
        const revenue = completedBookings.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);
        const orders = completedBookings.length;
        const avgPerOrder = orders > 0 ? Math.round(revenue / orders) : 0;
        const totalTip = items.reduce((sum, i) => sum + (Number(i.tip) || 0), 0);

        // #2 Total service count + #3 Total service revenue
        const totalServiceCount = items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
        const totalServiceRevenue = items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);

        // Average rating
        const ratedItems = items.filter(i => i.itemRating && Number(i.itemRating) > 0);
        const avgRating = ratedItems.length > 0
            ? Math.round((ratedItems.reduce((sum, i) => sum + Number(i.itemRating), 0) / ratedItems.length) * 10) / 10
            : 0;

        // Bed Occupancy: total service minutes (from real durations) / (beds × operating hours × days)
        const totalServiceMins = items.reduce((sum, i) => {
            const dur = svcDurationMap[String(i.serviceId)] || 60;
            const qty = Number(i.quantity) || 1;
            return sum + dur * qty;
        }, 0);
        const bedCount = totalBeds || 1;
        const maxCapacityMins = bedCount * OPERATING_HOURS_PER_DAY * 60 * periodDays;
        const occupancy = Math.min(100, Math.round((totalServiceMins / maxCapacityMins) * 100));
        const bedOccupancy = occupancy; // alias for clarity
        const revenuePerBed = bedCount > 0 ? Math.round(revenue / bedCount) : 0;

        // Note: totalCommission is now calculated during KTV processing below to ensure segments are considered
        let totalCommission = 0;

        // #6 Unique customers from completed bookings

        // #6 Unique customers from completed bookings
        const uniqueCustomerIds = new Set(completedBookings.map(b => b.customerId).filter(Boolean));
        const uniqueCustomers = uniqueCustomerIds.size;

        // #7 Average bill per customer
        const avgBillPerCustomer = uniqueCustomers > 0 ? Math.round(revenue / uniqueCustomers) : 0;

        // ─── Cancellation Rate ─────────────────────────────────────────
        const cancelledOrders = cancelledCount || 0;
        const totalAllOrders = orders + cancelledOrders;
        const cancellationRate = totalAllOrders > 0 ? Math.round((cancelledOrders / totalAllOrders) * 1000) / 10 : 0;

        // ─── Retention Rate (returning customers) ──────────────────────
        // Count customers with ≥ 2 completed bookings EVER
        let retentionRate = 0;
        let returningCustomers = 0;
        if (uniqueCustomerIds.size > 0) {
            const customerIdArr = Array.from(uniqueCustomerIds);
            // Query all completed bookings for these customers to check history
            const { data: historyBookings } = await supabase
                .from('Bookings')
                .select('customerId')
                .in('status', COMPLETED_STATUSES)
                .in('customerId', customerIdArr);

            // Count how many bookings each customer has
            const customerBookingCount: Record<string, number> = {};
            (historyBookings || []).forEach(b => {
                if (b.customerId) customerBookingCount[b.customerId] = (customerBookingCount[b.customerId] || 0) + 1;
            });
            returningCustomers = Object.values(customerBookingCount).filter(c => c >= 2).length;
            retentionRate = uniqueCustomers > 0 ? Math.round((returningCustomers / uniqueCustomers) * 1000) / 10 : 0;
        }

        // Previous period
        const prevRevenue = (prevBookings || []).reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);
        const prevOrders = (prevBookings || []).length;

        const revenueChange = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : 0;
        const ordersChange = prevOrders > 0 ? Math.round(((orders - prevOrders) / prevOrders) * 1000) / 10 : 0;
        const customersChange = (prevNewCustomers || 0) > 0
            ? Math.round((((newCustomerCount || 0) - (prevNewCustomers || 0)) / (prevNewCustomers || 1)) * 1000) / 10
            : 0;

        // ─── 8. Daily Revenue ────────────────────────────────────────────
        const dailyMap: Record<string, { date: string; revenue: number; orders: number }> = {};
        completedBookings.forEach(b => {
            const timeInfo = getVnDateInfo(b.bookingDate || b.createdAt || '', cutoffHours);
            if (!timeInfo) return;
            const day = timeInfo.dateStr;
            if (!dailyMap[day]) dailyMap[day] = { date: day, revenue: 0, orders: 0 };
            dailyMap[day].revenue += Number(b.totalAmount) || 0;
            dailyMap[day].orders += 1;
        });
        const dailyRevenue = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

        // ─── 8b. Hourly Revenue (with optional hour filter) ──────────────
        const hourlyRevenueMap: Record<number, { hour: number; revenue: number; orders: number }> = {};
        completedBookings.forEach(b => {
            const timeInfo = getVnDateInfo(b.bookingDate || b.createdAt || '', cutoffHours);
            if (timeInfo) {
                const hour = timeInfo.hour;
                // Apply hour filter if provided
                if (hourFrom !== null && hour < hourFrom) return;
                if (hourTo !== null && hour > hourTo) return;
                if (!hourlyRevenueMap[hour]) hourlyRevenueMap[hour] = { hour, revenue: 0, orders: 0 };
                hourlyRevenueMap[hour].revenue += Number(b.totalAmount) || 0;
                hourlyRevenueMap[hour].orders += 1;
            }
        });
        const hourlyRevenue = Array.from({ length: 24 }, (_, h) => ({
            hour: h,
            label: `${h}:00`,
            revenue: hourlyRevenueMap[h]?.revenue || 0,
            orders: hourlyRevenueMap[h]?.orders || 0,
        })).filter(h => {
            if (hourFrom !== null && hourTo !== null) return h.hour >= hourFrom && h.hour <= hourTo;
            return h.revenue > 0 || (h.hour >= 8 && h.hour <= 22);
        });

        // ─── 8c. Weekly Revenue ──────────────────────────────────────────
        const weeklyMap: Record<string, { week: string; revenue: number; orders: number }> = {};
        completedBookings.forEach(b => {
            const timeInfo = getVnDateInfo(b.bookingDate || b.createdAt || '', cutoffHours);
            if (!timeInfo) return;
            const day = timeInfo.dateStr;
            const d = new Date(day);
            // ISO week: get Monday of the week
            const dayOfWeek = d.getDay() || 7; // Sunday = 7
            const monday = new Date(d);
            monday.setDate(d.getDate() - dayOfWeek + 1);
            const weekKey = monday.toISOString().split('T')[0];
            if (!weeklyMap[weekKey]) weeklyMap[weekKey] = { week: weekKey, revenue: 0, orders: 0 };
            weeklyMap[weekKey].revenue += Number(b.totalAmount) || 0;
            weeklyMap[weekKey].orders += 1;
        });
        const weeklyRevenue = Object.values(weeklyMap).sort((a, b) => a.week.localeCompare(b.week));

        // ─── 8d. Monthly Revenue ─────────────────────────────────────────
        const monthlyMap: Record<string, { month: string; revenue: number; orders: number }> = {};
        completedBookings.forEach(b => {
            const timeInfo = getVnDateInfo(b.bookingDate || b.createdAt || '', cutoffHours);
            if (!timeInfo) return;
            const monthKey = timeInfo.monthStr; // YYYY-MM
            if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { month: monthKey, revenue: 0, orders: 0 };
            monthlyMap[monthKey].revenue += Number(b.totalAmount) || 0;
            monthlyMap[monthKey].orders += 1;
        });
        const monthlyRevenue = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));

        // ─── 9. Service Breakdown ────────────────────────────────────────
        const svcBreakdown: Record<string, { name: string; revenue: number; count: number; duration?: number; category?: string }> = {};
        items.forEach(i => {
            let key = String(i.serviceId || 'unknown');
            const svcInfo = svcMap[key];
            let name = svcInfo ? `${svcInfo.name} (${svcInfo.duration}p)` : key.toUpperCase();
            let cat = svcInfo?.category || 'Khác';
            let dur = svcInfo?.duration || 0;

            // Gom nhóm tất cả dịch vụ VIP (Mới + Cũ) vào 1 dòng để báo cáo gọn gàng
            if (key.startsWith('NHP') || key.startsWith('VIP_') || cat === 'VIP_MENU' || cat === 'PREMIUM') {
                key = 'VIP_GROUP_SUMMARY';
                name = 'Tổng Hợp Gói Menu VIP';
                cat = 'VIP_MENU';
            }

            if (!svcBreakdown[key]) svcBreakdown[key] = { 
                name, 
                revenue: 0, 
                count: 0,
                duration: dur,
                category: cat
            };
            svcBreakdown[key].revenue += Number(i.price) || 0;
            svcBreakdown[key].count += 1;
        });

        // ─── Fallback cho Menu VIP / Walk-in không có BookingItems ────────
        completedBookings.forEach(b => {
            const hasItems = items.some(i => i.bookingId === b.id);
            if (!hasItems && b.totalAmount && Number(b.totalAmount) > 0) {
                if (b.source === 'VIP_MENU' || b.source === 'VIP_WALK_IN' || b.source === 'VIP_BOOKING') {
                    const finalKey = 'VIP_GROUP_SUMMARY';
                    if (!svcBreakdown[finalKey]) svcBreakdown[finalKey] = {
                         name: 'Tổng Hợp Gói Menu VIP',
                         revenue: 0, count: 0, duration: 0, category: 'VIP_MENU'
                    };
                    svcBreakdown[finalKey].revenue += Number(b.totalAmount);
                    svcBreakdown[finalKey].count += 1;
                    return;
                }

                const key = b.source === 'STANDARD_MENU' ? 'STANDARD_MENU_FALLBACK' :
                            b.source === 'STANDARD_WALK_IN' ? 'STANDARD_WALK_IN_FALLBACK' :
                            (b.source || 'UNKNOWN_SOURCE');
                
                let name = b.source === 'STANDARD_MENU' ? 'Gói Menu Thường' :
                           b.source === 'STANDARD_WALK_IN' ? 'Gói Thường (Tại quầy)' :
                           'Dịch vụ Khác';
                           
                if (!svcBreakdown[key]) svcBreakdown[key] = { 
                    name, 
                    revenue: 0, 
                    count: 0,
                    duration: 0,
                    category: 'Packages'
                };
                svcBreakdown[key].revenue += Number(b.totalAmount);
                svcBreakdown[key].count += 1;
            }
        });

        const serviceBreakdown = Object.values(svcBreakdown)
            .sort((a, b) => b.revenue - a.revenue);

        // ─── 10. Top KTV (Real-time based on KTV_RANKING_STATUSES) ─────────
        const ktvMap: Record<string, { code: string; orders: number; revenue: number; commission: number; totalTip: number; ratingSum: number; ratingCount: number; workingMinutes: number }> = {};
        (allRankedBookings || []).forEach(b => {
            if (!b.technicianCode) return;
            const codes = b.technicianCode.split(',').map((c: string) => c.trim()).filter(Boolean);
            const share = codes.length > 0 ? (Number(b.totalAmount) || 0) / codes.length : 0;
            codes.forEach((code: string) => {
                if (!ktvMap[code]) ktvMap[code] = { code, orders: 0, revenue: 0, commission: 0, totalTip: 0, ratingSum: 0, ratingCount: 0, workingMinutes: 0 };
                ktvMap[code].orders += 1;
                ktvMap[code].revenue += share;
            });
        });
        // Calculate commission + tip + rating per KTV from ALL relevant items
        (allItems || []).forEach(i => {
            const techs = Array.isArray(i.technicianCodes) ? i.technicianCodes : [];
            if (techs.length === 0) return;
            
            const qty = Number(i.quantity) || 1;
            
            techs.forEach((tc: string) => {
                const code = tc.trim();
                if (!code) return;
                
                let myTotalMins = 0;
                
                const fallbackDuration = svcDurationMap[String(i.serviceId)] || 60;
                myTotalMins = KtvCommissionService.calculateItemDuration(i, code, fallbackDuration);
                
                if (myTotalMins === 0) {
                    myTotalMins = fallbackDuration / techs.length; // Fallback: divide duration by num KTVs
                }
                
                const perKtvCommission = KtvCommissionService.calcCommission(myTotalMins, commConfig.milestones, commConfig.ratePer60) * qty;
                const perKtvTip = (Number(i.tip) || 0) / techs.length;
                const hasRating = i.itemRating && Number(i.itemRating) > 0;
                
                if (!ktvMap[code]) ktvMap[code] = { code, orders: 0, revenue: 0, commission: 0, totalTip: 0, ratingSum: 0, ratingCount: 0, workingMinutes: 0 };
                ktvMap[code].commission += perKtvCommission;
                ktvMap[code].totalTip += perKtvTip;
                ktvMap[code].workingMinutes += myTotalMins;
                if (hasRating) {
                    ktvMap[code].ratingSum += Number(i.itemRating);
                    ktvMap[code].ratingCount += 1;
                }
            });
        });
        
        // Calculate global summary fields based on computed KTV maps
        totalCommission = Object.values(ktvMap).reduce((sum, ktv) => sum + ktv.commission, 0);
        const costPerService = totalServiceCount > 0 ? Math.round(totalCommission / totalServiceCount) : 0;
        const costRatio = revenue > 0 ? Math.round((totalCommission / revenue) * 1000) / 10 : 0;
        // Return ALL KTVs sorted by revenue (no top-10 limit)
        const allKTV = Object.values(ktvMap)
            .sort((a, b) => b.revenue - a.revenue);

        // ─── 11. Peak Hours ──────────────────────────────────────────────
        const hourMap: Record<number, number> = {};
        completedBookings.forEach(b => {
            const timeInfo = getVnDateInfo(b.bookingDate || b.createdAt || '', cutoffHours);
            if (timeInfo) {
                const hour = timeInfo.hour;
                hourMap[hour] = (hourMap[hour] || 0) + 1;
            }
        });
        const peakHours = Array.from({ length: 24 }, (_, h) => ({
            hour: `${h}:00`,
            count: hourMap[h] || 0,
        })).filter(h => h.count > 0 || (parseInt(h.hour) >= 8 && parseInt(h.hour) <= 22));

        // ─── Language Breakdown (always from ALL bookings so chips stay visible) ──
        const langMap: Record<string, { key: string; lang: string; revenue: number; orders: number }> = {};
        const LANG_LABELS: Record<string, string> = {
            'vi': '🇻🇳 Tiếng Việt', 'vn': '🇻🇳 Tiếng Việt',
            'en': '🇬🇧 English',
            'ko': '🇰🇷 한국어', 'kr': '🇰🇷 한국어',
            'zh': '🇨🇳 中文', 'cn': '🇨🇳 中文',
            'jp': '🇯🇵 日本語',
        };
        // Pre-seed all 5 languages so they always appear
        const ALL_LANGUAGES = [
            { key: 'vi', lang: '🇻🇳 Tiếng Việt' },
            { key: 'en', lang: '🇬🇧 English' },
            { key: 'ko', lang: '🇰🇷 한국어' },
            { key: 'zh', lang: '🇨🇳 中文' },
            { key: 'jp', lang: '🇯🇵 日本語' },
        ];
        ALL_LANGUAGES.forEach(l => {
            langMap[l.key] = { key: l.key, lang: l.lang, revenue: 0, orders: 0 };
        });
        allBookings.forEach(b => {
            const rawLang = (b.customerLang || 'vi').toLowerCase();
            const normalizedLang = rawLang === 'vn' ? 'vi' : rawLang === 'kr' ? 'ko' : rawLang === 'cn' ? 'zh' : rawLang;
            const label = LANG_LABELS[normalizedLang] || normalizedLang.toUpperCase();
            if (!langMap[normalizedLang]) langMap[normalizedLang] = { key: normalizedLang, lang: label, revenue: 0, orders: 0 };
            langMap[normalizedLang].revenue += Number(b.totalAmount) || 0;
            langMap[normalizedLang].orders += 1;
        });
        const languageBreakdown = Object.values(langMap).sort((a, b) => b.orders - a.orders);

        // ─── 12. Employees lookup for KTV names ──────────────────────────
        const ktvCodes = allKTV.map(k => k.code);
        let employeeMap: Record<string, string> = {};
        if (ktvCodes.length > 0) {
            // Batch lookup if many KTVs
            const batchSize = 50;
            for (let i = 0; i < ktvCodes.length; i += batchSize) {
                const batch = ktvCodes.slice(i, i + batchSize);
                const { data: employees } = await supabase
                    .from('Employees')
                    .select('code, name')
                    .in('code', batch);
                (employees || []).forEach((e: any) => {
                    if (e.code) employeeMap[e.code] = e.name || e.code;
                });
            }
        }

        // ─── 11. Top Customers & Menu Evaluation ─────────────────────────
        const customerMap: Record<string, { id: string; orders: number; revenue: number }> = {};
        completedBookings.forEach(b => {
            if (!b.customerId) return;
            if (!customerMap[b.customerId]) {
                customerMap[b.customerId] = { id: b.customerId, orders: 0, revenue: 0 };
            }
            customerMap[b.customerId].orders += 1;
            customerMap[b.customerId].revenue += Number(b.totalAmount) || 0;
        });
        const topCustomerIds = Object.values(customerMap)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 50)
            .map(c => c.id);
            
        let topCustomersData: any[] = [];
        if (topCustomerIds.length > 0) {
            const { data: cusData } = await supabase
                .from('Customers')
                .select('id, fullName, phone, email')
                .in('id', topCustomerIds);
            topCustomersData = (cusData || []).map((c: any) => ({
                id: c.id,
                name: c.fullName || 'Khách',
                phone: c.phone || '',
                email: c.email || '',
                orders: customerMap[c.id].orders,
                revenue: customerMap[c.id].revenue
            })).sort((a, b) => b.revenue - a.revenue);
        }

        const { data: allActiveServices } = await supabase
            .from('Services')
            .select('id, code, nameVN, duration, category')
            .eq('isActive', true);
            
        const menuEvaluation = (allActiveServices || []).map((s: any) => {
            const idKey = String(s.id);
            const codeKey = String(s.code);
            const breakDown = svcBreakdown[idKey] || svcBreakdown[codeKey];
            return {
                id: s.id,
                code: s.code,
                name: s.nameVN,
                duration: Number(s.duration) || 60,
                category: s.category || 'Khác',
                orders: breakDown ? breakDown.count : 0,
                revenue: breakDown ? breakDown.revenue : 0
            };
        });

        // ─── 12. Advanced Analytics (Weekday, Service Hourly Trends) ─────
        const weekdayMap: Record<number, { day: string; revenue: number; orders: number }> = {};
        const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        DAYS.forEach((d, i) => weekdayMap[i] = { day: d, revenue: 0, orders: 0 });
        
        const serviceHourlyTrends: Record<string, number[]> = {};
        
        completedBookings.forEach(b => {
            const timeInfo = getVnDateInfo(b.bookingDate || b.createdAt || '', cutoffHours);
            if (!timeInfo) return;
            
            const dateObj = new Date(timeInfo.dateStr);
            if (!isNaN(dateObj.getTime())) {
                const dayOfWeek = dateObj.getDay(); // 0 is Sunday
                weekdayMap[dayOfWeek].revenue += Number(b.totalAmount) || 0;
                weekdayMap[dayOfWeek].orders += 1;
            }
            
            // Map items for this booking to calculate service hourly trend
            const bItems = items.filter(i => i.bookingId === b.id);
            bItems.forEach(i => {
                const key = String(i.serviceId || 'unknown');
                if (!serviceHourlyTrends[key]) serviceHourlyTrends[key] = Array(24).fill(0);
                serviceHourlyTrends[key][timeInfo.hour] += 1;
            });
        });
        
        const weekdayStats = [
            weekdayMap[1], weekdayMap[2], weekdayMap[3], weekdayMap[4], 
            weekdayMap[5], weekdayMap[6], weekdayMap[0] // Sort T2 -> CN
        ];

        // ─── 13. Raw Data Sheet (Giống Excel thủ công) ───────────────────
        const rawDataSheet: any[] = [];
        completedBookings.forEach(b => {
            const bItems = items.filter(i => i.bookingId === b.id);
            const timeInfo = getVnDateInfo(b.bookingDate || b.createdAt || '', cutoffHours);
            
            if (bItems.length === 0) {
                rawDataSheet.push({
                    id: b.billCode || b.id.substring(0, 8),
                    lang: b.customerLang || 'VN',
                    statusInfo: 'KHÔNG',
                    source: b.source || 'Walk-in',
                    duration: 0,
                    serviceName: b.source === 'VIP_MENU' ? 'Gói Menu VIP' : 'Dịch vụ khác',
                    ktv: b.technicianCode || '',
                    startTime: timeInfo ? `${timeInfo.hour}:00` : '',
                    endTime: '',
                    revenue: Number(b.totalAmount) || 0,
                    tip: Number(b.tip) || 0,
                    commission: 0,
                    statusText: b.status === 'CANCELLED' ? 'FALSE' : 'TRUE'
                });
            } else {
                bItems.forEach(i => {
                    const svcInfo = svcMap[String(i.serviceId)];
                    const name = svcInfo ? svcInfo.name : String(i.serviceId);
                    const dur = svcInfo ? svcInfo.duration : 60;
                    
                    let startTime = '';
                    let endTime = '';
                    if (b.bookingDate || b.createdAt) {
                        const startDate = new Date(b.bookingDate || b.createdAt);
                        startTime = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`;
                        const endDate = new Date(startDate.getTime() + dur * 60000);
                        endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
                    }
                    
                    let ktvs = Array.isArray(i.technicianCodes) ? i.technicianCodes.join(', ') : '';
                    let commission = 0;
                    if (Array.isArray(i.technicianCodes) && i.technicianCodes.length > 0) {
                        const myTotalMins = KtvCommissionService.calculateItemDuration(i, i.technicianCodes[0], dur) || (dur / i.technicianCodes.length);
                        // Tổng hoa hồng của tất cả KTV làm chung DV này
                        commission = KtvCommissionService.calcCommission(myTotalMins, commConfig.milestones, commConfig.ratePer60) * (Number(i.quantity) || 1) * i.technicianCodes.length;
                    }

                    rawDataSheet.push({
                        id: b.billCode || b.id.substring(0, 8),
                        lang: b.customerLang || 'VN',
                        statusInfo: 'KHÔNG',
                        source: b.source || 'Walk-in',
                        duration: dur,
                        serviceName: name,
                        ktv: ktvs || (i.roomName ? `${i.roomName}` : ''),
                        startTime,
                        endTime,
                        revenue: Number(i.price) || 0,
                        tip: Number(i.tip) || 0,
                        commission,
                        statusText: b.status === 'CANCELLED' ? 'FALSE' : 'TRUE'
                    });
                });
            }
        });

        return NextResponse.json({
            success: true,
            summary: {
                revenue,
                orders,
                newCustomers: newCustomerCount || 0,
                avgRating,
                occupancy,
                avgPerOrder,
                totalTip,
                totalCommission,
                // New KPIs
                totalServiceCount,
                totalServiceRevenue,
                costPerService,
                costRatio,
                uniqueCustomers,
                avgBillPerCustomer,
                // Bed KPIs
                revenuePerBed,
                bedOccupancy,
                totalBeds: bedCount,
                // Cancellation & Retention
                cancellationRate,
                cancelledOrders,
                retentionRate,
                returningCustomers,
                // Comparisons
                revenueChange,
                ordersChange,
                customersChange,
            },
            dailyRevenue,
            hourlyRevenue,
            weeklyRevenue,
            monthlyRevenue,
            serviceBreakdown,
            languageBreakdown,
            topKTV: allKTV.map(k => ({
                code: k.code,
                name: employeeMap[k.code] || k.code,
                orders: k.orders,
                revenue: Math.round(k.revenue),
                commission: Math.round(k.commission),
                totalTip: Math.round(k.totalTip),
                avgRating: k.ratingCount > 0 ? Math.round((k.ratingSum / k.ratingCount) * 10) / 10 : 0,
                ratingCount: k.ratingCount,
                workingMinutes: k.workingMinutes,
            })),
            peakHours,
            newCustomerList: (newCustomerList || []).map((c: any) => ({
                id: c.id,
                name: c.fullName || 'Khách',
                phone: c.phone || '',
                email: c.email || '',
                createdAt: c.createdAt ? (c.createdAt.endsWith('Z') || c.createdAt.match(/[+-]\d{2}:?\d{2}$/) ? c.createdAt : c.createdAt + 'Z') : null,
            })),
            topCustomersData,
            menuEvaluation,
            weekdayStats,
            serviceHourlyTrends,
            rawDataSheet,
            // Filter data for client-side filtering
            serviceList: Object.values(svcBreakdown).map(s => s.name),
            ktvList: allKTV.map(k => ({ code: k.code, name: employeeMap[k.code] || k.code })),
            _meta: { dateFrom, dateTo, prevFrom: prevFromStr, prevTo: prevToStr, periodDays, groupBy },
        });

    } catch (err: any) {
        console.error('❌ [Finance Reports API]', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
