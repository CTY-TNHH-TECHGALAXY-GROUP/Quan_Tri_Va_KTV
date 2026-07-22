import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

export const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'FEEDBACK'];
export const KTV_RANKING_STATUSES = ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'DONE', 'COMPLETED', 'FEEDBACK'];
export const PAID_SOURCES = ['VIP_WALK_IN', 'STANDARD_WALK_IN', 'MIXED_WALK_IN', 'VIP_MENU', 'STANDARD_MENU'];

export const LANG_ALIASES: Record<string, string[]> = {
    'vi': ['vi', 'vn'], 'ko': ['ko', 'kr'], 'zh': ['zh', 'cn'],
    'en': ['en'], 'jp': ['jp', 'ja'],
};

export class FinanceReportService {

    public static getVnDateInfo(dateString: string) {
        if (!dateString) return null;
        let ds = dateString;
        if (!ds.endsWith('Z') && !ds.match(/[+-]\d{2}:?\d{2}$/)) {
            ds += 'Z';
        }
        const d = new Date(ds);
        if (isNaN(d.getTime())) return null;
        
        const options: Intl.DateTimeFormatOptions = { 
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(d);
        const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00';
        
        const year = getPart('year');
        const month = getPart('month');
        const day = getPart('day');
        let hour = parseInt(getPart('hour'), 10);
        if (hour === 24) hour = 0;
        
        return {
            dateStr: `${year}-${month}-${day}`, // YYYY-MM-DD
            monthStr: `${year}-${month}`,       // YYYY-MM
            hour: hour
        };
    }

    /**
     * Common method to fetch bookings, items, and configuration.
     * Reused across all micro-APIs.
     */
    public static async getBaseData(
        supabase: any,
        dateFrom: string,
        dateTo: string,
        langFilter: string = 'all'
    ) {
        const commConfig = await KtvCommissionService.getCommissionConfig(supabase);

        // 1. Fetch completed bookings in date range
        const { data: bookings, error: bErr } = await supabase
            .from('Bookings')
            .select('id, billCode, bookingDate, createdAt, status, totalAmount, tip, technicianCode, customerId, customerLang, source, paymentMethod')
            .gte('bookingDate', `${dateFrom} 00:00:00`)
            .lte('bookingDate', `${dateTo} 23:59:59`)
            .neq('status', 'CANCELLED')
            .order('bookingDate', { ascending: true });

        if (bErr) throw bErr;
        const allBookings = bookings || [];

        // Apply language filter
        let completedBookings = allBookings.filter((b: any) => 
            COMPLETED_STATUSES.includes(b.status) || PAID_SOURCES.includes(b.source)
        );
        
        if (langFilter && langFilter !== 'all') {
            const aliases = Object.entries(LANG_ALIASES).find(([, v]) => v.includes(langFilter.toLowerCase()));
            const matchLangs = aliases ? aliases[1] : [langFilter.toLowerCase()];
            completedBookings = completedBookings.filter((b: any) => {
                const bLang = (b.customerLang || 'vi').toLowerCase();
                return matchLangs.includes(bLang);
            });
        }

        // 2. Fetch all items (Including IN_PROGRESS for KTV)
        const { data: allRankedBookings } = await supabase
            .from('Bookings')
            .select('id, technicianCode, totalAmount, status')
            .in('status', KTV_RANKING_STATUSES)
            .gte('bookingDate', `${dateFrom} 00:00:00`)
            .lte('bookingDate', `${dateTo} 23:59:59`);

        const allRankedBookingIds = (allRankedBookings || []).map((b: any) => b.id);
        const completedBookingIds = completedBookings.map((b: any) => b.id);
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
            completedBookings.some((cb: any) => cb.id === item.bookingId)
        );

        // 3. Fetch Services
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

        // 4. Fetch Employees
        const { data: employees } = await supabase.from('Staff').select('id, code, full_name, role');
        const allKTV = (employees || []).filter((e: any) => e.role === 'TECHNICIAN' || String(e.code).startsWith('NH'));
        const employeeMap: Record<string, string> = {};
        allKTV.forEach((e: any) => {
            employeeMap[e.code] = e.full_name || e.code;
        });

        return {
            allBookings,
            completedBookings,
            allRankedBookings,
            allItems,
            items,
            svcMap,
            employeeMap,
            allKTV,
            commConfig
        };
    }
}
