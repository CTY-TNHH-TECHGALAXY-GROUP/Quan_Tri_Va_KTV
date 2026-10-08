import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCronAuth } from '@/lib/cron-auth';
import { EmployeeTasksService } from '@/lib/services/employeeTasks.service';
import { getVnDateStr } from '@/lib/time.logic';

export const dynamic = 'force-dynamic';

/**
 * CRON: generate today's checklist for everyone who has one.
 * Schedule (Vercel Cron): "5 17 * * *" (UTC) = 00:05 Vietnam time.
 *
 * Safety net only — tasks are also generated at check-in, on page load and right before the
 * checkout gate, all idempotent through Tasks.dedupe_key. Runs on the production deployment,
 * so it only takes effect after this branch is merged to main.
 */
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const today = getVnDateStr();

    // Position members (Staff.id) + owners of personal routines (Users.id → Users.code).
    const { data: members } = await sb.from('OfficePositionMembers').select('staff_id').eq('is_active', true);
    const { data: routines } = await sb.from('EmployeeRoutines').select('employee_id').eq('is_active', true).eq('mode', 'ADD');
    const userIds = Array.from(new Set((routines || []).map((r: any) => r.employee_id)));
    const { data: users } = userIds.length ? await sb.from('Users').select('id, code').in('id', userIds) : { data: [] };

    const targets = new Map<string, Set<string>>();   // staffId → alias Users.ids
    (members || []).forEach((m: any) => targets.set(m.staff_id, targets.get(m.staff_id) || new Set()));
    (users || []).forEach((u: any) => {
      const staffId = u.code || u.id;
      const aliases = targets.get(staffId) || new Set<string>();
      if (u.id !== staffId) aliases.add(u.id);
      targets.set(staffId, aliases);
    });

    const report: { staffId: string; count?: number; reason?: string; error?: string }[] = [];
    let first = true;
    for (const [staffId, aliases] of targets) {
      try {
        // Shared room tasks only need to be generated once per run.
        const res = await EmployeeTasksService.ensureTasksForDate(staffId, today, first, Array.from(aliases));
        report.push({ staffId, count: res.count, reason: (res as any).reason });
      } catch (e: any) {
        report.push({ staffId, error: e?.message || String(e) });
      }
      first = false;
    }
    return NextResponse.json({ success: true, date: today, staff: report.length, report });
  } catch (error: any) {
    console.error('[cron/generate-tasks]', error?.message || error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
