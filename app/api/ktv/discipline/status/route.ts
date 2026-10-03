import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvDisciplineService } from '@/lib/services/KtvDisciplineService';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const staffId = searchParams.get('staffId');

        if (!staffId) {
            return NextResponse.json({ success: false, error: 'Thiếu staffId' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase init failed' }, { status: 500 });
        }

        // 1. Tính thời gian làm liên tục
        const { totalMins } = await KtvDisciplineService.calculateContinuousWorkMins(supabase, staffId);

        // 2. Lấy config miễn phạt & giáng chức
        const { data: configs } = await supabase.from('SystemConfigs').select('key, value').in('key', [
            'ktv_continuous_work_exempt_hours',
            'ktv_discipline_demotion_threshold'
        ]);
        
        let exemptHours = 4;
        let demotionThreshold = 80;
        
        configs?.forEach(c => {
            if (c.key === 'ktv_continuous_work_exempt_hours') exemptHours = Number(c.value);
            if (c.key === 'ktv_discipline_demotion_threshold') demotionThreshold = Number(c.value);
        });

        // Hai con số của loại D — để hộp thoại từ chối nói đúng mức phạt thật
        // thay vì câu chung "trừ 10 điểm chuyên cần" của hệ A/B/C.
        const { KtvTypeDDisciplineService } = await import('@/lib/services/KtvTypeDDisciplineService');
        const [rejectMultiplier, minHoursToReject] = await Promise.all([
            KtvTypeDDisciplineService.getRejectMultiplier(supabase),
            KtvTypeDDisciplineService.getMinHoursToReject(supabase),
        ]);

        // 3. Lấy điểm chuyên cần tháng hiện tại
        const date = new Date();
        const { data: pointsData } = await supabase.from('KTVDisciplinePoints')
            .select('total_points')
            .eq('staff_id', staffId)
            .eq('month', date.getMonth() + 1)
            .eq('year', date.getFullYear())
            .single();
            
        const totalPoints = pointsData?.total_points ?? 100;

        return NextResponse.json({
            success: true,
            data: {
                totalPoints,
                demotionThreshold,
                continuousWorkMins: totalMins,
                exemptHours,
                rejectMultiplier,
                minHoursToReject
            }
        });

    } catch (error: any) {
        console.error('Lỗi API get discipline status:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
