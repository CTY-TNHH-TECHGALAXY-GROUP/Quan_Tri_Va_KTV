import { NextResponse } from 'next/server';
import { EmployeeTasksService } from '@/lib/services/employeeTasks.service';
import { requirePermission, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const userCode = searchParams.get('userCode');

    const empIds = Array.from(new Set([employeeId, userCode].filter(Boolean) as string[]));

    if (empIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing employeeId or userCode' }, { status: 400 });
    }

    const includeRoomTasks = searchParams.get('includeRoomTasks') !== 'false';

    // 1. Generate new tasks for today if not already generated
    await EmployeeTasksService.generateTodayTasks(empIds, includeRoomTasks);

    // 2. Fetch the tasks
    const { data } = await EmployeeTasksService.fetchTasks(empIds, includeRoomTasks);

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('API Error /api/support/tasks GET:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, taskId } = body;

    if (!action || !taskId) {
      return NextResponse.json({ success: false, error: 'Missing action or taskId' }, { status: 400 });
    }

    if (action === 'START') {
      await EmployeeTasksService.updateTaskStatus(taskId, 'IN_PROGRESS');
      return NextResponse.json({ success: true });
    } 
    
    if (action === 'COMPLETE') {
      await EmployeeTasksService.updateTaskStatus(taskId, 'COMPLETED', 'PENDING_REVIEW');
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('API Error /api/support/tasks POST:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    // Xoá task là quyền quản trị hỗ trợ, nhân viên làm task không tự xoá được.
    await requirePermission('support_tasks_admin');

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
    }

    const { getSupabaseAdmin } = await import('@/lib/supabaseAdmin');
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    const { error } = await supabase.from('Tasks').delete().eq('id', taskId);

    if (error) {
      console.error('Error deleting task:', error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    console.error('API Error /api/support/tasks DELETE:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
