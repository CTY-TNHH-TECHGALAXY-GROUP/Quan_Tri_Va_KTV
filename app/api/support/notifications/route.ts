import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireStaffOrPermission } from '@/lib/auth-server';
import { taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Unread task notifications of one employee — that employee or a support admin. */
export async function GET(request: Request) {
  try {
    const employeeId = new URL(request.url).searchParams.get('employeeId');
    if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
    const denied = await requireStaffOrPermission(employeeId, 'support_tasks_admin');
    if (denied) return denied;
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { data, error } = await sb
      .from('TaskNotifications')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: any) {
    return taskErrorResponse(err, '/api/support/notifications GET');
  }
}

/**
 * Mark notifications as read. Body: { employeeId, notificationIds: string[] }.
 * Only rows that belong to employeeId are touched (replaces the client-side UPDATE removed with RLS).
 */
export async function POST(request: Request) {
  try {
    const { employeeId, notificationIds } = (await request.json()) || {};
    if (!employeeId || !Array.isArray(notificationIds) || !notificationIds.length) {
      return NextResponse.json({ error: 'employeeId and notificationIds are required' }, { status: 400 });
    }
    const denied = await requireStaffOrPermission(employeeId, 'support_tasks_admin');
    if (denied) return denied;
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { error } = await sb.from('TaskNotifications').update({ is_read: true }).in('id', notificationIds).eq('employee_id', employeeId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return taskErrorResponse(err, '/api/support/notifications POST');
  }
}
