import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { createAdhocTask } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/**
 * Assign an ad-hoc task. Whether the assignee must press "Nhận" or may decline follows the
 * admin-configured adhoc policy of their position.
 * Body: { assigneeId, name, standardText?, photoSlots?: string[], priority?, dueAt?, blocksCheckout?, categoryId? }
 */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const body = await request.json();
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    const id = await createAdhocTask(sb, body || {}, actorId);
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks/adhoc');
  }
}
