import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvKpiService } from '@/lib/services/KtvKpiService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const staffId = searchParams.get('staffId');
        const techCode = searchParams.get('techCode');
        let month = Number(searchParams.get('month'));
        let year = Number(searchParams.get('year'));

        if (!staffId && !techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu staffId hoặc techCode' }, { status: 400 });
        }

        // Nếu truyền techCode, tìm uuid
        let resolvedStaffId = staffId;
        if (!resolvedStaffId && techCode) {
            const { data: staffData } = await supabase
                .from('Staff')
                .select('id')
                .eq('code', techCode.toUpperCase())
                .maybeSingle();
            
            if (staffData) {
                resolvedStaffId = staffData.id;
            } else {
                resolvedStaffId = techCode; // fallback
            }
        }

        const now = new Date();
        if (!month) month = now.getMonth() + 1;
        if (!year) year = now.getFullYear();

        const data = await KtvKpiService.getMonthlyHours(supabase, {
            staffId: resolvedStaffId as string,
            month,
            year
        });

        return NextResponse.json({ success: true, data });
    } catch (e: any) {
        console.error('Lỗi ktv/kpi API:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
