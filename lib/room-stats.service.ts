import { createClient } from '@/lib/supabase/server';
import { Database } from '@/supabase_types';

type SupabaseClient = ReturnType<typeof createClient>;

export class RoomStatsService {
  /**
   * Lấy thống kê số lượt phục vụ của các phòng trong ngày hiện tại.
   * Để Hậu cần/Quản lý biết phòng nào cần dọn dẹp hoặc châm thêm vật tư.
   */
  static async getDailyRoomStats() {
    const supabase = await createClient();
    
    // Lấy ngày hiện tại (có thể cấu hình múi giờ ở đây)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Query số lượng dịch vụ đã hoàn thành (COMPLETED/DONE)
    // từ bảng BookingItems, join với Services để lấy tên
    const { data: items, error } = await supabase
      .from('BookingItems')
      .select(`
        id, 
        roomName, 
        status, 
        timeEnd,
        Services (nameVN)
      `)
      .in('status', ['COMPLETED', 'DONE'])
      .gte('timeEnd', today.toISOString());

    if (error) {
      console.error('[RoomStatsService.getDailyRoomStats] Error querying BookingItems:', error.message);
      throw new Error('Lỗi khi lấy dữ liệu thống kê phòng.');
    }

    // Xử lý dữ liệu (Group by roomName)
    // Trả về định dạng: 
    // { 
    //   "VIP 1": { total: 89, services: { "Phòng riêng": 36, "Kết hợp": 12, ... } },
    //   "Tầng trệt": { total: 123, services: { "Ấn huyệt": 88, ... } }
    // }
    const stats: Record<string, { total: number, services: Record<string, number> }> = {};

    for (const item of items) {
      const room = item.roomName || 'Chưa xếp phòng';
      const serviceName = (Array.isArray(item.Services) ? item.Services[0]?.nameVN : (item.Services as any)?.nameVN) || 'Dịch vụ khác';

      if (!stats[room]) {
        stats[room] = { total: 0, services: {} };
      }

      stats[room].total += 1;
      
      if (!stats[room].services[serviceName]) {
        stats[room].services[serviceName] = 0;
      }
      stats[room].services[serviceName] += 1;
    }

    return stats;
  }
}
