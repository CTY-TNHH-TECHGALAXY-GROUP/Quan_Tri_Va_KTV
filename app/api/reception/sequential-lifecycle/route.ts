import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { performSequentialLifecycle } from '@/lib/services/SequentialLifecycleService';

const schema = z.object({
  bookingId: z.string().min(1), itemId: z.string().min(1), expectedRevision: z.number().int().nonnegative(),
  action: z.enum(['PAUSE', 'RESUME', 'FINISH', 'CANCEL', 'SWAP']),
  targetSlots: z.array(z.number().int().min(1).max(2)).min(1).max(2).optional(),
  newKtvId: z.string().min(1).optional(), assignedMins: z.number().int().min(0).max(600).optional(),
  extraTimeMins: z.number().int().min(0).max(600).optional(), reason: z.string().max(500).optional(),
  cancelCredit: z.enum(['NONE', 'WORKED']).optional(),
});
export async function POST(req: Request) {
  try {
    await requirePermission('dispatch_board');
    const input = schema.parse(await req.json());
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase chưa cấu hình.');
    const data = await performSequentialLifecycle(supabase, input.itemId, input, input.expectedRevision, input.bookingId);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Không lưu được thao tác.' }, { status: error instanceof z.ZodError ? 400 : error.message === 'Forbidden' ? 403 : error.message === 'Unauthorized' ? 401 : 409 });
  }
}
