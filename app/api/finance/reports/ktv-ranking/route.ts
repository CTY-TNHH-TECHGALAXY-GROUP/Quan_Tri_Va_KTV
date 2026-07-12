import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Không thể kết nối DB' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ success: false, error: 'Thiếu tham số ngày' }, { status: 400 });
    }

    // 1. Fetch Staff (KTV list)
    const { data: staffList, error: staffErr } = await supabaseAdmin
      .from('Staff')
      .select('id, full_name, position')
      .eq('status', 'ĐANG LÀM')
      .ilike('id', 'NH%')
      .order('id');
      
    if (staffErr) throw staffErr;

    // 2. Fetch Configs for Commission Realtime
    const { KtvCommissionService } = require('@/lib/services/KtvCommissionService');
    const commConfig = await KtvCommissionService.getCommissionConfig(supabaseAdmin);

    // 3. Fetch Bookings (for Revenue and Orders) - Giống hệt báo cáo Tổng Quan
    const KTV_RANKING_STATUSES = ['PREPARING', 'IN_PROGRESS', 'CLEANING', 'DONE', 'COMPLETED', 'FEEDBACK'];
    const { data: allRankedBookings, error: bookErr } = await supabaseAdmin
      .from('Bookings')
      .select('id, totalAmount, technicianCode, source, status')
      .in('status', KTV_RANKING_STATUSES)
      .gte('bookingDate', `${dateFrom} 00:00:00`)
      .lte('bookingDate', `${dateTo} 23:59:59`);
    if (bookErr) throw bookErr;

    // 3b. Lấy thêm Completed Bookings (Cho các đơn có nguồn đặc biệt nhưng chưa cập nhật trạng thái chuẩn)
    const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'FEEDBACK'];
    const PAID_SOURCES = ['VIP_WALK_IN', 'STANDARD_WALK_IN', 'MIXED_WALK_IN', 'VIP_MENU', 'STANDARD_MENU'];
    const { data: allBookings, error: bErr2 } = await supabaseAdmin
      .from('Bookings')
      .select('id, status, source')
      .gte('bookingDate', `${dateFrom} 00:00:00`)
      .lte('bookingDate', `${dateTo} 23:59:59`)
      .neq('status', 'CANCELLED');
    if (bErr2) throw bErr2;
    const completedBookings = (allBookings || []).filter(b => COMPLETED_STATUSES.includes(b.status) || PAID_SOURCES.includes(b.source));

    const allRankedBookingIds = (allRankedBookings || []).map(b => b.id);
    const completedBookingIds = completedBookings.map(b => b.id);
    const uniqueIdsToFetch = [...new Set([...allRankedBookingIds, ...completedBookingIds])];

    // 4. Fetch BookingItems (for Realtime Tua & VIP)
    let bookingItems: any[] = [];
    if (uniqueIdsToFetch.length > 0) {
      const { data: bItems, error: itemErr } = await supabaseAdmin
        .from('BookingItems')
        .select('id, bookingId, serviceId, technicianCodes, price, quantity, status, timeStart, segments, tip, Bookings!fk_bookingitems_booking(source)')
        .in('bookingId', uniqueIdsToFetch);
      if (itemErr) throw itemErr;
      bookingItems = bItems || [];
    }

    // 4.5. Fetch Services để lấy số phút (duration) chuẩn xác và category (VIP)
    const serviceIds = [...new Set(bookingItems.map(i => i.serviceId).filter(Boolean))];
    const svcDurationMap: Record<string, number> = {};
    const svcCategoryMap: Record<string, string> = {};
    if (serviceIds.length > 0) {
        const { data: svcs } = await supabaseAdmin
            .from('Services')
            .select('id, code, duration, category')
            .in('id', serviceIds);
        (svcs || []).forEach((s: any) => {
            const dur = Number(s.duration) || 60;
            const cat = String(s.category || '').toUpperCase();
            if (s.id) {
                svcDurationMap[String(s.id)] = dur;
                svcCategoryMap[String(s.id)] = cat;
            }
            if (s.code) {
                svcDurationMap[String(s.code)] = dur;
                svcCategoryMap[String(s.code)] = cat;
            }
        });

        // Fallback by code (Trong BookingItems serviceId có thể là code)
        const unresolvedIds = serviceIds.filter(sid => !svcDurationMap[String(sid)]);
        if (unresolvedIds.length > 0) {
            const { data: svcsByCode } = await supabaseAdmin
                .from('Services')
                .select('id, code, duration, category')
                .in('code', unresolvedIds);
            (svcsByCode || []).forEach((s: any) => {
                const dur = Number(s.duration) || 60;
                const cat = String(s.category || '').toUpperCase();
                if (s.id) {
                    svcDurationMap[String(s.id)] = dur;
                    svcCategoryMap[String(s.id)] = cat;
                }
                if (s.code) {
                    svcDurationMap[String(s.code)] = dur;
                    svcCategoryMap[String(s.code)] = cat;
                }
            });
        }
    }

    // 5. Fetch Attendance (Working Days)
    const { data: attendanceData, error: attErr } = await supabaseAdmin
      .from('KTVAttendance')
      .select('employeeId, date')
      .in('status', ['CONFIRMED', 'PENDING'])
      .in('checkType', ['CHECK_IN', 'LATE_CHECKIN'])
      .gte('date', dateFrom)
      .lte('date', dateTo);
    if (attErr) throw attErr;

    // 6. Fetch Leave Days
    const { data: leaveData, error: leaveErr } = await supabaseAdmin
      .from('KTVLeaveRequests')
      .select('employeeId, date')
      .eq('status', 'APPROVED')
      .gte('date', dateFrom)
      .lte('date', dateTo);
    if (leaveErr) throw leaveErr;

    // 7. Fetch TurnLedger for Turns count (Requested vs Free)
    const { data: turnData, error: turnErr } = await supabaseAdmin
      .from('TurnLedger')
      .select('employee_id, source')
      .gte('date', dateFrom)
      .lte('date', dateTo);
    if (turnErr) throw turnErr;

    // 8. Fetch KTVDailyLedger for Bonus Points
    const { data: bonusData, error: bonusErr } = await supabaseAdmin
      .from('KTVDailyLedger')
      .select('staff_id, total_bonus')
      .gte('date', dateFrom)
      .lte('date', dateTo);
    if (bonusErr) throw bonusErr;

    // Aggregate Data initialization
    const rankingMap: Record<string, any> = {};
    staffList.forEach(s => {
      rankingMap[s.id] = {
        id: s.id, name: s.full_name || s.id,
        revenue: 0, tuaMoney: 0, bonus: 0,
        workingDays: 0, leaveDays: 0, freeTurns: 0, requestedTurns: 0, vipTurns: 0, avgWorkingHours: 0
      };
    });

    // A. Aggregate Revenue
    allRankedBookings.forEach(b => {
      if (!b.technicianCode) return;
      const codes = b.technicianCode.split(',').map((c: string) => c.trim()).filter(Boolean);
      const share = codes.length > 0 ? (Number(b.totalAmount) || 0) / codes.length : 0;
      
      codes.forEach((code: string) => {
        if (rankingMap[code]) {
          rankingMap[code].revenue += share;
        }
      });
    });

    // B. Aggregate Realtime Commission (Tua) & VIP Turns
    const vipBookingIdsByKtv: Record<string, Set<string>> = {};
    
    bookingItems.forEach(item => {
      let ktvs = Array.isArray(item.technicianCodes) ? item.technicianCodes : [];
      // @ts-ignore
      const rawSource = (item.Bookings?.source || '').toUpperCase();
      const itemCategory = svcCategoryMap[String(item.serviceId)] || '';
      const isVip = rawSource === 'VIP_MENU' || rawSource === 'VIP_WALK_IN' || rawSource === 'VIP_BOOKING' || itemCategory.includes('VIP') || itemCategory.includes('PREMIUM');

      if (ktvs.length > 0) {
        const qty = Number(item.quantity) || 1;
        ktvs.forEach((kId: any) => {
           const code = String(kId).trim();
           if (!code) return;
           
           if (rankingMap[code]) {
               // Đếm VIP Turns: Gom nhóm theo BookingId để 1 Bill chỉ tính 1 lượt VIP
               if (isVip) {
                   if (!vipBookingIdsByKtv[code]) vipBookingIdsByKtv[code] = new Set();
                   vipBookingIdsByKtv[code].add(item.bookingId || item.id);
               }
               
               // Tính tiền tua theo số phút đúng chuẩn
               let fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
               let myTotalMins = KtvCommissionService.calculateItemDuration(item, code, fallbackDuration);
               if (myTotalMins === 0) myTotalMins = fallbackDuration / ktvs.length;
               
               const perKtvCommission = KtvCommissionService.calcCommission(myTotalMins, commConfig.milestones, commConfig.ratePer60) * qty;
               rankingMap[code].tuaMoney += perKtvCommission;
           }
        });
      }
    });

    // Cập nhật Điểm Bonus
    bonusData?.forEach(b => {
      const code = b.staff_id;
      if (rankingMap[code]) {
         rankingMap[code].bonus += Number(b.total_bonus) || 0;
      }
    });

    // Cập nhật VIP Turns
    Object.keys(vipBookingIdsByKtv).forEach(code => {
        if (rankingMap[code]) {
            rankingMap[code].vipTurns = vipBookingIdsByKtv[code].size;
        }
    });

    // C. Aggregate Turns (Requested vs Free)
    turnData.forEach(t => {
      if (rankingMap[t.employee_id]) {
        if (t.source && t.source.includes('REQUEST')) {
          rankingMap[t.employee_id].requestedTurns += 1;
        } else {
          rankingMap[t.employee_id].freeTurns += 1;
        }
      }
    });

    // D. Aggregate Working Days (Unique dates)
    const workingSet: Record<string, Set<string>> = {};
    attendanceData.forEach(a => {
      if (!workingSet[a.employeeId]) workingSet[a.employeeId] = new Set();
      workingSet[a.employeeId].add(a.date);
    });
    Object.keys(workingSet).forEach(kId => {
      if (rankingMap[kId]) {
        rankingMap[kId].workingDays = workingSet[kId].size;
      }
    });

    // Aggregate Leave Days
    const leaveSet: Record<string, Set<string>> = {};
    leaveData.forEach(l => {
      if (!leaveSet[l.employeeId]) leaveSet[l.employeeId] = new Set();
      leaveSet[l.employeeId].add(l.date);
    });
    Object.keys(leaveSet).forEach(kId => {
      if (rankingMap[kId]) {
        rankingMap[kId].leaveDays = leaveSet[kId].size;
      }
    });

    // Final calculations
    const finalData = Object.values(rankingMap).map(ktv => {
      const wDays = ktv.workingDays > 0 ? ktv.workingDays : 1; // Prevent div by 0
      // 100k = 1 hour
      const totalTuaHours = ktv.tuaMoney / 100000;
      ktv.avgWorkingHours = ktv.workingDays > 0 ? parseFloat((totalTuaHours / wDays).toFixed(2)) : 0;
      return ktv;
    }).filter(ktv => ktv.revenue > 0 || ktv.tuaMoney > 0 || ktv.workingDays > 0 || ktv.leaveDays > 0); // Only show active ktvs

    return NextResponse.json({ success: true, data: finalData });
  } catch (error: any) {
    console.error('KTV Ranking API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
