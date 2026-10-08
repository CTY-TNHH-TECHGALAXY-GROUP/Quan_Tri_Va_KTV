import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { getReviewQueue, unblockTask } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Supervisor "Cần tôi xử lý": waiting for review, blocked, declined, and per-person checkout picture. */
export async function GET() {
  try {
    await requirePermission('support_tasks_admin');
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    return NextResponse.json({ success: true, ...(await getReviewQueue(sb)) });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/review-queue GET');
  }
}

/** Resolve a "Báo vướng": { taskId, waiveToday?: boolean } — waive = no longer blocks checkout today. */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { taskId, waiveToday } = await request.json();
    if (!taskId) return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    return NextResponse.json({ success: true, ...(await unblockTask(sb, taskId, actorId, !!waiveToday)) });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/review-queue POST');
  }
}
