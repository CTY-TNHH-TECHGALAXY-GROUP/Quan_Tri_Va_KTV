import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';
export const fetchCache = "force-no-store";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: bookingId } = await params;
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        try {
            await requirePermission('dashboard');
        } catch (e) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        if (!bookingId) {
            return NextResponse.json({ success: false, error: 'Booking ID is required' }, { status: 400 });
        }

        // Fetch Booking
        const { data: booking, error: bError } = await supabase
            .from('Bookings')
            .select('*')
            .or(`id.eq.${bookingId},accessToken.eq.${bookingId}`)
            .single();

        if (bError || !booking) {
            return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
        }

        // Fetch child bookings if this is a parent booking
        const { data: childBookings } = await supabase
            .from('Bookings')
            .select('id, totalAmount')
            .eq('parent_booking_id', booking.id);
            
        const allBookingIds = [booking.id, ...(childBookings || []).map(b => b.id)];
        
        let aggregatedTotal = booking.totalAmount || 0;
        
        if (childBookings && childBookings.length > 0) {
            childBookings.forEach(cb => {
                aggregatedTotal += (cb.totalAmount || 0);
            });
        }

        // Fetch Items
        const { data: items, error: iError } = await supabase
            .from('BookingItems')
            .select('*')
            .in('bookingId', allBookingIds);

        if (iError) throw iError;

        // Fetch Services info
        let enrichedItems = items || [];
        if (enrichedItems.length > 0) {
            const serviceIds = enrichedItems.map(i => i.serviceId).filter(Boolean);
            const { data: svcs, error: svError } = await supabase
                .from('Services')
                .select('id, code, nameVN, nameEN, nameCN, nameJP, nameKR, priceVND, duration')
                .in('id', serviceIds);

            if (!svError && svcs) {
                const svcMap = new Map();
                svcs.forEach((s: any) => {
                    if (s.id) svcMap.set(String(s.id).trim().toLowerCase(), s);
                    if (s.code) svcMap.set(String(s.code).trim().toLowerCase(), s);
                });
                
                enrichedItems = enrichedItems.map(i => {
                    const sId = String(i.serviceId || '').trim().toLowerCase();
                    const svc = svcMap.get(sId);
                    
                    const getName = () => {
                        const n = svc?.nameVN || svc?.nameEN || svc?.name;
                        if (typeof n === 'object' && n !== null) return n.vn || n.en || String(n);
                        return n || `Dịch vụ ${i.serviceId || 'Chưa rõ'}`;
                    };

                    return {
                        ...i,
                        serviceName: getName(),
                        serviceNameEN: svc?.nameEN || '',
                        serviceNameCN: svc?.nameCN || '',
                        serviceNameJP: svc?.nameJP || '',
                        serviceNameKR: svc?.nameKR || '',
                        originalPrice: svc?.priceVND || i.price,
                        duration: i.duration || svc?.duration || 60
                    };
                });
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                ...booking,
                discountAmount: booking.discountAmount || 0,
                totalAmount: aggregatedTotal,
                items: enrichedItems
            }
        });
    } catch (error: any) {
        console.error('[API Invoice] Error fetching booking:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
