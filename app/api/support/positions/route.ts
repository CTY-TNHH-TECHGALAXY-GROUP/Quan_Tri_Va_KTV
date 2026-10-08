import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { listOfficeOptions, listPositions, savePosition } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Positions with their accept policies (admin-configured), members and template sets, plus pickers. */
export async function GET() {
  try {
    await requirePermission('support_tasks_admin');
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const [data, options] = await Promise.all([listPositions(sb), listOfficeOptions(sb)]);
    return NextResponse.json({ success: true, data, ...options });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/positions GET');
  }
}

/**
 * Create (no id) or update (id) a position.
 * Body: { id?, name, branch?, shift_start?, shift_end?, fixed_accept_policy?, adhoc_accept_policy?,
 *         is_active?, memberIds?: string[], setIds?: string[] }
 * Policy values: MANDATORY | ACCEPT_REQUIRED | ACCEPT_OR_DECLINE. A change applies to tasks assigned afterwards.
 */
async function save(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    const id = await savePosition(sb, await request.json(), actorId);
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/positions save');
  }
}

export const POST = save;
export const PATCH = save;
