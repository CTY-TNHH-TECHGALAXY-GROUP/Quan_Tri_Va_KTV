import { NextResponse } from 'next/server';
import { RoomStatsService } from '@/lib/room-stats.service';

export async function GET(request: Request) {
  try {
    const stats = await RoomStatsService.getDailyRoomStats();
    return NextResponse.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[GET /api/support/room-stats] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Lỗi lấy thống kê phòng' },
      { status: 500 }
    );
  }
}
