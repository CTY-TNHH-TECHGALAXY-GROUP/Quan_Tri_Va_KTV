import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

export const dynamic = 'force-dynamic';

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

    if (!dateFrom || !dateTo) {
        return NextResponse.json({ success: false, error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
    }

    try {
        const commConfig = await KtvCommissionService.getCommissionConfig(supabase as any);
        // ─── 1. Fetch completed bookings in date range ───────────────────
        const { data: bookings, error: bErr } = await supabase
            .from('Bookings')
            .select('id, billCode, bookingDate, createdAt, status, totalAmount, tip, technicianCode, customerId, customerLang, source')
            .gte('bookingDate', `${dateFrom} 00:00:00`)
            .lte('bookingDate', `${dateTo} 23:59:59`)
            .neq('status', 'CANCELLED')
            .order('bookingDate', { ascending: true });

        if (bErr) throw bErr;
        const allBookings = bookings || [];

        // ─── 1b. Fetch CANCELLED bookings for cancellation rate ──────────
        const { count: cancelledCount } = await supabase
            .from('Bookings')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'CANCELLED')
            .gte('bookingDate', `${dateFrom} 00:00:00`)
            .lte('bookingDate', `${dateTo} 23:59:59`);

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
            .gte('bookingDate', `${dateFrom} 00:00:00`)
            .lte('bookingDate', `${dateTo} 23:59:59`);

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

        // ─── 3. Fetch Services for names ─────────────────────────────────
        const serviceIds = [...new Set(allItems.map(i => i.serviceId).filter(Boolean))];
        const svcMap: Record<string, string> = {};
        if (serviceIds.length > 0) {
            const { data: svcs } = await supabase
                .from('Services')
                .select('id, code, nameVN')
                .in('id', serviceIds);
            (svcs || []).forEach((s: any) => {
                if (s.id) svcMap[String(s.id)] = s.nameVN || s.code || String(s.id);
                if (s.code) svcMap[String(s.code)] = s.nameVN || s.code;
            });
            // Fallback by code
            const unresolvedIds = serviceIds.filter(sid => !svcMap[String(sid)]);
            if (unresolvedIds.length > 0) {
                const { data: svcsByCode } = await supabase
                    .from('Services')
                    .select('id, code, nameVN')
                    .in('code', unresolvedIds);
                (svcsByCode || []).forEach((s: any) => {
                    if (s.id) svcMap[String(s.id)] = s.nameVN || s.code;
                    if (s.code) svcMap[String(s.code)] = s.nameVN || s.code;
                });
            }
        }

        // ─── 4. Fetch new customers in date range ────────────────────────
        const { data: newCustomerList, count: newCustomerCount } = await supabase
            .from('Customers')
            .select('id, fullName, phone, email, createdAt', { count: 'exact' })
            .gte('createdAt', `${dateFrom}T00:00:00`)
            .lte('createdAt', `${dateTo}T23:59:59`)
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

        const { data: prevBookings } = await supabase
            .from('Bookings')
            .select('id, totalAmount, customerId')
            .in('status', COMPLETED_STATUSES)
            .gte('bookingDate', `${prevFromStr} 00:00:00`)
            .lte('bookingDate', `${prevToStr} 23:59:59`);

        const { count: prevNewCustomers } = await supabase
            .from('Customers')
            .select('id', { count: 'exact', head: true })
            .gte('createdAt', `${prevFromStr}T00:00:00`)
            .lte('createdAt', `${prevToStr}T23:59:59`);

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
        if (serviceIds.length > 0) {
            const { data: svcsWithDur } = await supabase
                .from('Services')
                .select('id, code, duration')
                .in('id', serviceIds);
            (svcsWithDur || []).forEach((s: any) => {
                if (s.id) svcDurationMap[String(s.id)] = Number(s.duration) || 60;
                if (s.code) svcDurationMap[String(s.code)] = Number(s.duration) || 60;
            });
        }

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
            const day = (b.bookingDate || b.createdAt || '').split(' ')[0].split('T')[0];
            if (!day) return;
            if (!dailyMap[day]) dailyMap[day] = { date: day, revenue: 0, orders: 0 };
            dailyMap[day].revenue += Number(b.totalAmount) || 0;
            dailyMap[day].orders += 1;
        });
        const dailyRevenue = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

        // ─── 8b. Hourly Revenue (with optional hour filter) ──────────────
        const hourlyRevenueMap: Record<number, { hour: number; revenue: number; orders: number }> = {};
        completedBookings.forEach(b => {
            const time = b.bookingDate || b.createdAt || '';
            const match = time.match(/(\d{2}):\d{2}/);
            if (match) {
                const hour = parseInt(match[1], 10);
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
            const day = (b.bookingDate || b.createdAt || '').split(' ')[0].split('T')[0];
            if (!day) return;
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
            const day = (b.bookingDate || b.createdAt || '').split(' ')[0].split('T')[0];
            if (!day) return;
            const monthKey = day.substring(0, 7); // YYYY-MM
            if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { month: monthKey, revenue: 0, orders: 0 };
            monthlyMap[monthKey].revenue += Number(b.totalAmount) || 0;
            monthlyMap[monthKey].orders += 1;
        });
        const monthlyRevenue = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));

        // ─── 9. Service Breakdown ────────────────────────────────────────
        const svcBreakdown: Record<string, { name: string; revenue: number; count: number }> = {};
        items.forEach(i => {
            const key = String(i.serviceId || 'unknown');
            const name = svcMap[key] || key.toUpperCase();
            if (!svcBreakdown[key]) svcBreakdown[key] = { name, revenue: 0, count: 0 };
            svcBreakdown[key].revenue += Number(i.price) || 0;
            svcBreakdown[key].count += 1;
        });

        // ─── Fallback cho Menu VIP / Walk-in không có BookingItems ────────
        completedBookings.forEach(b => {
            const hasItems = items.some(i => i.bookingId === b.id);
            if (!hasItems && b.totalAmount && Number(b.totalAmount) > 0) {
                const key = b.source === 'VIP_MENU' ? 'VIP_MENU_FALLBACK' : 
                            b.source === 'STANDARD_MENU' ? 'STANDARD_MENU_FALLBACK' :
                            (b.source || 'UNKNOWN_SOURCE');
                
                let name = b.source === 'VIP_MENU' ? 'Gói Menu VIP' :
                           b.source === 'STANDARD_MENU' ? 'Gói Menu Thường' :
                           b.source === 'VIP_WALK_IN' ? 'Gói VIP (Tại quầy)' :
                           b.source === 'STANDARD_WALK_IN' ? 'Gói Thường (Tại quầy)' :
                           'Dịch vụ Khác';
                           
                if (!svcBreakdown[key]) svcBreakdown[key] = { name, revenue: 0, count: 0 };
                svcBreakdown[key].revenue += Number(b.totalAmount);
                svcBreakdown[key].count += 1;
            }
        });

        const serviceBreakdown = Object.values(svcBreakdown)
            .sort((a, b) => b.revenue - a.revenue);

        // ─── 10. Top KTV (Real-time based on KTV_RANKING_STATUSES) ─────────
        const ktvMap: Record<string, { code: string; orders: number; revenue: number; commission: number; totalTip: number; ratingSum: number; ratingCount: number }> = {};
        (allRankedBookings || []).forEach(b => {
            if (!b.technicianCode) return;
            const codes = b.technicianCode.split(',').map((c: string) => c.trim()).filter(Boolean);
            const share = codes.length > 0 ? (Number(b.totalAmount) || 0) / codes.length : 0;
            codes.forEach((code: string) => {
                if (!ktvMap[code]) ktvMap[code] = { code, orders: 0, revenue: 0, commission: 0, totalTip: 0, ratingSum: 0, ratingCount: 0 };
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
                
                if (!ktvMap[code]) ktvMap[code] = { code, orders: 0, revenue: 0, commission: 0, totalTip: 0, ratingSum: 0, ratingCount: 0 };
                ktvMap[code].commission += perKtvCommission;
                ktvMap[code].totalTip += perKtvTip;
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
            const time = b.createdAt || b.bookingDate || '';
            if (time) {
                const d = new Date(time);
                if (!isNaN(d.getTime())) {
                    const vnHourStr = new Intl.DateTimeFormat('en-US', {
                        hour: '2-digit',
                        hour12: false,
                        timeZone: 'Asia/Ho_Chi_Minh'
                    }).format(d);
                    let hour = parseInt(vnHourStr, 10);
                    if (hour === 24) hour = 0;
                    hourMap[hour] = (hourMap[hour] || 0) + 1;
                }
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
            })),
            peakHours,
            newCustomerList: (newCustomerList || []).map((c: any) => ({
                id: c.id,
                name: c.fullName || 'Khách',
                phone: c.phone || '',
                email: c.email || '',
                createdAt: c.createdAt,
            })),
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
