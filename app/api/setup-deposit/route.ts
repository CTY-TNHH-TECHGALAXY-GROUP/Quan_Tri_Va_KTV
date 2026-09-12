import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase admin not initialized');

    const { data, error } = await supabase
      .from('SystemConfigs')
      .upsert({
        key: 'web_booking_deposit_percent',
        value: '40',
        description: 'Tỉ lệ phần trăm cọc mặc định cho Web Booking'
      }, { onConflict: 'key' });

    if (error) throw error;
    
    return NextResponse.json({ success: true, message: 'Inserted 40% deposit config to DB.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
