import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { listTemplateSets, saveTemplateSet } from '@/lib/services/officeTaskActions.service';
import { taskErrorResponse } from '../_lib/taskRoute';

export const dynamic = 'force-dynamic';

/** Template = a set of task categories, attached to positions. */
export async function GET() {
  try {
    await requirePermission('support_tasks_admin');
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    return NextResponse.json({ success: true, data: await listTemplateSets(sb) });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/template-sets GET');
  }
}

/** Body: { id?, name, description?, is_active?, categoryIds?: string[] } */
async function save(request: Request) {
  try {
    await requirePermission('support_tasks_admin');
    const sb = getSupabaseAdmin();
    if (!sb) throw new Error('Supabase not initialized');
    const id = await saveTemplateSet(sb, await request.json());
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return taskErrorResponse(error, '/api/support/template-sets save');
  }
}

export const POST = save;
export const PATCH = save;
