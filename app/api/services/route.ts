import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data, error } = await supabase
            .from('Services')
            .select('*')
            .order('category', { ascending: true })
            .order('nameVN', { ascending: true })
            .limit(1000);

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('API Error (Services):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
