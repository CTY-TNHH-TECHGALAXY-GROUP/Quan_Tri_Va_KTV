import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'No admin client' });

        // 1. Reset KTV Nhi status
        const { error: resetError } = await supabase
            .from('TurnQueue')
            .update({ 
                status: 'available', 
                current_order_id: null,
                estimated_end_time: null 
            })
            .eq('employee_id', 'NH002');

        // 2. Clear NH002 active bookings (move BACK to NEW to restart flow)
        const { error: bookingResetError } = await supabase
            .from('Bookings')
            .update({ 
                status: 'NEW',
                technicianCode: null,
                bedId: null,
                roomName: null
            })
            .eq('technicianCode', 'NH002');

        return NextResponse.json({
            resetStatus: resetError ? 'Error: ' + resetError.message : 'Success',
            bookingReset: bookingResetError ? 'Error: ' + bookingResetError.message : 'Success'
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
