import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { grantCheckoutOverride } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Supervisor lets a staff member check out today despite unreviewed tasks. Body: { staffId, reason } */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { staffId, reason } = await request.json();
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    await grantCheckoutOverride(sb, staffId, reason, actorId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/checkout-override');
  }
}
