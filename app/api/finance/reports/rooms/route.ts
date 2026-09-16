import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { FinanceReportService } from '@/lib/services/FinanceReportService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const lang = searchParams.get('lang') || 'all';

    if (!dateFrom || !dateTo) {
        return NextResponse.json({ success: false, error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });

    try {
        const { completedBookings, items, svcMap } = await FinanceReportService.getBaseData(supabase, dateFrom, dateTo, lang);
        
        // Tạo một Map để gom nhóm dữ liệu theo tên phòng
        const roomStatsMap: Record<string, {
            roomName: string;
            totalServices: number;
            serviceDetails: Record<string, number>;
        }> = {};

        // Tạo danh sách ID của các Bookings hợp lệ (đã hoàn thành)
        const validBookingIds = new Set(completedBookings.map((b: any) => b.id));

        items.forEach(item => {
            // Chỉ lấy các items thuộc booking đã hoàn thành
            if (!validBookingIds.has(item.bookingId)) return;

            const rName = item.roomName ? item.roomName.trim() : 'Phòng Khác (Không rõ)';
            if (!rName) return;

            // Khởi tạo nếu chưa có
            if (!roomStatsMap[rName]) {
                roomStatsMap[rName] = {
                    roomName: rName,
                    totalServices: 0,
                    serviceDetails: {}
                };
            }

            // Tên dịch vụ
            const svcInfo = svcMap[String(item.serviceId)];
            const serviceName = svcInfo ? svcInfo.name : String(item.serviceId);
            const qty = Number(item.quantity) || 1;

            roomStatsMap[rName].totalServices += qty;
            
            if (!roomStatsMap[rName].serviceDetails[serviceName]) {
                roomStatsMap[rName].serviceDetails[serviceName] = 0;
            }
            roomStatsMap[rName].serviceDetails[serviceName] += qty;
        });

        // Format lại dữ liệu thành mảng cho Frontend dễ dùng
        const roomsData = Object.values(roomStatsMap).map(room => {
            const services = Object.entries(room.serviceDetails)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count); // Xếp dịch vụ làm nhiều nhất lên trên

            return {
                roomName: room.roomName,
                totalServices: room.totalServices,
                services
            };
        }).sort((a, b) => b.totalServices - a.totalServices); // Xếp phòng dùng nhiều nhất lên trên

        return NextResponse.json({ success: true, data: roomsData });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ success: false, error: 'Failed to fetch rooms analysis data' }, { status: 500 });
    }
}
