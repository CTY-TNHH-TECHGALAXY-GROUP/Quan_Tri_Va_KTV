import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const techCode = searchParams.get('techCode');

    if (!techCode) {
      return NextResponse.json({ success: false, error: 'Missing techCode' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'DB Init Error' }, { status: 500 });

    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startOfVNDay = new Date(`${vnTime.toISOString().split('T')[0]}T00:00:00+07:00`).toISOString();

    const { data, error } = await supabase
      .from('StaffNotifications')
      .select('id, message, type, isRead, createdAt')
      .eq('employeeId', techCode)
      .gte('createdAt', startOfVNDay)
      .order('createdAt', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error('❌ [KTV Notifications API]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { notificationIds } = await request.json();
    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'DB Init Error' }, { status: 500 });

    const { error } = await supabase
      .from('StaffNotifications')
      .update({ isRead: true })
      .in('id', notificationIds);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('❌ [KTV Notifications API Mark Read]', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
