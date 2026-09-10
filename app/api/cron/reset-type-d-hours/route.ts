import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvTypeDTurnService } from '@/lib/services/KtvTypeDTurnService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const now = new Date();
        const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const year = prevMonthDate.getFullYear();
        const month = prevMonthDate.getMonth() + 1;
        
        const monthStr = `${year}-${String(month).padStart(2, '0')}`;

        // Gọi THẲNG service, không tự fetch API của chính mình.
        //
        // ⚠️ Đường cũ dựng baseUrl từ `request.url` rồi HTTP về `/service-hours`.
        // Hỏng ở hai chỗ: mạng/host sai là cả tháng không chốt được, và route đó
        // trả 0 giờ cho tất cả khi tham số tháng sai định dạng — cron nuốt số 0
        // rồi GHI ĐÈ sổ tháng bằng số rỗng.
        const { data: staff } = await supabase
            .from('Staff').select('id').eq('work_type', 'TYPE_D');
        const staffIds = (staff || []).map((s: any) => s.id);

        const breakdown = await KtvTypeDTurnService.getMonthlyHoursBreakdown(
            supabase as any, staffIds, month, year
        );

        const upsertData = staffIds.map((id: string) => ({
            staff_id: id,
            month,
            year,
            total_hours_earned: breakdown[id]?.hours_earned ?? 0,
            total_hours_penalty: breakdown[id]?.hours_penalty ?? 0,
            net_hours: breakdown[id]?.net_hours ?? 0,
            synced_at: new Date().toISOString()
        }));

        if (upsertData.length > 0) {
            const { error } = await supabase
                .from('KTVMonthlyServiceHours')
                .upsert(upsertData, { onConflict: 'staff_id,month,year' });
                
            if (error) {
                console.error('Error upserting KTVMonthlyServiceHours:', error);
                throw error;
            }
        }

        return NextResponse.json({ success: true, count: upsertData.length, month: monthStr });
    } catch (err: any) {
        console.error('Exception POST /api/cron/reset-type-d-hours:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
