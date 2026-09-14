import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvOnlineService } from '@/lib/services/KtvOnlineService';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action, staffId, travelMinutes, availableFrom, availableUntil } = body;

        if (!staffId) {
            return NextResponse.json({ success: false, error: 'Thiếu staffId' }, { status: 400 });
        }

        if (action === 'go_online') {
            const res = await KtvOnlineService.goOnline(supabase, {
                staffId,
                travelMinutes: Number(travelMinutes) || 15,
                availableFrom,
                availableUntil
            });
            if (!res.success) return NextResponse.json({ success: false, error: res.error }, { status: 500 });
            return NextResponse.json({ success: true, message: 'Đăng ký online thành công' });
        } 
        else if (action === 'arrive') {
            const res = await KtvOnlineService.arriveAtVenue(supabase, staffId);
            if (!res.success) return NextResponse.json({ success: false, error: res.error }, { status: 500 });
            return NextResponse.json({ success: true, message: 'Cập nhật đã tới nơi thành công' });
        }
        else if (action === 'go_offline') {
            const res = await KtvOnlineService.goOffline(supabase, staffId);
            if (!res.success) return NextResponse.json({ success: false, error: res.error }, { status: 500 });
            return NextResponse.json({ success: true, message: 'Đã tắt online' });
        }
        else {
            return NextResponse.json({ success: false, error: 'Action không hợp lệ' }, { status: 400 });
        }
    } catch (e: any) {
        console.error('Lỗi ktv/online API:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
