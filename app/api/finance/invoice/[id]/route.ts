import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireApiUser } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

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

        const user = await requireApiUser();
        if (!user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        if (!bookingId) {
            return NextResponse.json({ success: false, error: 'Booking ID is required' }, { status: 400 });
        }

        // Fetch Booking
        const { data: booking, error: bError } = await supabase
            .from('Bookings')
            .select('*')
            .eq('id', bookingId)
            .single();

        if (bError || !booking) {
            return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
        }

        // Fetch Items
        const { data: items, error: iError } = await supabase
            .from('BookingItems')
            .select('*')
            .eq('bookingId', bookingId);

        if (iError) throw iError;

        // Fetch Services info
        let enrichedItems = items || [];
        if (enrichedItems.length > 0) {
            const serviceIds = enrichedItems.map(i => i.serviceId).filter(Boolean);
            const { data: svcs, error: svError } = await supabase
                .from('Services')
                .select('id, code, nameVN, nameEN, price, duration')
                .in('id', serviceIds);

            if (!svError && svcs) {
                const svcMap = new Map();
                svcs.forEach(s => svcMap.set(s.id, s));
                enrichedItems = enrichedItems.map(i => {
                    const svc = svcMap.get(i.serviceId);
                    return {
                        ...i,
                        serviceName: svc?.nameVN || svc?.nameEN || `Dịch vụ ${i.serviceId}`,
                        originalPrice: svc?.price || i.price,
                        duration: i.duration || svc?.duration || 60
                    };
                });
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                ...booking,
                items: enrichedItems
            }
        });
    } catch (error: any) {
        console.error('[API Invoice] Error fetching booking:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
