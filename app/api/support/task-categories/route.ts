import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { saveCategoryWithTemplates } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** "Kho việc": save a category with its templates. Body: CategoryTemplatesInput. */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    const result = await saveCategoryWithTemplates(sb, (await request.json()) || {}, actorId);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/task-categories');
  }
}
