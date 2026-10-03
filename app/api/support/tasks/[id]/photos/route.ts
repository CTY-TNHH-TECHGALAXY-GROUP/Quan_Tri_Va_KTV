import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const employeeId = formData.get('employeeId') as string;

    if (!file) {
      return NextResponse.json({ success: false, message: 'Không tìm thấy file ảnh' }, { status: 400 });
    }

    const supabase = await createClient();

    // 1. Upload to Supabase Storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${taskId}_${Date.now()}.${fileExt}`;
    const storagePath = `support_tasks/${taskId}/${fileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('task_photos')
      .upload(storagePath, file);

    if (uploadError) {
       console.error('[POST /api/support/tasks/.../photos] Storage upload error:', uploadError.message);
       throw new Error('Lỗi tải ảnh lên hệ thống Storage');
    }

    // Lấy URL Public (hoặc có thể xử lý ký url sau)
    const { data: publicUrlData } = supabase.storage
      .from('task_photos')
      .getPublicUrl(storagePath);

    // 2. Insert record into TaskPhotos as Draft (is_submitted = false)
    const { data: photoRecord, error: insertError } = await supabase
      .from('TaskPhotos')
      .insert({
        task_id: taskId,
        uploaded_by: employeeId || null,
        storage_path: storagePath,
        is_submitted: false,
        review_round: 0
      })
      .select()
      .single();

    if (insertError) {
       console.error('[POST /api/support/tasks/.../photos] Insert DB error:', insertError.message);
       throw new Error('Lỗi lưu thông tin ảnh vào CSDL');
    }

    return NextResponse.json({ 
      success: true, 
      data: {
        id: photoRecord.id,
        url: publicUrlData.publicUrl,
        is_submitted: false
      }
    });

  } catch (error: any) {
    console.error('[POST /api/support/tasks/[id]/photos] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Lỗi server khi upload ảnh' },
      { status: 500 }
    );
  }
}
