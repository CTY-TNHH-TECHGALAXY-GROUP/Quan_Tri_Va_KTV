import { NextResponse } from 'next/server';
import { RoomStatsService } from '@/lib/room-stats.service';
import { requirePermission, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/** Room usage today for the support admin dashboard — support admin only (was open). */
export async function GET() {
  try {
    await requirePermission('support_tasks_admin');
    const stats = await RoomStatsService.getDailyRoomStats();
    return NextResponse.json({ success: true, data: stats });
  } catch (error: any) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    console.error('[GET /api/support/room-stats] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Lỗi lấy thống kê phòng' },
      { status: 500 }
    );
  }
}
