import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { reassignTask } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Give a declined task to someone else. Body: { taskId, assigneeId } */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { taskId, assigneeId } = (await request.json()) || {};
    if (!taskId) return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    await reassignTask(sb, taskId, assigneeId, actorId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks/reassign');
  }
}
