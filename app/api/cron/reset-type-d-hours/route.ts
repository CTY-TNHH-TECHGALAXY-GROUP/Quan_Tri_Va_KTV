import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

        const url = new URL(request.url);
        const baseUrl = `${url.protocol}//${url.host}`;
        
        const res = await fetch(`${baseUrl}/api/ktv/type-d/service-hours?month=${monthStr}`);
        if (!res.ok) {
            throw new Error('Failed to fetch service hours');
        }
        const result = await res.json();
        
        if (!result.success || !result.data) {
            throw new Error('Service hours API returned false or no data');
        }

        const upsertData = result.data.map((d: any) => ({
            staff_id: d.staff_id,
            month,
            year,
            total_hours_earned: d.total_hours_earned,
            total_hours_penalty: d.total_hours_penalty,
            net_hours: d.net_hours,
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
