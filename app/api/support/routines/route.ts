import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET: Fetch routines for a specific employee
// POST: Add a template to an employee's routine
// DELETE: Remove a routine
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');

    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('EmployeeRoutines')
      .select('*, TaskTemplates(id, name, description, requires_photo, min_photo_count, category_id, TaskCategories(name))')
      .eq('employee_id', employeeId)
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching routines:', error.message, error.code);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Unexpected error in GET /api/support/routines:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { employeeId, templateId } = body;

    if (!employeeId || !templateId) {
      return NextResponse.json({ error: 'employeeId and templateId are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('EmployeeRoutines')
      .upsert(
        { employee_id: employeeId, template_id: templateId, is_active: true },
        { onConflict: 'employee_id,template_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error adding routine:', error.message, error.code);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/support/routines:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const routineId = searchParams.get('id');

    if (!routineId) {
      return NextResponse.json({ error: 'Routine id is required' }, { status: 400 });
    }

    // 1. Fetch routine to get employee_id and template_id
    const { data: routine } = await supabase
      .from('EmployeeRoutines')
      .select('employee_id, template_id')
      .eq('id', routineId)
      .single();

    if (routine) {
      // 2. Delete generated tasks for today that are NOT_STARTED
      const d1 = new Date(); d1.setHours(0, 0, 0, 0); const todayStart = d1.toISOString();
      const d2 = new Date(); d2.setHours(23, 59, 59, 999); const todayEnd = d2.toISOString();

      await supabase
        .from('Tasks')
        .delete()
        .eq('assignee_id', routine.employee_id)
        .eq('template_id', routine.template_id)
        .eq('status', 'NOT_STARTED')
        .gte('created_at', todayStart)
        .lte('created_at', todayEnd);
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
    console.error('Unexpected error in DELETE /api/support/routines:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
