import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { taskId } = await request.json();

    if (!taskId) {
      return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
    }

    // 1. Fetch existing photos for the task
    const { data: photos, error: fetchErr } = await supabase
      .from('TaskPhotos')
      .select('id, storage_path')
      .eq('task_id', taskId);

    if (fetchErr) {
      console.error('Error fetching photos to delete:', fetchErr.message);
      return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
    }

    if (photos && photos.length > 0) {
      // 2. Delete from Storage
      const pathsToDelete = photos.map(p => p.storage_path);
      const { error: storageErr } = await supabase.storage
        .from('task-photos')
        .remove(pathsToDelete);

      if (storageErr) {
        console.error('Error deleting from storage:', storageErr.message);
      }

      // 3. Delete from Database
      const { error: dbErr } = await supabase
        .from('TaskPhotos')
        .delete()
        .in('id', photos.map(p => p.id));

      if (dbErr) {
        console.error('Error deleting from DB:', dbErr.message);
        return NextResponse.json({ success: false, error: dbErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API Error /api/support/tasks/rework:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
