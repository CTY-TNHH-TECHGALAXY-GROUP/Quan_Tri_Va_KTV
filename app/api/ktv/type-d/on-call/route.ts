import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvTypeDOnlineService } from '@/lib/services/KtvTypeDOnlineService';
import { notifyOnCallChange } from '@/lib/ktv-on-call-notify';

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
    const allow_on_call = data?.work_type === 'TYPE_D' && featureFlags.allow_on_call === true;
    const is_on_call = data?.online_status === 'ONLINE' || data?.online_status === 'AT_VENUE';

    const { vnToday } = await import('@/lib/vn-time');
    const todayStr = vnToday();

    const { data: dailyReg } = await supabase.from('KTVTypeDDailyRegistration').select('status').eq('staff_id', techCode).eq('work_date', todayStr).maybeSingle();
    const isOffToday = dailyReg?.status === 'OFF_REGISTERED';

    return NextResponse.json({
      success: true,
      data: {
        allow_on_call,
        is_on_call,
        online_status: data?.online_status,
        travel_time_mins: data?.travel_minutes || featureFlags.travel_time_mins || 30,
        isOffToday
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { techCode, is_on_call, travel_time_mins, expected_end } = await req.json();

    if (!techCode) {
      return NextResponse.json({ error: 'Missing techCode' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }

    const { data, error: fetchError } = await supabase
      .from('Staff')
      .select('work_type, feature_flags, online_status')
      .eq('id', techCode)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const currentFlags = data?.feature_flags || {};
    const isTypeD = data?.work_type === 'TYPE_D';
    const allow_on_call = isTypeD && currentFlags.allow_on_call === true;

    if (!allow_on_call) {
      return NextResponse.json({ error: 'KTV Loại D này chưa được cấp quyền Nhận Đơn.' }, { status: 403 });
    }

    const newFlags = {
      ...currentFlags,
      is_on_call,
      travel_time_mins: travel_time_mins || 30,
      expected_end,
    };

    if (!is_on_call) {
      // 1. Kiểm tra block_checkout_incomplete_tasks_TYPE_D
      const { data: config } = await supabase
          .from('SystemConfigs')
          .select('value')
          .eq('key', 'block_checkout_incomplete_tasks_TYPE_D')
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

      // 2. Kiểm tra GuestArrivalEvents lock
      const { hasPendingDispatch, isGuestArrivalEnabled } = await import('@/lib/guest-arrival.logic');
      if (await isGuestArrivalEnabled(supabase)) {
          const { data: activeLock } = await supabase
              .from('GuestArrivalEvents')
              .select('id, note')
              .is('released_at', null)
              .maybeSingle();

          if (activeLock) {
              if (await hasPendingDispatch(supabase)) {
                 return NextResponse.json({ error: activeLock.note || 'Quầy vừa báo có khách. Vui lòng chờ điều phối trước khi tắt nhận đơn!' }, { status: 403 });
              } else {
                 const { vnNow } = await import('@/lib/vn-time');
                 await supabase
                     .from('GuestArrivalEvents')
                     .update({ released_at: vnNow().toISOString(), released_by: 'AUTO' })
                     .eq('id', activeLock.id);
              }
          }
      }

      const res = await KtvTypeDOnlineService.goOffline(supabase, techCode);
      if (!res.success) {
        return NextResponse.json({ error: res.error }, { status: 500 });
      }
      
      const updatePayload: any = { feature_flags: newFlags };
      await supabase.from('Staff').update(updatePayload).eq('id', techCode);

      await notifyOnCallChange(supabase, { staffId: techCode, isOnCall: false });

      return NextResponse.json({ success: true, data: newFlags });
    }

    // Tính availableFromStr tự động ở backend
    const vnTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    vnTime.setMinutes(vnTime.getMinutes() + (travel_time_mins || 30));
    const availableFromStr = `${vnTime.getHours().toString().padStart(2, '0')}:${vnTime.getMinutes().toString().padStart(2, '0')}`;

    let availableUntilStr = expected_end;
    if (!availableUntilStr) {
        const until = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
        until.setHours(until.getHours() + 4);
        availableUntilStr = `${until.getHours().toString().padStart(2, '0')}:${until.getMinutes().toString().padStart(2, '0')}`;
    }

    const res = await KtvTypeDOnlineService.goOnline(supabase, {
      staffId: techCode,
      travelMinutes: travel_time_mins || 30,
      availableFrom: availableFromStr,
      availableUntil: availableUntilStr
    });

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 500 });
    }

    const updatePayload: any = { feature_flags: newFlags };
    await supabase.from('Staff').update(updatePayload).eq('id', techCode);

    await notifyOnCallChange(supabase, {
      staffId: techCode,
      isOnCall: true,
      travelMinutes: travel_time_mins || 30,
      availableFrom: availableFromStr,
      availableUntil: availableUntilStr,
    });

    return NextResponse.json({ success: true, data: newFlags });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
