import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * Legacy endpoint called by the old admin review UI after "Yêu cầu làm lại".
 * Office P0: photos are NO LONGER deleted (evidence + round history) — they are only
 * marked superseded so the employee starts the round with empty slots.
 * New code uses POST /api/support/tasks/review, which does this itself. Remove with the old UI (step 7).
 */
export async function POST(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { taskId } = await request.json();
    if (!taskId) {
      return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
    }
    const { error } = await supabase
      .from('TaskPhotos')
      .update({ superseded_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .is('superseded_at', null);
    if (error) {
      console.error('Error superseding photos:', error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    console.error('API Error /api/support/tasks/rework:', error.message);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
