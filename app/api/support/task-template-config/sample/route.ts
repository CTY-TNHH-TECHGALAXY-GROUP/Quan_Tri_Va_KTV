import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { setSlotSample, setSlotSampleFromPhoto } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/**
 * Set the sample of one template slot (supervisor; both sides then see it).
 * Body: { photoId }  — use a submitted photo, or
 *       { templateId, slot, refPath } — a photo uploaded with rework-photo kind=ref (refs/…).
 */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { photoId, templateId, slot, refPath } = (await request.json()) || {};
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    const result = photoId
      ? await setSlotSampleFromPhoto(sb, photoId, actorId)
      : await setSlotSample(sb, templateId, Number(slot), refPath, actorId);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/task-template-config/sample');
  }
}
