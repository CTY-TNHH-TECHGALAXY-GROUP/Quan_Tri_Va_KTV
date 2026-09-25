import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvDisciplineService } from '@/lib/services/KtvDisciplineService';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { staffId, ruleCode, note } = body;

        if (!staffId || !ruleCode) {
            return NextResponse.json({ success: false, error: 'Thiếu staffId hoặc ruleCode' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase init failed' }, { status: 500 });
        }

        const result = await KtvDisciplineService.deductPoints(supabase, staffId, ruleCode, note);

        return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Lỗi API deduct discipline points:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
