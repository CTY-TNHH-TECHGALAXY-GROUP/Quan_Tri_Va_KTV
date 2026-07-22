import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { FinanceReportService } from '@/lib/services/FinanceReportService';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

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
        const { completedBookings, items, svcMap, commConfig } = await FinanceReportService.getBaseData(supabase, dateFrom, dateTo, lang);
        
        const rawDataSheet: any[] = [];
        completedBookings.forEach((b: any) => {
            const bItems = items.filter(i => i.bookingId === b.id);
            const timeInfo = FinanceReportService.getVnDateInfo(b.createdAt || b.bookingDate || '');
            
            if (bItems.length === 0) {
                rawDataSheet.push({
                    id: b.billCode || b.id.substring(0, 8),
                    dateStr: timeInfo ? `${timeInfo.dateStr.split('-')[2]}/${timeInfo.dateStr.split('-')[1]}` : (b.bookingDate || '').substring(5, 10).replace('-', '/'),
                    lang: b.customerLang || 'VN',
                    statusInfo: 'KHÔNG',
                    source: b.source || 'Walk-in',
                    roomName: '',
                    paymentMethod: b.paymentMethod || 'Tiền mặt',
                    duration: 0,
                    serviceName: b.source === 'VIP_MENU' ? 'Gói Menu VIP' : 'Dịch vụ khác',
                    ktv: b.technicianCode || '',
                    startTime: timeInfo ? `${timeInfo.hour.toString().padStart(2, '0')}:00` : '',
                    endTime: '',
                    revenue: Number(b.totalAmount) || 0,
                    tip: Number(b.tip) || 0,
                    commission: 0,
                    statusText: b.status === 'CANCELLED' ? 'FALSE' : 'TRUE'
                });
            } else {
                bItems.forEach(i => {
                    const svcInfo = svcMap[String(i.serviceId)];
                    const name = svcInfo ? svcInfo.name : String(i.serviceId);
                    const dur = svcInfo ? svcInfo.duration : 60;
                    
                    let startTime = '';
                    let endTime = '';
                    if (b.createdAt || b.bookingDate) {
                        const startDate = new Date(b.createdAt || b.bookingDate);
                        startTime = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`;
                        const endDate = new Date(startDate.getTime() + dur * 60000);
                        endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
                    }
                    
                    let ktvs = Array.isArray(i.technicianCodes) ? i.technicianCodes.join(', ') : '';
                    let commission = 0;
                    if (Array.isArray(i.technicianCodes) && i.technicianCodes.length > 0) {
                        const myTotalMins = KtvCommissionService.calculateItemDuration(i, i.technicianCodes[0], dur) || (dur / i.technicianCodes.length);
                        commission = KtvCommissionService.calcCommission(myTotalMins, commConfig.milestones, commConfig.ratePer60) * (Number(i.quantity) || 1) * i.technicianCodes.length;
                    }

                    rawDataSheet.push({
                        id: b.billCode || b.id.substring(0, 8),
                        dateStr: timeInfo ? `${timeInfo.dateStr.split('-')[2]}/${timeInfo.dateStr.split('-')[1]}` : (b.bookingDate || '').substring(5, 10).replace('-', '/'),
                        lang: b.customerLang || 'VN',
                        statusInfo: 'KHÔNG',
                        source: b.source || 'Walk-in',
                        roomName: i.roomName || '',
                        paymentMethod: b.paymentMethod || 'Tiền mặt',
                        duration: dur,
                        serviceName: name,
                        ktv: ktvs || '',
                        startTime,
                        endTime,
                        revenue: Number(i.price) || 0,
                        tip: Number(i.tip) || 0,
                        commission,
                        statusText: b.status === 'CANCELLED' ? 'FALSE' : 'TRUE'
                    });
                });
            }
        });

        return NextResponse.json({ success: true, rawDataSheet });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ success: false, error: 'Failed to fetch raw data' }, { status: 500 });
    }
}
