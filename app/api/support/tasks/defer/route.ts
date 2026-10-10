import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { deferTask } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Supervisor moves an unfinished task to another day / person. Body: { taskId, toDate, assigneeId?, note, dueTime? } */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { taskId, toDate, assigneeId, note, dueTime } = (await request.json()) || {};
    if (!taskId) return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    return NextResponse.json({ success: true, ...(await deferTask(sb, taskId, { toDate, assigneeId, note, dueTime }, actorId)) });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks/defer');
  }
}
