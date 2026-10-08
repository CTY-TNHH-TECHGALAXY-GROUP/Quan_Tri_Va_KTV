import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission, authErrorResponse } from '@/lib/auth-server';
import { validateImageUpload } from '@/lib/upload-guard';

export const dynamic = 'force-dynamic';

/**
 * Supervisor's "photo of the mistake" when returning a task, or (kind=ref) a sample photo for a
 * template photo slot. Support admin only (was unauthenticated).
 */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const formData = await request.formData();
    const file = formData.get('file');
    const folder = formData.get('kind') === 'ref' ? 'refs' : 'reviews';
    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    const checked = await validateImageUpload(file);
    if (!checked.ok) {
      return NextResponse.json({ success: false, error: checked.error }, { status: checked.status });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase not initialized');

    // File name never comes from the client — extension follows the sniffed MIME type.
    const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${checked.ext}`;
    const { error: uploadError, data } = await supabase.storage
      .from('task-photos')
      .upload(fileName, checked.buffer, { contentType: checked.mime, cacheControl: '3600', upsert: false });

    if (uploadError) {
      console.error('API Error uploading review photo:', uploadError);
      return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 });
    }
    const { data: pub } = supabase.storage.from('task-photos').getPublicUrl(data.path);
    return NextResponse.json({ success: true, path: data.path, url: pub.publicUrl });
  } catch (error: any) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    console.error('API Error /api/support/tasks/rework-photo POST:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
