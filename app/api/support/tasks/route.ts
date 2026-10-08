import { NextResponse } from 'next/server';
import { EmployeeTasksService, getCheckoutBlockers, type CheckoutBlockers } from '@/lib/services/employeeTasks.service';
import { requirePermission, requireStaffOrPermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  acceptTask, declineTask, setEvidenceValues, blockTask, unblockTask, trySubmit, cancelTask, loadTask,
} from '@/lib/services/officeTaskActions.service';
import { sessionActor, taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Today's tasks (+ carry-over) of one employee. Only that employee or a support admin. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const empIds = EmployeeTasksService.pickStaffId([searchParams.get('employeeId') || '', searchParams.get('userCode') || '']);
    if (empIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing employeeId or userCode' }, { status: 400 });
    }
    const [staffId, ...aliases] = empIds;
    const denied = await requireStaffOrPermission(staffId, 'support_tasks_admin');
    if (denied) return denied;

    const includeRoomTasks = searchParams.get('includeRoomTasks') !== 'false';
    await EmployeeTasksService.ensureTasksForDate(staffId, undefined, includeRoomTasks, aliases);
    const { data } = await EmployeeTasksService.fetchTasks(empIds, includeRoomTasks);

    // Checkout picture from the same gate attendance uses (read-only: tasks were just ensured).
    const sb = getSupabaseAdmin();
    let checkout: CheckoutBlockers | null = null;
    if (sb) {
      const { data: staffRow } = await sb.from('Staff').select('work_type').eq('id', staffId).maybeSingle();
      if (staffRow?.work_type) checkout = await getCheckoutBlockers(sb, staffId, staffRow.work_type, { ensure: false });
    }
    return NextResponse.json({ success: true, data, checkout });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks GET');
  }
}

/**
 * Staff actions on their own task. The task's assignee is the identity that must match
 * the session — the request body is never trusted for "who".
 *   ACCEPT · DECLINE{reason} · EVIDENCE{values} · BLOCK{reasonCode,note} · UNBLOCK · COMPLETE (= submit check)
 * START is kept as a no-op for the old client.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, taskId } = body || {};
    if (!action || !taskId) {
      return NextResponse.json({ success: false, error: 'Missing action or taskId' }, { status: 400 });
    }
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');

    const task = await loadTask(sb, taskId);
    const denied = await requireStaffOrPermission(task.assignee_id || '', 'support_tasks_admin');
    if (denied) return denied;
    const { actorId } = await sessionActor();

    switch (action) {
      case 'START':
        return NextResponse.json({ success: true });
      case 'ACCEPT':
        await acceptTask(sb, taskId, actorId);
        return NextResponse.json({ success: true });
      case 'DECLINE':
        await declineTask(sb, taskId, actorId, body.reason);
        return NextResponse.json({ success: true });
      case 'EVIDENCE':
        return NextResponse.json({ success: true, ...(await setEvidenceValues(sb, taskId, actorId, body.values || {})) });
      case 'BLOCK':
        await blockTask(sb, taskId, actorId, body.reasonCode, body.note);
        return NextResponse.json({ success: true });
      case 'UNBLOCK':
        return NextResponse.json({ success: true, ...(await unblockTask(sb, taskId, actorId)) });
      case 'COMPLETE': {
        const res = await trySubmit(sb, taskId, actorId);
        if (!res.submitted && res.missing.length) {
          return NextResponse.json({ success: false, error: `Còn thiếu: ${res.missing.join(', ')}`, missing: res.missing }, { status: 409 });
        }
        return NextResponse.json({ success: true, ...res });
      }
      default:
        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks POST');
  }
}

/** Soft-cancel (never hard-delete) — support admin only. Kept on DELETE for the existing admin UI. */
export async function DELETE(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');
    if (!taskId) return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const { actorId } = await sessionActor();
    await cancelTask(sb, taskId, actorId, searchParams.get('reason') || 'Quản lý xoá việc');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/tasks DELETE');
  }
}
