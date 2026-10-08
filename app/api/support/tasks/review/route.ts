import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { reviewTasks } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/**
 * Approve one or many tasks, or return ONE task with the slots that failed.
 * Body: { taskIds: string[], decision: 'PASSED'|'REWORK_REQUIRED', reasonCode?, note?,
 *         rejectedSlots?: [{ slot, reason?, mark?: {x,y} }], allSlots?: boolean, photoPath? }
 * Replaces the direct client writes in EmployeeDetail.logic.ts / SupportReviews.logic.ts.
 */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const body = await request.json();
    if (!['PASSED', 'REWORK_REQUIRED'].includes(body?.decision)) {
      return NextResponse.json({ success: false, error: 'Invalid decision' }, { status: 400 });
    }
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const reviewer = await sessionActor();
    const results = await reviewTasks(sb, {
      taskIds: Array.isArray(body.taskIds) ? body.taskIds : [body.taskId].filter(Boolean),
      decision: body.decision,
      reasonCode: body.reasonCode,
      note: body.note,
      rejectedSlots: body.rejectedSlots,
      allSlots: body.allSlots === true,
      photoPath: body.photoPath ?? null,
    }, reviewer);
    const failed = results.filter(r => !r.ok);
    return NextResponse.json({ success: failed.length === 0, results, error: failed[0]?.error }, { status: failed.length === results.length ? 409 : 200 });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks/review');
  }
}
