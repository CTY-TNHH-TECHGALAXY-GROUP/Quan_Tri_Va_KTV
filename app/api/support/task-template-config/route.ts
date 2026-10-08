import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { getTemplateConfig, saveTemplateConfig } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Detail config of one TaskTemplates row (photo slots + sample photos, evidence fields, time mode, flags). */
export async function GET(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    return NextResponse.json({ success: true, data: await getTemplateConfig(sb, id) });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/task-template-config GET');
  }
}

/** Body: { id, ...TemplateConfigInput }. Applies to tasks generated after the save. */
export async function PATCH(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { id, ...input } = (await request.json()) || {};
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    await saveTemplateConfig(sb, id, input, actorId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/task-template-config PATCH');
  }
}
