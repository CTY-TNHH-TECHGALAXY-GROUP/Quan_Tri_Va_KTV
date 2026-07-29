import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOnlineService } from '@/lib/services/KtvOnlineService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techCode = searchParams.get('techCode');

    if (!techCode) {
      return NextResponse.json({ error: 'Missing techCode' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }

    const { data, error } = await supabase
      .from('Staff')
      .select('work_type, feature_flags, online_status, travel_minutes, available_until')
      .eq('id', techCode)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const featureFlags = data?.feature_flags || {};
    const isTypeB = data?.work_type === 'TYPE_B';
    const allow_on_call = isTypeB || featureFlags.allow_on_call === true;
    
    // Tính trạng thái Online thực tế (Bao gồm cả ONLINE và AT_VENUE)
    // Không cần check available_until nữa vì Type B có thể tự do tắt app khi mệt
    const is_on_call = data?.online_status === 'ONLINE' || data?.online_status === 'AT_VENUE';

    return NextResponse.json({
      success: true,
      data: {
        allow_on_call,
        is_on_call,
        online_status: data?.online_status,
        travel_time_mins: data?.travel_minutes || featureFlags.travel_time_mins || 30,
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { techCode, is_on_call, travel_time_mins, expected_start, expected_end } = await req.json();

    if (!techCode) {
      return NextResponse.json({ error: 'Missing techCode' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }

    const { data, error: fetchError } = await supabase
      .from('Staff')
      .select('work_type, feature_flags')
      .eq('id', techCode)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const currentFlags = data?.feature_flags || {};
    const isTypeB = data?.work_type === 'TYPE_B';
    const allow_on_call = isTypeB || currentFlags.allow_on_call === true;

    // Chỉ cập nhật nếu được phép allow_on_call (KTV Loại B hoặc được cấp cờ)
    if (!allow_on_call) {
      return NextResponse.json({ error: 'Tính năng này chỉ dành cho KTV Loại B (Hợp tác).' }, { status: 403 });
    }

    // Luôn giữ cờ feature_flags để backup/tương thích ngược
    const newFlags = {
      ...currentFlags,
      is_on_call,
      travel_time_mins: travel_time_mins || 30,
      expected_start,
      expected_end
    };

    if (!is_on_call) {
      // Dùng service chuẩn để xóa TurnQueue và đóng KTVShifts
      const res = await KtvOnlineService.goOffline(supabase, techCode);
      if (!res.success) {
        return NextResponse.json({ error: res.error }, { status: 500 });
      }
      
      // Update cờ feature_flags
      await supabase.from('Staff').update({ feature_flags: newFlags }).eq('id', techCode);
      
      return NextResponse.json({ success: true, data: newFlags });
    }

    // Tính thời gian KTV sẽ có mặt (hiện tại + thời gian di chuyển)
    let availableFromStr = expected_start;
    if (!availableFromStr) {
        const vnTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
        vnTime.setMinutes(vnTime.getMinutes() + (travel_time_mins || 30));
        availableFromStr = `${vnTime.getHours().toString().padStart(2, '0')}:${vnTime.getMinutes().toString().padStart(2, '0')}`;
    }

    let availableUntilStr = expected_end;
    if (!availableUntilStr) {
        // Tạm giữ available_until +4h phòng hờ quên tắt
        const until = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
        until.setHours(until.getHours() + 4);
        availableUntilStr = `${until.getHours().toString().padStart(2, '0')}:${until.getMinutes().toString().padStart(2, '0')}`;
    }

    // Dùng service chuẩn để cập nhật trạng thái ONLINE
    const res = await KtvOnlineService.goOnline(supabase, {
      staffId: techCode,
      travelMinutes: travel_time_mins || 30,
      availableFrom: availableFromStr,
      availableUntil: availableUntilStr
    });

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 500 });
    }

    // Luôn update cờ feature_flags để backup
    await supabase.from('Staff').update({ feature_flags: newFlags }).eq('id', techCode);

    return NextResponse.json({ success: true, data: newFlags });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
