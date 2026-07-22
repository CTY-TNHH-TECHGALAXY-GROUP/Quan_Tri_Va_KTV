import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'No admin client' });

        const { data: bookings } = await supabase.from('Bookings').select('*').limit(5);
        const { data: bookingItems } = await supabase.from('BookingItems').select('*').limit(5);
        const { data: customers } = await supabase.from('Customers').select('*').limit(5);
        const { data: services } = await supabase.from('Services').select('*').limit(5);
        
        // Count statuses
        const { data: statuses } = await supabase.from('Bookings').select('status');
        const statusCounts = (statuses || []).reduce((acc: any, b) => {
            acc[b.status] = (acc[b.status] || 0) + 1;
            return acc;
        }, {});

        return NextResponse.json({
            sampleBooking: bookings?.[0] || null,
            sampleBookingItem: bookingItems?.[0] || null,
            sampleCustomer: customers?.[0] || null,
            sampleService: services?.[0] || null,
            statusCounts,
            totalBookings: (statuses || []).length
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
