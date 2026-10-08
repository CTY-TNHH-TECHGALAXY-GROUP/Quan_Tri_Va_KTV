import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requirePermission, authErrorResponse } from '@/lib/auth-server';
import { cancelTodayTasksOfRoutine } from '@/lib/services/officeTaskActions.service';
import { sessionActor } from '../_lib/taskRoute';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

// GET: Fetch routines for a specific employee
// POST: Add a template to an employee's routine
// DELETE: Remove a routine
export async function GET(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');

    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('EmployeeRoutines')
      .select('*, TaskTemplates(id, name, description, requires_photo, min_photo_count, category_id, TaskCategories(name)), Rooms(name)')
      .eq('employee_id', employeeId)
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching routines:', error.message, error.code);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error('Unexpected error in GET /api/support/routines:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const body = await request.json();
    const { employeeId, templateId, roomId } = body;
    // Office P0: ADD = assign on top of the position template, EXCLUDE = remove a template task for this person.
    const mode = body.mode === 'EXCLUDE' ? 'EXCLUDE' : 'ADD';

    if (!employeeId || !templateId) {
      return NextResponse.json({ error: 'employeeId and templateId are required' }, { status: 400 });
    }

    // Check if already exists to simulate upsert due to complex index
    let query = supabase.from('EmployeeRoutines')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('template_id', templateId);
      
    if (roomId) query = query.eq('room_id', roomId);
    else query = query.is('room_id', null);

    const { data: existing, error: findErr } = await query.maybeSingle();

    let data, error;
    if (existing) {
      const res = await supabase.from('EmployeeRoutines')
        .update({ is_active: true, mode })
        .eq('id', existing.id)
        .select()
        .single();
      data = res.data; error = res.error;
    } else {
      const res = await supabase.from('EmployeeRoutines')
        .insert({ employee_id: employeeId, template_id: templateId, room_id: roomId || null, is_active: true, mode })
        .select()
        .single();
      data = res.data; error = res.error;
    }

    if (error) {
      console.error('Error adding routine:', error);
      return NextResponse.json({ error: error.message || error.details || 'Unknown DB error' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error('Unexpected error in POST /api/support/routines:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    // Gỡ routine (kéo theo huỷ mềm task hôm nay chưa làm) → quyền quản trị hỗ trợ.
    await requirePermission('support_tasks_admin');

    const { searchParams } = new URL(request.url);
    const routineId = searchParams.get('id');

    if (!routineId) {
      return NextResponse.json({ error: 'Routine id is required' }, { status: 400 });
    }

    // 1. Fetch routine to get employee_id and template_id
    const { data: routine } = await supabase
      .from('EmployeeRoutines')
      .select('employee_id, template_id, room_id')
      .eq('id', routineId)
      .single();

    if (routine) {
      // 2. Office P0: today's untouched tasks of this routine are soft-cancelled (logged), never deleted.
      const { data: userRow } = await supabase.from('Users').select('code').eq('id', routine.employee_id).maybeSingle();
      const staffIds = Array.from(new Set([routine.employee_id, userRow?.code].filter(Boolean))) as string[];
      const { actorId } = await sessionActor();
      await cancelTodayTasksOfRoutine(supabase, staffIds, routine.template_id, routine.room_id || null, actorId);
    }

    // 3. Delete the routine
    const { error } = await supabase
      .from('EmployeeRoutines')
      .delete()
      .eq('id', routineId);

    if (error) {
      console.error('Error deleting routine:', error.message, error.code);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error('Unexpected error in DELETE /api/support/routines:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
