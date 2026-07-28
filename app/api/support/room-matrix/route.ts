import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { templateId, roomId, isChecked } = body;

    if (!templateId || !roomId) {
      return NextResponse.json({ success: false, error: 'Missing templateId or roomId' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    if (isChecked) {
      const { error } = await supabase
        .from('RoomTaskTemplates')
        .upsert(
          { template_id: templateId, room_id: roomId },
          { onConflict: 'template_id,room_id' }
        );
      if (error) {
        console.error('Insert Error:', error);
        throw error;
      }
    } else {
      const { error } = await supabase.from('RoomTaskTemplates')
        .delete()
        .eq('template_id', templateId)
        .eq('room_id', roomId);
      if (error) {
        console.error('Delete Error:', error);
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API Error /api/support/room-matrix POST:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
