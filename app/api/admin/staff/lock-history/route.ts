import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { listLockEvents, type LockFilter } from '@/lib/services/StaffLockHistoryService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/staff/lock-history — lock / unlock timeline of every staff
 * account, newest first.
 *
 *   ?filter=ALL|LOCK|UNLOCK   (default ALL)
 *   ?q=<name or staff code>
 *   ?before=<cursor from the previous page's nextBefore>
 *   ?limit=<1..100>           (default 30)
 *
 * Read only. Same permission as the "Chấm điểm KTV" page that shows it.
 */
export async function GET(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const sp = new URL(request.url).searchParams;
        const result = await listLockEvents(supabase, {
            filter: sp.get('filter') as LockFilter | null,
            q: sp.get('q'),
            before: sp.get('before'),
            limit: Number(sp.get('limit')) || undefined,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi lấy lịch sử khoá tài khoản:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
