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
      .select('feature_flags')
      .eq('id', techCode)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const featureFlags = data?.feature_flags || {};

    return NextResponse.json({
      success: true,
      data: {
        allow_on_call: featureFlags.allow_on_call || false,
        is_on_call: featureFlags.is_on_call || false,
        travel_time_mins: featureFlags.travel_time_mins || 30,
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

    // Lấy feature_flags hiện tại
    const { data, error: fetchError } = await supabase
      .from('Staff')
      .select('feature_flags')
      .eq('id', techCode)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const currentFlags = data?.feature_flags || {};

    // Chỉ cập nhật nếu được phép allow_on_call
    if (!currentFlags.allow_on_call) {
      return NextResponse.json({ error: 'Tính năng này chưa được kích hoạt cho bạn.' }, { status: 403 });
    }

    const newFlags = {
      ...currentFlags,
      is_on_call,
      travel_time_mins: travel_time_mins || 30
    };

    const { error: updateError } = await supabase
      .from('Staff')
      .update({ feature_flags: newFlags })
      .eq('id', techCode);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: newFlags });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
