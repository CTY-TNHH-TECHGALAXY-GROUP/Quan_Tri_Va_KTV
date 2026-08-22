import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const { data, error } = await supabase
      .from('RoomTaskTemplates')
      .select('room_id, template_id, custom_min_photo_count');
      
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
      // 1. Fetch current matrix to find additions
      const { data: oldMatrix } = await supabase.from('RoomTaskTemplates').select('room_id, template_id');
      const oldMatrixSet = new Set(oldMatrix?.map(m => `${m.room_id}_${m.template_id}`) || []);

      // Bulk overwrite
      const { error: delErr } = await supabase.from('RoomTaskTemplates').delete().neq('template_id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw delErr;

      if (body.matrix && body.matrix.length > 0) {
        const { error: insErr } = await supabase.from('RoomTaskTemplates').insert(body.matrix);
        if (insErr) throw insErr;
        
        // Auto-assign new additions to employees currently covering those rooms
        const additions = body.matrix.filter((m: any) => !oldMatrixSet.has(`${m.room_id}_${m.template_id}`));
        if (additions.length > 0) {
          const { data: existingRoutines } = await supabase.from('EmployeeRoutines').select('employee_id, room_id').not('room_id', 'is', null);
          const roomEmployees = new Map<string, Set<string>>();
          existingRoutines?.forEach(r => {
             if (!roomEmployees.has(r.room_id)) roomEmployees.set(r.room_id, new Set());
             roomEmployees.get(r.room_id)!.add(r.employee_id);
          });
          
          const newRoutines: any[] = [];
          for (const m of additions) {
            const employees = roomEmployees.get(m.room_id);
            if (employees) {
              for (const empId of employees) {
                newRoutines.push({
                  employee_id: empId,
                  room_id: m.room_id,
                  template_id: m.template_id,
                  is_active: true
                });
              }
            }
          }
          
          if (newRoutines.length > 0) {
            await supabase.from('EmployeeRoutines').insert(newRoutines);
          }
        }
        
        // Sync custom photo count to existing NOT_STARTED/IN_PROGRESS tasks for today
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        for (const m of body.matrix) {
          if (m.custom_min_photo_count !== null && m.custom_min_photo_count !== undefined) {
            await supabase.from('Tasks')
              .update({ min_photo_count: m.custom_min_photo_count })
              .eq('template_id', m.template_id)
              .eq('room_id', m.room_id)
              .in('status', ['NOT_STARTED', 'IN_PROGRESS'])
              .gte('created_at', todayStart.toISOString());
          }
        }
      }
      
      // Cleanup orphaned EmployeeRoutines
      const { data: routines } = await supabase.from('EmployeeRoutines').select('id, room_id, template_id').not('room_id', 'is', null);
      const { data: newMatrix } = await supabase.from('RoomTaskTemplates').select('room_id, template_id');
      const matrixSet = new Set(newMatrix?.map(m => `${m.room_id}_${m.template_id}`) || []);
      const routinesToDelete = routines?.filter(r => !matrixSet.has(`${r.room_id}_${r.template_id}`)).map(r => r.id) || [];
      if (routinesToDelete.length > 0) {
        await supabase.from('EmployeeRoutines').delete().in('id', routinesToDelete);
      }
      
      // Cleanup orphaned NOT_STARTED tasks today
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const { data: tasks } = await supabase.from('Tasks').select('id, room_id, template_id')
        .eq('status', 'NOT_STARTED')
        .not('room_id', 'is', null)
        .gte('created_at', todayStart.toISOString());
      const tasksToDelete = tasks?.filter(t => !matrixSet.has(`${t.room_id}_${t.template_id}`)).map(t => t.id) || [];
      if (tasksToDelete.length > 0) {
        await supabase.from('Tasks').delete().in('id', tasksToDelete);
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
