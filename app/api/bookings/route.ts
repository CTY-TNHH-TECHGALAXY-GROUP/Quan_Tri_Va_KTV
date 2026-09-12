import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireApiUser } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
        
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const user = await requireApiUser();
        if (!user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const startOfDay = `${date} 00:00:00`;
        const endOfDay = `${date} 23:59:59`;

        const { data: bookings, error: bError } = await supabase
            .from('Bookings')
            .select('*')
            .gte('bookingDate', startOfDay)
            .lte('bookingDate', endOfDay)
            .order('createdAt', { ascending: true });

        if (bError) throw bError;

        if (bookings && bookings.length > 0) {
            const bookingIds = bookings.map(b => b.id);
            const { data: items, error: iError } = await supabase
                .from('BookingItems')
                .select('*')
                .in('bookingId', bookingIds);

            if (iError) throw iError;

            // Fetch Services to map info
            const { data: svcs, error: svError } = await supabase
                .from('Services')
                .select('id, code, nameVN, nameEN, duration')
                .limit(1000);

            if (svError) console.error('❌ [API Bookings] Svc fetch error:', svError.message);

            const svcMap = new Map();
            if (svcs) {
                svcs.forEach((s: any) => {
                    if (s.id) svcMap.set(String(s.id).trim().toLowerCase(), s);
                    if (s.code) svcMap.set(String(s.code).trim().toLowerCase(), s);
                });
            }

            const bookingsWithItems = bookings.map(b => ({
                ...b,
                BookingItems: (items || [])
                    .filter(i => i.bookingId === b.id)
                    .map(i => {
                        const sId = String(i.serviceId || '').trim().toLowerCase();
                        const svc = svcMap.get(sId);
                        const getName = () => {
                            const n = svc?.nameVN || svc?.nameEN || svc?.name;
                            if (typeof n === 'object' && n !== null) return n.vn || n.en || String(n);
                            return n || `DV ${sId.toUpperCase()}`;
                        };
                        return {
                            ...i,
                            service_name: getName(),
                            duration: i.duration || svc?.duration || 60
                        };
                    })
            }));

            return NextResponse.json({ 
                success: true, 
                data: bookingsWithItems
            });
        }

        return NextResponse.json({ success: true, data: bookings || [] });
    } catch (error: any) {
        console.error('API Error (Bookings):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
