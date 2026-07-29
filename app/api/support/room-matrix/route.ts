import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const { data, error } = await supabase
      .from('RoomTaskTemplates')
      .select('room_id, template_id');
      
    if (error) throw error;
    
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('API Error /api/support/room-matrix GET:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    if (body.bulk) {
      // Bulk overwrite
      const { error: delErr } = await supabase.from('RoomTaskTemplates').delete().neq('template_id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw delErr;

      if (body.matrix && body.matrix.length > 0) {
        const { error: insErr } = await supabase.from('RoomTaskTemplates').insert(body.matrix);
        if (insErr) throw insErr;
      }
      return NextResponse.json({ success: true });
    }

    // Legacy single toggle
    const { templateId, roomId, isChecked } = body;

    if (!templateId || !roomId) {
      return NextResponse.json({ success: false, error: 'Missing templateId or roomId' }, { status: 400 });
    }

    if (isChecked) {
      const { data: existing } = await supabase
        .from('RoomTaskTemplates')
        .select('id')
        .eq('template_id', templateId)
        .eq('room_id', roomId)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase
          .from('RoomTaskTemplates')
          .insert({ template_id: templateId, room_id: roomId });
        if (error) {
          console.error('Insert Error:', error);
          throw error;
        }
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
