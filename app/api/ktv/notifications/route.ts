import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * API Lấy và cập nhật thông báo của KTV (Bonus/Rewards)
 * GET /api/ktv/notifications?techCode=NH001
 * PATCH /api/ktv/notifications?id=uuid
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const techCode = searchParams.get('techCode');

    if (!techCode) {
        return NextResponse.json({ success: false, error: 'techCode is required' }, { status: 400 });
    }

    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Lấy các thông báo REWARD chưa đọc của KTV
        const { data, error } = await supabase
            .from('StaffNotifications')
            .select('*')
            .eq('employeeId', techCode)
            .eq('type', 'REWARD')
            .eq('isRead', false)
            .order('createdAt', { ascending: false });

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('API Error (GET /api/ktv/notifications):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { data, error } = await supabase
            .from('StaffNotifications')
            .update({ isRead: true })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('API Error (PATCH /api/ktv/notifications):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
