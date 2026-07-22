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
      .select('id, totalAmount, technicianCode, source, status, bookingDate')
      .in('status', KTV_RANKING_STATUSES)
      .gte('bookingDate', `${dateFrom} 00:00:00`)
      .lte('bookingDate', `${dateTo} 23:59:59`);
    if (bookErr) throw bookErr;

    // 3b. Lấy thêm Completed Bookings (Cho các đơn có nguồn đặc biệt nhưng chưa cập nhật trạng thái chuẩn)
    const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'FEEDBACK'];
    const PAID_SOURCES = ['VIP_WALK_IN', 'STANDARD_WALK_IN', 'MIXED_WALK_IN', 'VIP_MENU', 'STANDARD_MENU'];
    const { data: allBookings, error: bErr2 } = await supabaseAdmin
      .from('Bookings')
      .select('id, status, source, bookingDate')
      .gte('bookingDate', `${dateFrom} 00:00:00`)
      .lte('bookingDate', `${dateTo} 23:59:59`)
      .neq('status', 'CANCELLED');
    if (bErr2) throw bErr2;
    const completedBookings = (allBookings || []).filter(b => COMPLETED_STATUSES.includes(b.status) || PAID_SOURCES.includes(b.source));

    const allRankedBookingIds = (allRankedBookings || []).map(b => b.id);
    const completedBookingIds = completedBookings.map(b => b.id);
    const uniqueIdsToFetch = [...new Set([...allRankedBookingIds, ...completedBookingIds])];

    // 4. Fetch BookingItems (for Realtime Tua & VIP) - Chia chunk để tránh lỗi URL too long (fetch failed)
    const bookingDateMap: Record<string, string> = {};
    (allRankedBookings || []).forEach(b => {
      if (b.bookingDate) bookingDateMap[b.id] = b.bookingDate.split(' ')[0];
      if (b.bookingDate && b.bookingDate.includes('T')) bookingDateMap[b.id] = b.bookingDate.split('T')[0];
    });
    (allBookings || []).forEach(b => {
      if (b.bookingDate) bookingDateMap[b.id] = b.bookingDate.split(' ')[0];
      if (b.bookingDate && b.bookingDate.includes('T')) bookingDateMap[b.id] = b.bookingDate.split('T')[0];
    });

    let bookingItems: any[] = [];
    if (uniqueIdsToFetch.length > 0) {
      const CHUNK_SIZE = 300;
      for (let i = 0; i < uniqueIdsToFetch.length; i += CHUNK_SIZE) {
        const chunk = uniqueIdsToFetch.slice(i, i + CHUNK_SIZE);
        const { data: bItems, error: itemErr } = await supabaseAdmin
          .from('BookingItems')
          .select('id, bookingId, serviceId, technicianCodes, price, quantity, status, timeStart, segments, tip, itemRating, ktvRatings, Bookings!fk_bookingitems_booking(source)')
          .in('bookingId', chunk);
        if (itemErr) throw itemErr;
        if (bItems) bookingItems.push(...bItems);
      }
    }

    // 4.5. Fetch Services để lấy số phút (duration) chuẩn xác và category (VIP)
    const serviceIds = [...new Set(bookingItems.map(i => i.serviceId).filter(Boolean))];
    const svcDurationMap: Record<string, number> = {};
    const svcCategoryMap: Record<string, string> = {};
    if (serviceIds.length > 0) {
        const CHUNK_SIZE = 300;
        let svcs: any[] = [];
        for (let i = 0; i < serviceIds.length; i += CHUNK_SIZE) {
            const chunk = serviceIds.slice(i, i + CHUNK_SIZE);
            const { data: sData } = await supabaseAdmin
                .from('Services')
                .select('id, code, duration, category')
                .in('id', chunk);
            if (sData) svcs.push(...sData);
        }
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
            let svcsByCode: any[] = [];
            for (let i = 0; i < unresolvedIds.length; i += CHUNK_SIZE) {
                const chunk = unresolvedIds.slice(i, i + CHUNK_SIZE);
                const { data: sData } = await supabaseAdmin
                    .from('Services')
                    .select('id, code, duration, category')
                    .in('code', chunk);
                if (sData) svcsByCode.push(...sData);
            }
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

    // 7.5 Fetch Laundry Adjustments from WalletAdjustments (Để biết tiền giặt đồ thực tế đã trừ)
    let adjQuery = supabaseAdmin.from('WalletAdjustments').select('staff_id, amount, reason');
    if (dateFrom) adjQuery = adjQuery.gte('created_at', `${dateFrom}T00:00:00+07:00`);
    if (dateTo) adjQuery = adjQuery.lte('created_at', `${dateTo}T23:59:59+07:00`);
    const { data: laundryAdjustments } = await adjQuery;

    const laundryDeductionMap: Record<string, number> = {};
    (laundryAdjustments || []).forEach(a => {
        if ((a.reason || '').toLowerCase().includes('giặt đồ')) {
            if (!laundryDeductionMap[a.staff_id]) laundryDeductionMap[a.staff_id] = 0;
            laundryDeductionMap[a.staff_id] += Math.abs(Number(a.amount));
        }
    });

    // 8. Fetch KTVDailyLedger for Tiền Tua, Tiền Tip, Bonus
    const { data: ledgerData, error: ledgerErr } = await supabaseAdmin
      .from('KTVDailyLedger')
      .select('date, staff_id, total_commission, total_tip, total_bonus')
      .gte('date', dateFrom)
      .lte('date', dateTo);
    if (ledgerErr) throw ledgerErr;

    const ledgerDaysByKtv: Record<string, Set<string>> = {};
    const ledgerMaxDateByKtv: Record<string, string> = {};
    const ledgerBonusMap: Record<string, number> = {};
    const ledgerCommMap: Record<string, number> = {};
    const ledgerTipMap: Record<string, number> = {};

    ledgerData?.forEach(l => {
        const code = l.staff_id;
        if (!ledgerDaysByKtv[code]) ledgerDaysByKtv[code] = new Set();
        ledgerDaysByKtv[code].add(l.date);
        
        if (!ledgerMaxDateByKtv[code] || l.date > ledgerMaxDateByKtv[code]) {
            ledgerMaxDateByKtv[code] = l.date;
        }

        if (!ledgerBonusMap[code]) ledgerBonusMap[code] = 0;
        if (!ledgerCommMap[code]) ledgerCommMap[code] = 0;
        if (!ledgerTipMap[code]) ledgerTipMap[code] = 0;

        ledgerBonusMap[code] += Number(l.total_bonus) || 0;
        ledgerCommMap[code] += Number(l.total_commission) || 0;
        ledgerTipMap[code] += Number(l.total_tip) || 0;
    });

    // Cập nhật bookingDate, bookingSource, bookingStatus cho items
    bookingItems.forEach((item: any) => {
        item.bookingDate = bookingDateMap[item.bookingId] || (item.timeStart ? item.timeStart.split('T')[0] : '');
        item.bookingSource = item.Bookings?.source;
        item.bookingStatus = item.Bookings?.status;
    });

    // A. Khởi tạo & Cộng Tiền từ Ledger
    const ktvInfoMap: Record<string, any> = {};
    staffList.forEach(s => { ktvInfoMap[s.id] = { name: s.full_name }; });
    const ktvs = Object.keys(ktvInfoMap);
    const rankingMap: Record<string, any> = {};
    
    ktvs.forEach(id => {
      rankingMap[id] = {
        id: id,
        name: ktvInfoMap[id] ? ktvInfoMap[id].name : id,
        revenue: 0, 
        tuaMoney: ledgerCommMap[id] || 0,
        bonus: ledgerBonusMap[id] || 0,
        totalTip: ledgerTipMap[id] || 0,
        workingDays: 0, leaveDays: 0, freeTurns: 0, requestedTurns: 0, vipTurns: 0, totalWorkingMins: 0,
        sumRating: 0, ratingCount: 0, avgRating: 0,
        uniqueBookings: new Set()
      };
    });

    // B. Aggregate Revenue & Realtime Tip
    (allRankedBookings || []).forEach(b => {
      if (!b.technicianCode) return;
      const codes = b.technicianCode.split(',').map((c: string) => c.trim()).filter(Boolean);
      const share = codes.length > 0 ? (Number(b.totalAmount) || 0) / codes.length : 0;
      
      codes.forEach((code: string) => {
        if (rankingMap[code]) {
          rankingMap[code].revenue += share;

          // Đếm số đơn (chỉ đếm 1 lần cho mỗi booking)
          if (!rankingMap[code].uniqueBookings.has(b.id)) {
             rankingMap[code].orders += 1;
             rankingMap[code].uniqueBookings.add(b.id);
          }
        }
      });
    });

    // C. Aggregate Realtime Commission (Tua) & VIP Turns & Tip
    const vipBookingIdsByKtv: Record<string, Set<string>> = {};
    
    bookingItems.forEach(item => {
      let ktvs = Array.isArray(item.technicianCodes) ? item.technicianCodes : [];
      const rawSource = (item.bookingSource || '').toUpperCase();
      const itemCategory = svcCategoryMap[String(item.serviceId)] || '';
      const isVip = rawSource === 'VIP_MENU' || rawSource === 'VIP_WALK_IN' || rawSource === 'VIP_BOOKING' || itemCategory.includes('VIP') || itemCategory.includes('PREMIUM');

      if (ktvs.length > 0) {
        const qty = Number(item.quantity) || 1;
        const tipAmount = Number(item.tip) || 0;
        const tipPerKtv = tipAmount / ktvs.length;
        const bDate = item.bookingDate || '';
        
        ktvs.forEach((kId: any) => {
           const code = String(kId).trim();
           if (!code) return;
           
               if (rankingMap[code]) {
               // Đếm VIP Turns
               if (isVip) {
                   if (!vipBookingIdsByKtv[code]) vipBookingIdsByKtv[code] = new Set();
                   vipBookingIdsByKtv[code].add(item.bookingId || item.id);
               }
               
               const validStatuses = ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'];
               const isValidStatus = validStatuses.includes(item.status) || validStatuses.includes(item.bookingStatus);
               
               // Tính Rating (Chỉ tính khi đơn đã hoàn tất hoặc có rating)
               if (isValidStatus) {
                   let myRating = Number(item.itemRating) || 0;
                   if (item.ktvRatings && typeof item.ktvRatings === 'object' && item.ktvRatings[code]) {
                       myRating = Number(item.ktvRatings[code]);
                   }
                   if (myRating > 0) {
                       rankingMap[code].sumRating += myRating;
                       rankingMap[code].ratingCount += 1;
                   }
               }
               
               // Đồng bộ chuẩn xác với cơ chế của VÍ KTV:
               // 1. Chỉ cộng Realtime cho những ngày NẰM SAU maxDateStr của Ledger (bỏ qua những ngày cũ bị rỗng Ledger)
               // 2. Chỉ tính tiền khi status của đơn đã xong
               let shouldCountRealtime = false;
               if (ledgerMaxDateByKtv[code]) {
                   if (bDate > ledgerMaxDateByKtv[code]) shouldCountRealtime = true;
               } else {
                   shouldCountRealtime = true; // Không có Ledger, tất cả là Realtime
               }
               
               // Tính tiền tua & Tip Realtime
               if (shouldCountRealtime && isValidStatus) {
                   rankingMap[code].totalTip += tipPerKtv;

                   let fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
                   let myTotalMins = KtvCommissionService.calculateItemDuration(item, code, fallbackDuration);
                   if (myTotalMins === 0) myTotalMins = fallbackDuration / ktvs.length;
                   
                   const perKtvCommission = KtvCommissionService.calcCommission(myTotalMins, commConfig.milestones, commConfig.ratePer60) * qty;
                   rankingMap[code].tuaMoney += perKtvCommission;
               }
           }
        });
      }
    });

    // Cập nhật VIP Turns
    Object.keys(vipBookingIdsByKtv).forEach(code => {
        if (rankingMap[code]) {
            rankingMap[code].vipTurns = vipBookingIdsByKtv[code].size;
        }
    });

    // C. Aggregate Turns (Requested vs Free)
    (turnData || []).forEach(t => {
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
    (attendanceData || []).forEach(a => {
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
    (leaveData || []).forEach(l => {
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
      
      const totalLaundryDeduction = laundryDeductionMap[ktv.id] || 0;
      ktv.tuaMoney = ktv.tuaMoney - totalLaundryDeduction;
      if (ktv.tuaMoney < 0) ktv.tuaMoney = 0; // Tránh tiền tua bị âm
      
      // Tính điểm trung bình
      ktv.avgRating = ktv.ratingCount > 0 ? parseFloat((ktv.sumRating / ktv.ratingCount).toFixed(1)) : 0;
      
      // 100k = 1 hour
      const totalTuaHours = ktv.tuaMoney / 100000;
      ktv.avgWorkingHours = ktv.workingDays > 0 ? parseFloat((totalTuaHours / wDays).toFixed(2)) : 0;
      return ktv;
    }).filter(ktv => ktv.revenue > 0 || ktv.tuaMoney > 0 || ktv.workingDays > 0 || ktv.leaveDays > 0); // Only show active ktvs

    return NextResponse.json({ success: true, data: finalData });
  } catch (error: any) {
    console.error('KTV Ranking API Error:', error);
    require('fs').writeFileSync('ktv_error_log.txt', error.stack || error.message);
    return NextResponse.json({ success: false, error: error.stack || error.message }, { status: 500 });
  }
}
