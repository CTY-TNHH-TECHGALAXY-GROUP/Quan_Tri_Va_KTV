import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

// 🔧 CONFIG
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * GET /api/ktv/history?techCode=NH016&dateFrom=2026-03-17&dateTo=2026-03-17
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const techCode = searchParams.get('techCode');
    const dateFrom = searchParams.get('dateFrom'); // YYYY-MM-DD (VN date)
    const dateTo = searchParams.get('dateTo');     // YYYY-MM-DD (VN date)

    if (!techCode) {
        return NextResponse.json({ success: false, error: 'techCode is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not init' }, { status: 500 });

    try {
        const commConfig = await KtvCommissionService.getCommissionConfig(supabase as any);
        const bonusConfig = await KtvCommissionService.getBonusConfig(supabase as any);

        // ─── Build date range ────────────────────────────────────────────
        const nowVn = new Date(Date.now() + VN_OFFSET_MS);
        const todayVn = nowVn.toISOString().split('T')[0];
        const fromDate = dateFrom || todayVn;
        const toDate = dateTo || todayVn;

        // createdAt có thể là timestamp (VN local) hoặc timestamptz (UTC)
        // Dùng VN midnight trực tiếp — PostgreSQL sẽ cast chính xác cho cả 2 kiểu
        const fromFilter = `${fromDate}T00:00:00`;
        const toFilter = `${toDate}T23:59:59`;

        // ─── Fetch KTVShifts ─────────────────────────────────────────────
        const { data: shiftsData } = await supabase
            .from('KTVShifts')
            .select('effectiveFrom, shiftType, employeeId')
            .eq('employeeId', techCode)
            .lte('effectiveFrom', toDate)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });
            
        // Áp dụng ngày lễ
        let holidayDates: any = [];
        try {
            const { data: configData } = await supabase.from('SystemConfigs').select('value').eq('key', 'holiday_shift2_dates').maybeSingle();
            if (configData?.value) {
                holidayDates = typeof configData.value === 'string' ? JSON.parse(configData.value) : configData.value;
            }
        } catch (e) {}

        const shiftMap = new Map<string, string>();
        let currentShift = 'SHIFT_1';
        
        // Tạo map cho tất cả các ngày từ fromDate tới toDate
        const startD = new Date(fromDate);
        const endD = new Date(toDate);
        
        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            
            let activeForDate = currentShift;
            for (const s of (shiftsData || [])) {
                const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
                if (effDate && effDate <= dateStr) {
                    activeForDate = s.shiftType;
                }
            }
            
            const targetMonthDay = dateStr.slice(5, 10);
            let isHoliday = false;
            if (Array.isArray(holidayDates) && holidayDates.includes(targetMonthDay)) {
                isHoliday = true;
            }
            
            shiftMap.set(dateStr, isHoliday ? 'SHIFT_2' : activeForDate);
        }

        // ─── Fetch Bookings ──────────────────────────────────────────────
        const { data: bookings, error: bErr } = await supabase
            .from('Bookings')
            .select('id, billCode, createdAt, bookingDate, timeStart, status, rating, tip, technicianCode')
            .ilike('technicianCode', `%${techCode}%`)
            .gte('bookingDate', fromFilter)
            .lte('bookingDate', toFilter)
            .in('status', ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'COMPLETED', 'DONE'])
            .order('bookingDate', { ascending: false })
            .limit(100);

        if (bErr) throw bErr;
        if (!bookings || bookings.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        // ─── Fetch BookingItems for these bookings ────────────────────────
        const bookingIds = bookings.map((b: any) => b.id);
        console.log('🔍 [DEBUG] bookingIds:', JSON.stringify(bookingIds));
        const { data: items, error: iErr } = await supabase
            .from('BookingItems')
            .select('id, bookingId, serviceId, technicianCodes, tip, segments, itemRating, ktvRatings')
            .in('bookingId', bookingIds);
        console.log('🔍 [DEBUG] BookingItems error:', iErr, 'count:', items?.length);

        // ─── Fetch Service names ─────────────────────────────────────────
        const allServiceIds = [...new Set((items || []).map((i: any) => i.serviceId).filter(Boolean))];

        let svcMap: Record<string, string> = {};
        let svcDurationMap: Record<string, number> = {};
        if (allServiceIds.length > 0) {
            // Try id lookup first
            const { data: svcsById } = await supabase
                .from('Services')
                .select('id, code, nameVN, duration')
                .in('id', allServiceIds);
            (svcsById || []).forEach((s: any) => {
                if (s.id)   svcMap[String(s.id)]   = s.nameVN || s.code || String(s.id);
                if (s.code) svcMap[String(s.code)]  = s.nameVN || s.code || String(s.id);
                if (s.id)   svcDurationMap[String(s.id)]   = Number(s.duration) || 60;
                if (s.code) svcDurationMap[String(s.code)]  = Number(s.duration) || 60;
            });

            // Fallback: serviceId may be a code string — query by code for unresolved ones
            const unresolved = allServiceIds.filter(sid => !svcMap[String(sid)]);
            if (unresolved.length > 0) {
                const { data: svcsByCode } = await supabase
                    .from('Services')
                    .select('id, code, nameVN, duration')
                    .in('code', unresolved);
                (svcsByCode || []).forEach((s: any) => {
                    if (s.id)   svcMap[String(s.id)]   = s.nameVN || s.code || String(s.id);
                    if (s.code) svcMap[String(s.code)]  = s.nameVN || s.code || String(s.id);
                    if (s.id)   svcDurationMap[String(s.id)]   = Number(s.duration) || 60;
                    if (s.code) svcDurationMap[String(s.code)]  = Number(s.duration) || 60;
                });
            }
        }


        // ─── Build result ─────────────────────────────────────────────────
        console.log('🔍 [DEBUG] BookingItems raw:', JSON.stringify((items || []).map((i: any) => ({
            id: i.id, bookingId: i.bookingId, technicianCodes: i.technicianCodes, tip: i.tip
        }))));

        const result = bookings.map((b: any) => {
            const allItems = (items || []).filter((i: any) => i.bookingId === b.id);
            
            // Re-construct booking with nested items to use service methods
            const fullBooking = { ...b, BookingItems: allItems };

            // Filter items belonging to this KTV in this booking
            const myItems = allItems.filter((i: any) =>
                i.technicianCodes &&
                Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
            );

            // Fallback: first item if no techCode match (single-KTV booking)
            const relevantItems = myItems.length > 0 ? myItems : allItems;

            console.log(`🔍 [DEBUG] Booking ${b.billCode}: myItems=${myItems.length}, relevant=${relevantItems.length}, tips=${relevantItems.map((i: any) => i.tip)}`);

            let totalDuration = 0;
            let commission = 0;
            for (const item of relevantItems) {
                const fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
                let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                if (itemDuration <= 0) itemDuration = 60;
                totalDuration += itemDuration;
                commission += KtvCommissionService.calcCommission(itemDuration, commConfig.milestones, commConfig.ratePer60);
            }
            if (commission === 0) commission = KtvCommissionService.calcCommission(60, commConfig.milestones, commConfig.ratePer60);

            const serviceNames = relevantItems
                .map((i: any) => svcMap[String(i.serviceId)] || String(i.serviceId || '').toUpperCase())
                .filter(Boolean);
            const serviceName = serviceNames.length > 1
                ? `${serviceNames.length} dịch vụ`
                : (serviceNames[0] || '—');

            // ─── Rating: lấy từ BookingItems (item-level) thay vì Bookings ────
            const itemRating = relevantItems.reduce((best: number, i: any) => {
                const r = Number(i.itemRating) || 0;
                return r > best ? r : best;
            }, 0) || null;

            // ─── Bonus points ─────────────
            const bDateStr = new Date(new Date(b.bookingDate || b.createdAt).getTime() + VN_OFFSET_MS).toISOString().split('T')[0];
            const shiftType = shiftMap.get(bDateStr) || 'SHIFT_1';
            
            // Build pseudo shiftsData for calculateBookingBonus
            const dynamicShiftsData = [{
                employeeId: techCode,
                shiftType: shiftType,
                effectiveFrom: bDateStr
            }];
            
            const bonusPoints = KtvCommissionService.calculateBookingBonus(fullBooking, techCode, bDateStr, dynamicShiftsData, bonusConfig);

            // ─── Tip: sum from this KTV's items ────────────────────────
            const ktvTip = relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);

            return {
                id: b.id,
                billCode: b.billCode,
                createdAt: b.createdAt,
                bookingDate: b.bookingDate,
                status: b.status,
                rating: itemRating,
                tip: ktvTip,
                commission,
                serviceName,
                duration: totalDuration,
                bonusPoints,
            };
        });


        return NextResponse.json({ success: true, data: result });

    } catch (err: any) {
        console.error('❌ [KTV History API]', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

/**
 * POST /api/ktv/history
 * KTV nhập tiền tip cho dịch vụ riêng của mình (BookingItems)
 * Body: { action: 'update_tip', bookingId, techCode, tip }
 */
export async function POST(request: Request) {
    const body = await request.json();
    const { bookingId, techCode, tip } = body;

    if (!bookingId || !techCode || tip === undefined) {
        return NextResponse.json({ success: false, error: 'bookingId, techCode, and tip are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not init' }, { status: 500 });

    // Find the BookingItem assigned to this KTV in this booking
    const { data: items } = await supabase
        .from('BookingItems')
        .select('id, technicianCodes')
        .eq('bookingId', bookingId);

    const myItem = (items || []).find((i: any) =>
        i.technicianCodes &&
        Array.isArray(i.technicianCodes) &&
        i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
    );

    const targetItem = myItem || items?.[0];
    if (!targetItem) {
        return NextResponse.json({ success: false, error: 'No BookingItem found' }, { status: 404 });
    }

    const { error } = await supabase
        .from('BookingItems')
        .update({ tip: Number(tip) })
        .eq('id', targetItem.id);

    if (error) {
        console.error('❌ [Tip PATCH]', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, itemId: targetItem.id });
}
