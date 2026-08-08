import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data, error } = await supabase
            .from('TurnQueue')
            .select('*')
            .eq('date', date)
            .order('turns_completed', { ascending: true })
            .order('queue_position', { ascending: true });

        if (error) throw error;

        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(date);

        // Lấy lại dữ liệu mới nhất sau khi đồng bộ
        const { data: newData, error: newError } = await supabase
            .from('TurnQueue')
            .select('*')
            .eq('date', date)
            .order('turns_completed', { ascending: true })
            .order('queue_position', { ascending: true });

        if (newError) throw newError;

        return NextResponse.json({ success: true, data: newData });
    } catch (error: any) {
        console.error('API Error (Turns):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
