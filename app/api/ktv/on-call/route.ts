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
      .select('work_type, feature_flags, is_active_vip_menu')
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
    const was_vip = data?.is_active_vip_menu || false;
    const newFlags = {
      ...currentFlags,
      is_on_call,
      travel_time_mins: travel_time_mins || 30,
      expected_start,
      expected_end,
      // Lưu lại trạng thái VIP ban đầu trước khi bật on-call (chỉ ghi đè nếu đang BẬT)
      was_vip_before_oncall: is_on_call ? was_vip : currentFlags.was_vip_before_oncall
    };

    if (!is_on_call) {
      // ─── Check pending tasks before turning off on-call ─────────────
      const { data: config } = await supabase
          .from('SystemConfigs')
          .select('value')
          .eq('key', 'block_checkout_incomplete_tasks_TYPE_B')
          .maybeSingle();

      if (config?.value) {
          const nowUtc = new Date();
          const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
          const vnNow = new Date(nowUtc.getTime() + VN_OFFSET_MS);
          const vnDateStr = vnNow.toISOString().slice(0, 10);
          const todayStartIso = new Date(`${vnDateStr}T00:00:00+07:00`).toISOString();

          const { data: incompleteTasks } = await supabase
              .from('Tasks')
              .select('id')
              .eq('assignee_id', techCode)
              .gte('created_at', todayStartIso)
              .neq('inspection_status', 'PASSED');

          if (incompleteTasks && incompleteTasks.length > 0) {
              return NextResponse.json({ 
                  error: `Bạn còn ${incompleteTasks.length} công việc trong ngày chưa được Admin nghiệm thu. Vui lòng hoàn thành và chờ Admin xác nhận trước khi Tắt Nhận Đơn!` 
              }, { status: 403 });
          }
      }

      // Dùng service chuẩn để xóa TurnQueue và đóng KTVShifts
      const res = await KtvOnlineService.goOffline(supabase, techCode);
      if (!res.success) {
        return NextResponse.json({ error: res.error }, { status: 500 });
      }
      
      // Chỉ update cờ feature_flags, KHÔNG ĐỤNG ĐẾN is_active_vip_menu
      const updatePayload: any = { feature_flags: newFlags };

      await supabase.from('Staff').update(updatePayload).eq('id', techCode);
      
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

    // Chỉ update cờ feature_flags, KHÔNG ĐỤNG ĐẾN is_active_vip_menu
    const updatePayload: any = { feature_flags: newFlags };
    
    await supabase.from('Staff').update(updatePayload).eq('id', techCode);

    return NextResponse.json({ success: true, data: newFlags });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
