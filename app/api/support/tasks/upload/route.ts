import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const taskId = formData.get('taskId') as string;
    const employeeId = formData.get('employeeId') as string;

    if (!file || !taskId || !employeeId) {
      return NextResponse.json({ success: false, error: 'Missing file, taskId or employeeId' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
    }

    // 1. Upload file to storage using service role (bypasses RLS)
    const fileName = `tasks/${taskId}/${Date.now()}_${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await supabase.storage
      .from('task-photos')
      .upload(fileName, buffer, {
        contentType: file.type,
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
    console.error('API Error /api/support/tasks/upload:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
