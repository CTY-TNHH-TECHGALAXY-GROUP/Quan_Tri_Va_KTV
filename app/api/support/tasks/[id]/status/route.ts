import { NextResponse } from 'next/server';
import { SupportTaskService } from '@/lib/support-task.service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const { status, employeeId } = body;

    if (!status || !employeeId) {
      return NextResponse.json({ success: false, message: 'Thiếu thông tin status hoặc employeeId' }, { status: 400 });
    }

    const updatedTask = await SupportTaskService.updateTaskStatus(taskId, employeeId, status);

    return NextResponse.json({ success: true, data: updatedTask });
  } catch (error: any) {
    console.error('[POST /api/support/tasks/[id]/status] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Lỗi server khi cập nhật trạng thái' },
      { status: 500 }
    );
  }
}
