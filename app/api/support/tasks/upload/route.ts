import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireStaffOrPermission } from '@/lib/auth-server';
import { validateImageUpload } from '@/lib/upload-guard';
import { assertCanUploadPhoto, onPhotoUploaded } from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../../_lib/taskRoute';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const taskId = formData.get('taskId');
    const employeeId = formData.get('employeeId');
    const slotRaw = formData.get('slotIndex');
    const slotIndex = typeof slotRaw === 'string' && slotRaw !== '' ? Number(slotRaw) : null;

    if (!file || typeof taskId !== 'string' || !taskId || typeof employeeId !== 'string' || !employeeId) {
      return NextResponse.json({ success: false, error: 'Missing file, taskId or employeeId' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
    }

    // The task's assignee must be the session user (or a support admin) — not whatever the form claims.
    const task = await assertCanUploadPhoto(supabase, taskId, slotIndex);
    const denied = await requireStaffOrPermission(task.assignee_id || employeeId, 'support_tasks_admin');
    if (denied) return denied;

    const checked = await validateImageUpload(file);
    if (!checked.ok) {
      return NextResponse.json({ success: false, error: checked.error }, { status: checked.status });
    }

    // 1. Upload with service role. File name never comes from the client.
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `tasks/${safeTaskId}/${Date.now()}${slotIndex !== null ? `_s${slotIndex}` : ''}.${checked.ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('task-photos')
      .upload(fileName, checked.buffer, { contentType: checked.mime, upsert: false });
    if (uploadErr) {
      console.error('Storage upload error:', uploadErr.message);
      return NextResponse.json({ success: false, error: uploadErr.message }, { status: 500 });
    }

    // 2. Photo row. uploaded_by → Staff(id): use the assignee's staff code.
    const { data: photo, error: insertErr } = await supabase
      .from('TaskPhotos')
      .insert({
        task_id: taskId,
        uploaded_by: task.assignee_id || null,
        storage_path: fileName,
        is_submitted: true,
        review_round: task.current_review_round || 0,
        slot_index: slotIndex,
      })
      .select('id')
      .single();
    if (insertErr) {
      console.error('TaskPhotos insert error:', insertErr.message);
      await supabase.storage.from('task-photos').remove([fileName]);
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
    }

    // 3. Older photo of the same slot becomes history; submit automatically once complete.
    const { actorId } = await sessionActor();
    const result = await onPhotoUploaded(supabase, task, photo.id, slotIndex, actorId || task.assignee_id);
    return NextResponse.json({ success: true, storagePath: fileName, photoId: photo.id, ...result });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks/upload');
  }
}
