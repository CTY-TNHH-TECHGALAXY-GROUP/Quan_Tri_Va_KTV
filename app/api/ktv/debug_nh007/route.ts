import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ error: 'Supabase admin not initialized' }, { status: 500 });

    const date = '2026-05-05';
    const techCode = 'NH007';

    const { data: assignments } = await supabase.from('KtvAssignments').select('*').eq('employee_id', techCode).eq('business_date', date);
    const { data: turn } = await supabase.from('TurnQueue').select('*').eq('employee_id', techCode).eq('date', date);
    const { data: activeItems } = await supabase.from('BookingItems')
        .select('id, bookingId, status, segments, technicianCodes')
        .contains('technicianCodes', [techCode]);

    return NextResponse.json({ assignments, turn, activeItems });
}
