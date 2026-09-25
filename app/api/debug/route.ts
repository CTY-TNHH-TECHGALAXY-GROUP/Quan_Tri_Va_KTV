import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ error: 'No db' });

    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('TurnQueue')
        .update({ status: 'off' })
        .eq('employee_id', 'NH011')
        .eq('date', today);

    return NextResponse.json({
        success: true,
        data,
        error
    });
}
