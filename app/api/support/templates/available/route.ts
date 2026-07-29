import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    // Helper function to format room names
    const formatRoomName = (name: string) => {
      if (!name) return '';
      return name.replace(/Nhà vệ sinh [Ll]ầu /g, 'NVS').replace(/Nhà tắm [Ll]ầu /g, 'NTL');
    };

    // 1. Fetch All Active Templates (General tasks)
    const { data: roleData, error: roleErr } = await supabase
      .from('TaskTemplates')
      .select('id, name, category_id, TaskCategories(name, type)')
      .eq('is_active', true);

    // 2. Fetch Room Matrix (Room-specific mapped tasks)
    const { data: roomData, error: roomErr } = await supabase
      .from('RoomTaskTemplates')
      .select('room_id, template_id, Rooms(name), TaskTemplates(id, name, category_id, is_active, TaskCategories(name, type))');

    // Format room names in roomData
    const formattedRoomData = (roomData || []).map((r: any) => ({
      ...r,
      Rooms: r.Rooms ? { ...r.Rooms, name: formatRoomName(r.Rooms.name) } : null
    }));

    if (roleErr) throw roleErr;
    if (roomErr) throw roomErr;

    return NextResponse.json({ success: true, roleData, roomData: formattedRoomData });
  } catch (error: any) {
    console.error('API Error /api/support/templates/available GET:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
