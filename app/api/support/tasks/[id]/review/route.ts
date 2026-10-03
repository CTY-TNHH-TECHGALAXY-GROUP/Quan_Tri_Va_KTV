import { NextResponse } from 'next/server';
import { SupportTaskService } from '@/lib/support-task.service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const { decision, note, managerId } = body;

    if (!decision || !managerId) {
      return NextResponse.json({ success: false, message: 'Thiếu thông tin decision hoặc managerId' }, { status: 400 });
    }

    const updatedTask = await SupportTaskService.reviewTask(taskId, managerId, decision, note || '');

    return NextResponse.json({ success: true, data: updatedTask });
  } catch (error: any) {
    console.error('[POST /api/support/tasks/[id]/review] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Lỗi server khi nghiệm thu' },
      { status: 500 }
    );
  }
}
