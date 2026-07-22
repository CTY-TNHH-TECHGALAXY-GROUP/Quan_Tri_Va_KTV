import { NextResponse } from 'next/server';
import { EmployeeTasksService } from '@/lib/services/employeeTasks.service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');

    if (!employeeId) {
      return NextResponse.json({ success: false, error: 'Missing employeeId' }, { status: 400 });
    }

    // 1. Generate new tasks for today if not already generated
    await EmployeeTasksService.generateTodayTasks(employeeId);

    // 2. Fetch the tasks
    const { data } = await EmployeeTasksService.fetchTasks(employeeId);

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
