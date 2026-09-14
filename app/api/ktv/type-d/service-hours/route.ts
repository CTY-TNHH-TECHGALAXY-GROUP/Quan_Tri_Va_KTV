import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const techCode = searchParams.get('techCode');
        const monthParam = searchParams.get('month'); // YYYY-MM
        
        const now = new Date();
        const year = monthParam ? parseInt(monthParam.split('-')[0]) : now.getFullYear();
        const month = monthParam ? parseInt(monthParam.split('-')[1]) : now.getMonth() + 1;
        
        const startDate = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
        const endDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}T23:59:59.999Z`;

        let staffIds: string[] = [];
        if (techCode) {
            staffIds = [techCode];
        } else {
            const { data } = await supabase.from('Staff').select('id').eq('work_type', 'TYPE_D');
            staffIds = (data || []).map(s => s.id);
        }

        const { data: services } = await supabase.from('Services').select('id, duration, is_utility');
        const svcDurationMap: Record<string, number> = {};
        const svcUtilityMap: Record<string, boolean> = {};
        (services || []).forEach((s: any) => { 
            svcDurationMap[String(s.id)] = s.duration || 0; 
            svcUtilityMap[String(s.id)] = !!s.is_utility; 
        });

        const results = [];

        for (const staffId of staffIds) {
            let allBookings: any[] = [];
            let page = 0;
            while (true) {
                const { data, error } = await supabase
                    .from('Bookings')
                    .select(`
                        id, timeStart, status, billCode, createdAt, rating,
                        BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status )
                    `)
                    .gte('timeStart', startDate)
                    .lte('timeStart', endDate)
                    .range(page * 1000, (page + 1) * 1000 - 1);
                
                if (error || !data || data.length === 0) break;
                allBookings = allBookings.concat(data);
                page++;
            }

            let total_hours_earned = 0;
            const DONE_STATUSES = ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'];

            allBookings.forEach((b: any) => {
                const relevantItemsOriginal = (b.BookingItems || []).filter((i: any) =>
                    i.technicianCodes &&
                    Array.isArray(i.technicianCodes) &&
                    i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(staffId.toLowerCase())) &&
                    DONE_STATUSES.includes(i.status)
                );
                
                let relevantItems = relevantItemsOriginal.filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
                if (relevantItems.length === 0 && relevantItemsOriginal.length > 0) {
                    relevantItems = relevantItemsOriginal;
                }

                relevantItems.forEach((item: any) => {
                    const fallbackDuration = svcDurationMap[String(item.serviceId)] || 0;
                    let itemDuration = KtvCommissionService.calculateItemDuration(item, staffId, fallbackDuration);
                    if (itemDuration <= 0) itemDuration = 60;
                    total_hours_earned += itemDuration / 60;
                });
            });

            const { data: penalties } = await supabase
                .from('KTVServiceHoursLedger')
                .select('*')
                .eq('staff_id', staffId)
                .gte('date', `${year}-${String(month).padStart(2, '0')}-01`)
                .lte('date', `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`);

            const total_hours_penalty = (penalties || []).reduce((sum, p) => sum + Number(p.hours_penalty), 0);
            const net_hours = Math.max(0, total_hours_earned - total_hours_penalty);

            results.push({
                staff_id: staffId,
                month: monthParam || `${year}-${String(month).padStart(2, '0')}`,
                total_hours_earned,
                total_hours_penalty,
                net_hours,
                penalty_history: penalties || []
            });
        }

        return NextResponse.json({ success: true, data: techCode ? results[0] : results });
    } catch (err: any) {
        console.error('Exception /api/ktv/type-d/service-hours:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
