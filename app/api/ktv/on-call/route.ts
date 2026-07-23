import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

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
    
    // Tính trạng thái Online thực tế
    const nowMs = Date.now();
    const untilMs = data?.available_until ? new Date(data.available_until).getTime() : 0;
    const is_on_call = data?.online_status === 'ONLINE' && untilMs > nowMs;

    return NextResponse.json({
      success: true,
      data: {
        allow_on_call,
        is_on_call,
        travel_time_mins: data?.travel_minutes || featureFlags.travel_time_mins || 30,
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { techCode, is_on_call, travel_time_mins } = await req.json();

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
      travel_time_mins: travel_time_mins || 30
    };

    // Update các cột Native mới của Phase 4
    const updates: any = {
      feature_flags: newFlags,
      online_status: is_on_call ? 'ONLINE' : 'OFFLINE',
      travel_minutes: is_on_call ? (travel_time_mins || 30) : null,
    };

    if (is_on_call) {
      updates.available_from = new Date().toISOString();
      const until = new Date();
      until.setHours(until.getHours() + 4);
      updates.available_until = until.toISOString();
    } else {
      updates.available_from = null;
      updates.available_until = null;
    }

    const { error: updateError } = await supabase
      .from('Staff')
      .update(updates)
      .eq('id', techCode);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: newFlags });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
