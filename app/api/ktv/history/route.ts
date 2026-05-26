import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 🔧 CONFIG
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const DEFAULT_MILESTONES: Record<string, number> = {
    '1': 2000, '30': 50000, '45': 75000, '60': 100000,
    '70': 115000, '90': 150000, '120': 200000, '180': 300000, '300': 500000
};

const calcCommission = (durationMins: number, milestones: Record<string, number>, rate: number): number => {
    const key = String(durationMins);
    if (milestones[key]) return Number(milestones[key]);
    return Math.round((durationMins / 60) * rate / 1000) * 1000;
};

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
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['ktv_commission_per_60min', 'ktv_commission_milestones', 'ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus']);

        const configMap: Record<string, any> = {};
        (configs || []).forEach((c: any) => { configMap[c.key] = c.value; });
        const rate = Number(configMap['ktv_commission_per_60min'] || 100000);
        let milestones: Record<string, number> = DEFAULT_MILESTONES;
        if (configMap['ktv_commission_milestones']) {
            try { milestones = typeof configMap['ktv_commission_milestones'] === 'string'
                ? JSON.parse(configMap['ktv_commission_milestones'])
                : configMap['ktv_commission_milestones'];
            } catch { /* use default */ }
        }
        
        // Cấu hình Bonus theo ca
        const s1Bonus = Number(configMap['ktv_shift_1_bonus'] || 20);
        const s2Bonus = Number(configMap['ktv_shift_2_bonus'] || 20);
        const s3Bonus = Number(configMap['ktv_shift_3_bonus'] || 40);

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
            .select('effectiveFrom, shiftType')
            .eq('employeeId', techCode)
            .lte('effectiveFrom', toDate)
            .in('status', ['ACTIVE', 'REPLACED'])
            .order('effectiveFrom', { ascending: true })
            .order('createdAt', { ascending: true });
            
        // Map ngày => Ca (Tính từ ngày effectiveFrom đến toDate)
        const shiftMap = new Map<string, string>();
        let currentShift = 'SHIFT_1';
        
        // Tạo map cho tất cả các ngày từ fromDate tới toDate
        const startD = new Date(fromDate);
        const endD = new Date(toDate);
        
        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            
            // Tìm shift có hiệu lực cho dateStr này
            // Do shiftsData đã được sort theo effectiveFrom asc, ta lấy cái cuối cùng <= dateStr
            let activeForDate = currentShift;
            for (const s of (shiftsData || [])) {
                if (s.effectiveFrom <= dateStr) {
                    activeForDate = s.shiftType;
                }
            }
            
            // Áp dụng ngày lễ
            const targetMonthDay = dateStr.slice(5, 10);
            let isHoliday = false;
            try {
                const { data: configData } = await supabase.from('SystemConfigs').select('value').eq('key', 'holiday_shift2_dates').maybeSingle();
                const holidayDates = configData?.value || ['04-30', '09-02', '12-31'];
                if (Array.isArray(holidayDates) && holidayDates.includes(targetMonthDay)) {
                    isHoliday = true;
                }
            } catch (e) {}
            
            shiftMap.set(dateStr, isHoliday ? 'SHIFT_2' : activeForDate);
        }

        // ─── Fetch Bookings ──────────────────────────────────────────────
        const { data: bookings, error: bErr } = await supabase
            .from('Bookings')
            .select('id, billCode, createdAt, status, rating, tip, technicianCode')
            .ilike('technicianCode', `%${techCode}%`)
            .gte('createdAt', fromFilter)
            .lte('createdAt', toFilter)
            .in('status', ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'COMPLETED', 'DONE'])
            .order('createdAt', { ascending: false })
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
            .select('id, bookingId, serviceId, technicianCodes, tip, segments, itemRating')
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
            // Filter items belonging to this KTV in this booking
            const myItems = (items || []).filter((i: any) =>
                i.bookingId === b.id &&
                i.technicianCodes &&
                Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase()))
            );

            // Fallback: first item if no techCode match (single-KTV booking)
            const relevantItems = myItems.length > 0
                ? myItems
                : (items || []).filter((i: any) => i.bookingId === b.id);

            console.log(`🔍 [DEBUG] Booking ${b.billCode}: myItems=${myItems.length}, relevant=${relevantItems.length}, tips=${relevantItems.map((i: any) => i.tip)}`);

            // Duration: lấy từ segments mà admin gán cho KTV này
            let totalDuration = 0;
            for (const item of relevantItems) {
                let segs: any[] = [];
                try {
                    segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []);
                } catch { segs = []; }
                // Tìm segments gán cho KTV này
                const mySegs = segs.filter((seg: any) =>
                    seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase())
                );
                if (mySegs.length > 0) {
                    totalDuration += mySegs.reduce((sum: number, seg: any) => {
                        // Ưu tiên tính thời gian thực tế quầy gán (endTime - startTime)
                        const realMins = getMinsFromTimes(seg.startTime, seg.endTime);
                        if (realMins > 0) return sum + realMins;
                        // Fallback về thuộc tính duration nếu không parse được thời gian
                        return sum + (Number(seg.duration) || 0);
                    }, 0);
                } else {
                    // Fallback: dùng service duration nếu không có segments
                    totalDuration += svcDurationMap[String(item.serviceId)] || 60;
                }
            }
            const commission = calcCommission(totalDuration || 60, milestones, rate);

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

            // ─── Bonus points: Per booking, chia đều unique KTVs, Math.floor ─────────────
            let bonusPoints = 0;
            const bRating = Number(b.rating) || 0;
            const maxItemRating = itemRating || 0;
            const bookingRating = Math.max(bRating, maxItemRating);

            if (bookingRating >= 4) {
                // Xác định ngày của booking (YYYY-MM-DD theo VN)
                const bDateStr = new Date(new Date(b.createdAt).getTime() + VN_OFFSET_MS).toISOString().split('T')[0];
                const shiftType = shiftMap.get(bDateStr) || 'SHIFT_1';
                
                let basePoints = s1Bonus;
                if (shiftType === 'SHIFT_2') basePoints = s2Bonus;
                else if (shiftType === 'SHIFT_3') basePoints = s3Bonus;
                
                // Điểm thưởng giảm nửa nếu KTV được gán dưới 60 phút
                if (totalDuration < 60) {
                    basePoints = basePoints / 2;
                }
                
                // Collect ALL unique KTVs across ALL items in this booking
                const allKtvCodes = new Set<string>();
                const allItems = (items || []).filter((i: any) => i.bookingId === b.id);
                for (const item of allItems) {
                    if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                        item.technicianCodes.forEach((tc: string) => allKtvCodes.add(tc.toLowerCase()));
                    }
                }
                const totalUniqueKTVs = allKtvCodes.size || 1;
                bonusPoints = Math.floor(basePoints / totalUniqueKTVs);
            }

            // ─── Tip: sum from this KTV's items ────────────────────────
            const ktvTip = relevantItems.reduce((sum: number, i: any) => sum + (Number(i.tip) || 0), 0);

            return {
                id: b.id,
                billCode: b.billCode,
                createdAt: b.createdAt,
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
