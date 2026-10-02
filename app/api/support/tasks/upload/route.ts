import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireStaffOrPermission, authErrorResponse } from '@/lib/auth-server';
import { validateImageUpload } from '@/lib/upload-guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const taskId = formData.get('taskId');
    const employeeId = formData.get('employeeId');

    if (!file || typeof taskId !== 'string' || !taskId || typeof employeeId !== 'string' || !employeeId) {
      return NextResponse.json({ success: false, error: 'Missing file, taskId or employeeId' }, { status: 400 });
    }

    // Chỉ chính nhân viên đó (hoặc người quản lý task) được nộp ảnh nhân danh employeeId.
    const denied = await requireStaffOrPermission(employeeId, 'support_tasks_admin');
    if (denied) return denied;

    const checked = await validateImageUpload(file);
    if (!checked.ok) {
      return NextResponse.json({ success: false, error: checked.error }, { status: checked.status });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
    }

    // 1. Upload file to storage using service role (bypasses RLS).
    //    Tên file không lấy từ client — đuôi theo MIME đã kiểm magic bytes.
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `tasks/${safeTaskId}/${Date.now()}.${checked.ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('task-photos')
      .upload(fileName, checked.buffer, {
        contentType: checked.mime,
        upsert: false,
      });

    if (uploadErr) {
      console.error('Storage upload error:', uploadErr.message);
      return NextResponse.json({ success: false, error: uploadErr.message }, { status: 500 });
    }

    // 2. Insert record into TaskPhotos table
    const { error: insertErr } = await supabase
      .from('TaskPhotos')
      .insert({
        task_id: taskId,
        uploaded_by: employeeId,
        storage_path: fileName,
        is_submitted: true,
        review_round: 0,
      });

    if (insertErr) {
      console.error('TaskPhotos insert error:', insertErr.message);
      // Clean up uploaded file if DB insert fails
      await supabase.storage.from('task-photos').remove([fileName]);
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, storagePath: fileName });
  } catch (error: any) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    console.error('API Error /api/support/tasks/upload:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
