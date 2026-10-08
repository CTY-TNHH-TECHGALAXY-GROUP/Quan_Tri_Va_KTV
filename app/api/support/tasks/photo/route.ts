import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireStaffOrPermission } from '@/lib/auth-server';
import { loadTask, supersedePhoto } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/**
 * Staff removes a photo before review. Replaces the old client-side delete
 * (storage + TaskPhotos row): the photo is only marked superseded and stays as history.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const photoId = searchParams.get('id');
    if (!photoId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });

    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { data: photo } = await sb.from('TaskPhotos').select('task_id').eq('id', photoId).maybeSingle();
    if (!photo) return NextResponse.json({ success: false, error: 'Không tìm thấy ảnh.' }, { status: 404 });

    const task = await loadTask(sb, photo.task_id);
    const denied = await requireStaffOrPermission(task.assignee_id || '', 'support_tasks_admin');
    if (denied) return denied;

    const { actorId } = await sessionActor();
    await supersedePhoto(sb, photoId, actorId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks/photo DELETE');
  }
}
