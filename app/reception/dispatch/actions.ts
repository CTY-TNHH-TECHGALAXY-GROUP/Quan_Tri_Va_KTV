'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { sendPushNotification } from '@/lib/push-helper';
import { createNotification } from '@/lib/notification-helper';
import { BookingModificationService } from '@/lib/services/BookingModificationService';
import { recalculateEstimatedEndTime } from '@/lib/time-helper';



export async function getDispatchData(date: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 1. Fetch Staff (Only KTVs based on Users role)
        const { data: techUsers, error: tuError } = await supabase.from('Users').select('code').eq('role', 'TECHNICIAN');
        if (tuError) throw tuError;
        const techCodes = new Set((techUsers || []).map(u => u.code));

        const { data: allStaffs, error: sError } = await supabase.from('Staff').select('id, full_name, avatar_url, gender, status, skills, phone, position, experience');
        if (sError) throw sError;
        
        const staffs = (allStaffs || []).filter(s => techCodes.has(s.id));

        // 🔧 EGRESS FIX: Only select needed columns for TurnQueue
        const { data: turns, error: tError } = await supabase
            .from('TurnQueue')
            .select('id, employee_id, date, check_in_order, queue_position, status, turns_completed, current_order_id, booking_item_id, booking_item_ids, room_id, bed_id, start_time, estimated_end_time')
            .eq('date', date)
            .order('turns_completed', { ascending: true })
            .order('queue_position', { ascending: true });
        if (tError) throw tError;

        // 3. Fetch Bookings for selected date
        // bookingDate is "timestamp without time zone"
        const startOfDay = `${date} 00:00:00`;
        const endOfDay = `${date} 23:59:59`;

        // 🔧 EGRESS FIX: Only select needed columns for Bookings
        const { data: bData, error: bError } = await supabase
            .from('Bookings')
            .select('id, billCode, customerId, customerName, customerLang, customerPhone, customerEmail, timeBooking, bookingDate, createdAt, updatedAt, status, totalAmount, paymentMethod, technicianCode, bedId, roomName, notes, accessToken, rating, feedbackNote, focusAreaNote, timeStart, timeEnd, source')
            .in('source', ['STANDARD_WALK_IN', 'VIP_WALK_IN', 'STANDARD_MENU', 'VIP_MENU', 'MIXED_WALK_IN'])
            .gte('bookingDate', startOfDay)
            .lte('bookingDate', endOfDay)
            .neq('status', 'CANCELLED')
            .order('createdAt', { ascending: true });

        if (bError) throw bError;

        let bookings: any[] = bData || [];

        // Fetch VAT info from Customers
        const customerIds = Array.from(new Set(bookings.map(b => b.customerId).filter(Boolean)));
        const { data: customersData } = await supabase
            .from('Customers')
            .select('id, taxCode')
            .in('id', customerIds);
        const taxCodeMap = Object.fromEntries((customersData || []).map(c => [c.id, c.taxCode]));

        bookings = bookings.map(b => ({
            ...b,
            hasVat: !!taxCodeMap[b.customerId]
        }));

        // 4. Fetch Services FIRST to build map (safer than complex filtering)
        const { data: allServices, error: svcError } = await supabase
            .from('Services')
            .select('id, code, nameVN, nameEN, duration, description, category, priceVND, imageUrl, is_utility')
            .limit(1000);

        if (svcError) {
            console.error('❌ [Server] Error fetching Services:', svcError.message);
        }
        console.log(`📡 [Server] Fetched: ${allServices?.length || 0} services for mapping`);

        let servicesMap: Record<string, { name: string; duration: number; description: string; is_utility: boolean }> = {};
        if (allServices) {
            allServices.forEach((s: any) => {
                const info = {
                    name: (typeof s.nameVN === 'object' && s.nameVN !== null) ? (s.nameVN.vn || s.nameVN.en || s.nameVN) : (s.nameVN || s.nameEN || `Dịch vụ ${s.code || s.id}`),
                    duration: s.duration ?? 60,
                    description: (typeof s.description === 'object' && s.description !== null) 
                        ? (s.description.vn || s.description.en || '') 
                        : (s.description || ''),
                    is_utility: s.is_utility ?? false,  // ✅ is_utility từ DB
                    category: s.category
                };
                
                // Trình dọn dẹp cuối cùng: Đảm bảo không còn object nào lọt vào UI
                if (typeof info.name === 'object') info.name = String(info.name);
                if (typeof info.description === 'object') info.description = String(info.description);
                if (s.id) servicesMap[String(s.id).trim().toLowerCase()] = info;
                if (s.code) servicesMap[String(s.code).trim().toLowerCase()] = info;
            });
        }
        console.log(`📡 [Server] servicesMap has nhs0002: ${!!servicesMap['nhs0002']}`);

        // 5. Fetch BookingItems separately
        if (bookings.length > 0) {
            const bookingIds = bookings.map(b => b.id);
            const { data: items, error: iError } = await supabase
                .from('BookingItems')
                .select('*, segments')
                .in('bookingId', bookingIds);

            if (iError) {
                console.error('❌ [Server] Error fetching BookingItems:', iError.message);
            }

            // Attach BookingItems (with service info) to each booking
            bookings = bookings.map(b => ({
                ...b,
                BookingItems: (items || [])
                    .filter(i => i.bookingId === b.id)
                    .sort((a, b) => {
                        const orderA = a.options?.order;
                        const orderB = b.options?.order;
                        
                        // Ưu tiên sắp xếp theo order trong options nếu có
                        if (typeof orderA === 'number' && typeof orderB === 'number') {
                            if (orderA !== orderB) return orderA - orderB;
                        } else if (typeof orderA === 'number') {
                            return -1;
                        } else if (typeof orderB === 'number') {
                            return 1;
                        }

                        // Nếu không có, dùng logic cũ
                        const matchA = a.id.match(/-item(\d+)$/);
                        const matchB = b.id.match(/-item(\d+)$/);
                        
                        if (matchA && matchB) {
                            return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
                        } else if (matchA && !matchB) {
                            return 1; // a is add-on, b is original -> a comes after b
                        } else if (!matchA && matchB) {
                            return -1; // a is original, b is add-on -> a comes before b
                        }
                        
                        // Both are original items, fallback to localeCompare
                        return a.id.localeCompare(b.id);
                    })
                    .map(i => {
                        const sId = String(i.serviceId || '').trim().toLowerCase();
                        const svcInfo = servicesMap[sId];
                        
                        // Ưu tiên duration từ database nếu có
                        let finalDuration = svcInfo?.duration !== undefined ? svcInfo.duration : 0;
                        if (sId.toLowerCase().includes('nhs0000')) {
                            finalDuration = 1;
                        } else if (!svcInfo) {
                            // Mặc định cho những dịch vụ không tìm thấy trong DB (có thể là lỗi data cũ)
                            finalDuration = 60; 
                            console.warn(`⚠️ [Dispatch] Service lookup failed for sId: "${sId}". Defaulting to 60p.`);
                        }

                        // 🔥 VIP FIX: Lấy vipDuration/duration nếu có trong options
                        let parsedOptions: any = {};
                        try {
                            parsedOptions = typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {});
                        } catch(e) {}

                        if (parsedOptions?.vipDuration) {
                            finalDuration = Number(parsedOptions.vipDuration);
                        } else if (parsedOptions?.duration) {
                            finalDuration = Number(parsedOptions.duration);
                        }

                        return {
                            ...i,
                            options: parsedOptions,
                            service_name: parsedOptions?.displayName || svcInfo?.name || `DV ${sId.toUpperCase()}`,
                            serviceName: parsedOptions?.displayName || svcInfo?.name || `DV ${sId.toUpperCase()}`, // Thêm camelCase cho đồng bộ
                            service_description: (b.source === 'VIP_MENU' || parsedOptions?.vipDuration || parsedOptions?.selectedSkills) ? '' : (svcInfo?.description || ''),
                            duration: finalDuration,
                            is_utility: svcInfo?.is_utility ?? (sId === 'nhs0900'), // ✅ is_utility, fallback legacy
                            timeStart: i.timeStart || null,
                            timeEnd: i.timeEnd || null,
                            status: i.status || 'NEW',
                        };
                    })
            }));
        }

        console.log(`📡 [Server] Fetched: ${bookings.length} bookings for ${date}`);
        bookings.forEach(b => {
            const totalDur = (b.BookingItems || []).reduce((acc: number, i: any) => acc + (i.duration || 0), 0);
            console.log(`  📋 ${b.billCode}: ${(b.BookingItems || []).length} services, Total Dur: ${totalDur}p`);
            if (b.BookingItems && b.BookingItems.length > 0) {
              console.log(`     - First Item: ${b.BookingItems[0].service_name}, dur=${b.BookingItems[0].duration}`);
            }
        });

        // 6. Fetch Rooms, Beds, and Reminders — 🔧 EGRESS FIX: select specific columns
        const { data: rooms } = await supabase.from('Rooms').select('id, name, capacity, type, default_reminders');
        const { data: beds } = await supabase.from('Beds').select('id, name, roomId');
        const { data: reminders } = await supabase.from('Reminders').select('id, content, order_index, is_active').eq('is_active', true).order('order_index', { ascending: true });
        const { data: configs } = await supabase.from('SystemConfigs').select('key, value');

        const transitionConfig = configs?.find((c: any) => c.key === 'room_transition_time' || c.key === 'thoi_gian_doi_phong');
        const roomTransitionTime = transitionConfig ? (parseInt(transitionConfig.value, 10) || 1) : 1;

        return {
            success: true,
            data: {
                staffs,
                turns,
                bookings,
                rooms: rooms || [],
                beds: beds || [],
                reminders: reminders || [],
                allServices: allServices || [],
                roomTransitionTime
            },
            // Gửi kèm log nếu có lỗi svc query
            _debugSvcCount: bookings.length > 0 ? bookings[0].BookingItems?.length : 0
        };
    } catch (error: any) {
        console.error('❌ [Server] getDispatchData error:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

export async function processDispatch(bookingId: string, dispatchData: {
    status: string;
    technicianCode?: string | null;
    bedId?: string | null;
    roomName?: string | null;
    staffAssignments: any[];
    date: string;
    notes?: string;
    itemUpdates?: { 
        id: string, 
        roomName?: string | null, 
        bedId?: string | null, 
        technicianCodes?: string[] | string | null, 
        status?: string,
        segments?: any[],
        options: any 
    }[];
}) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 🔥 PRE-PROCESSOR: Chống ghi đè mất thời gian đã chạy (Stale Data Overwrite)
        if (dispatchData.itemUpdates && dispatchData.itemUpdates.length > 0) {
            const { data: currentItems } = await supabase.from('BookingItems').select('id, segments, status, technicianCodes').eq('bookingId', bookingId);
            if (currentItems) {
                dispatchData.itemUpdates = dispatchData.itemUpdates.map(updateItem => {
                    const dbItem = currentItems.find(i => i.id === updateItem.id);
                    if (!dbItem) return updateItem;
                    
                    // 1. NGĂN LÙI TRẠNG THÁI CA ĐANG LÀM / ĐÃ XONG
                    if (updateItem.status && dbItem.status) {
                        const STATUS_WEIGHT: Record<string, number> = { 'NEW': 0, 'WAITING': 1, 'PREPARING': 2, 'READY': 3, 'IN_PROGRESS': 4, 'CLEANING': 5, 'FEEDBACK': 6, 'DONE': 7 };
                        const dbWeight = STATUS_WEIGHT[dbItem.status] || 0;
                        let incomingWeight = STATUS_WEIGHT[updateItem.status] || 0;
                        
                        // 2. ÉP TRẠNG THÁI VỀ WAITING NẾU CHƯA CÓ KTV NHƯNG LẠI BỊ GÁN PREPARING
                        if (updateItem.status === 'PREPARING') {
                            const hasKtv = (updateItem.technicianCodes && updateItem.technicianCodes.length > 0) || (dbItem.technicianCodes && dbItem.technicianCodes.length > 0);
                            if (!hasKtv && dbWeight < 2) {
                                // Nếu chưa gán KTV và ở DB đang là NEW/WAITING -> Giữ nguyên WAITING
                                updateItem.status = 'WAITING';
                                incomingWeight = STATUS_WEIGHT[updateItem.status];
                            }
                        }

                        // Nếu DB đang ở trạng thái lớn hơn, không cho phép lùi
                        if (dbWeight > incomingWeight) {
                            updateItem.status = dbItem.status;
                        }
                    }

                    let dbSegs: any[] = [];
                    try { dbSegs = typeof dbItem.segments === 'string' ? JSON.parse(dbItem.segments) : (dbItem.segments || []); } catch {}
                    
                    if (updateItem.segments && Array.isArray(updateItem.segments)) {
                        updateItem.segments = updateItem.segments.map(incomingSeg => {
                            const dbSeg = dbSegs.find((s: any) => s.ktvId === incomingSeg.ktvId);
                            if (dbSeg) {
                                // Trộn lại các mốc thời gian thực tế từ DB để không bị xóa mất
                                return {
                                    ...incomingSeg,
                                    actualStartTime: dbSeg.actualStartTime || incomingSeg.actualStartTime,
                                    actualEndTime: dbSeg.actualEndTime || incomingSeg.actualEndTime,
                                    feedbackTime: dbSeg.feedbackTime || incomingSeg.feedbackTime,
                                    reviewTime: dbSeg.reviewTime || incomingSeg.reviewTime
                                };
                            }
                            return incomingSeg;
                        });
                    }
                    return updateItem;
                });
            }
        }
        
        // 🚀 BẢO VỆ TRẠNG THÁI BOOKING: Nếu DB đang ở trạng thái cao hơn, không cho lùi
        const { data: currentBooking } = await supabase.from('Bookings').select('status').eq('id', bookingId).single();
        if (currentBooking && currentBooking.status && dispatchData.status) {
            const STATUS_WEIGHT: Record<string, number> = { 'NEW': 0, 'WAITING': 1, 'PREPARING': 2, 'READY': 3, 'IN_PROGRESS': 4, 'CLEANING': 5, 'FEEDBACK': 6, 'DONE': 7 };
            const dbWeight = STATUS_WEIGHT[currentBooking.status] || 0;
            const incomingWeight = STATUS_WEIGHT[dispatchData.status] || 0;
            if (dbWeight > incomingWeight) {
                dispatchData.status = currentBooking.status;
            }
        }

        // GỌI RPC MỚI ĐỂ THỰC THI TOÀN BỘ TRANSACTION
        const { data, error } = await supabase.rpc('dispatch_confirm_booking', {
            p_booking_id: bookingId,
            p_date: dispatchData.date,
            p_status: dispatchData.status || 'PREPARING',
            p_technician_code: dispatchData.technicianCode ?? null,
            p_bed_id: dispatchData.bedId ?? null,
            p_room_name: dispatchData.roomName ?? null,
            p_notes: dispatchData.notes ?? null,
            p_staff_assignments: dispatchData.staffAssignments || [],
            p_item_updates: dispatchData.itemUpdates || []
        });

        if (error) {
            console.error('❌ [Server] RPC dispatch_confirm_booking error:', error);
            throw error;
        }

        if (data && !data.success) {
            console.error('❌ [Server] RPC failed internally:', data.error);
            throw new Error(data.error || 'Lỗi khi lưu dữ liệu điều phối');
        }

        // 4. Send background push and realtime notification to KTVs
        if (dispatchData.staffAssignments && dispatchData.staffAssignments.length > 0) {
            // Lấy thông tin hiện tại của các item để so sánh, tránh spam thông báo
            const { data: existingItems } = await supabase.from('BookingItems').select('id, segments').eq('bookingId', bookingId);
            const oldKtvIds = new Set<string>();
            (existingItems || []).forEach(item => {
                let segs = [];
                try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
                segs.forEach((s: any) => { if (s.ktvId) oldKtvIds.add(s.ktvId); });
            });

            const staffIds = dispatchData.staffAssignments.map(a => a.ktvId).filter(Boolean);
            const uniqueStaffIds = Array.from(new Set(staffIds));
            
            for (const staffId of uniqueStaffIds) {
                // CHỈ gửi thông báo nếu là KTV mới hoặc đơn đang ở trạng thái chuyển đổi từ Pending
                const isNewKtv = !oldKtvIds.has(staffId);
                const isDispatchAction = dispatchData.status !== 'pending';
                
                if (!isNewKtv && !isDispatchAction) continue;

                let svcName = 'dịch vụ mới';
                let svcTime = '';
                
                const ktvItem = dispatchData.itemUpdates?.find((i: any) => 
                    i.technicianCodes && (Array.isArray(i.technicianCodes) ? i.technicianCodes.includes(staffId) : i.technicianCodes === staffId)
                );
                
                if (ktvItem) {
                    svcName = ktvItem.options?.displayName || 'dịch vụ mới';
                    const ktvSeg = ktvItem.segments?.find((s: any) => s.ktvId === staffId);
                    if (ktvSeg && ktvSeg.startTime) {
                        svcTime = ` lúc ${ktvSeg.startTime}`;
                    } else if (ktvItem.segments && ktvItem.segments.length > 0 && ktvItem.segments[0].startTime) {
                        svcTime = ` lúc ${ktvItem.segments[0].startTime}`;
                    }
                }

                const message = `Bạn được phân công: ${svcName}${svcTime}. Vui lòng kiểm tra ứng dụng.`;

                // 🗑️ Dọn dẹp thông báo sơ sài tự động do trigger tạo ra để tránh trùng lặp tin nhắn và phát âm thanh
                await supabase.from('StaffNotifications')
                    .delete()
                    .eq('bookingId', bookingId)
                    .eq('employeeId', staffId)
                    .eq('type', 'KTV_NEW_ORDER')
                    .eq('isRead', false);

                // Gửi thông báo chi tiết cho KTV với loại KTV_NEW_ORDER để vượt qua bộ lọc client
                await createNotification({
                    bookingId: bookingId,
                    employeeId: String(staffId),
                    type: 'KTV_NEW_ORDER',
                    message: message,
                });
            }
        }

        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(dispatchData.date);

        // 🔄 ĐỒNG BỘ TIMELINE SÂU XUỐNG DB (OPTION B)
        // Removed destructive syncOrderTimelineToDb

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function saveDraftDispatch(bookingId: string, dispatchData: {
    technicianCode: string | null;
    bedId: string | null;
    roomName: string | null;
    notes?: string;
    itemUpdates?: { 
        id: string, 
        roomName?: string | null, 
        bedId?: string | null, 
        technicianCodes?: string[] | string | null, 
        segments?: any[],
        status?: string,
        options: any 
    }[];
}) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 🔥 PRE-PROCESSOR: Chống ghi đè mất thời gian đã chạy (Stale Data Overwrite)
        if (dispatchData.itemUpdates && dispatchData.itemUpdates.length > 0) {
            const { data: currentItems } = await supabase.from('BookingItems').select('id, segments, status, technicianCodes').eq('bookingId', bookingId);
            if (currentItems) {
                dispatchData.itemUpdates = dispatchData.itemUpdates.map(updateItem => {
                    const dbItem = currentItems.find(i => i.id === updateItem.id);
                    if (!dbItem) return updateItem;
                    
                    // 1. NGĂN LÙI TRẠNG THÁI CA ĐANG LÀM / ĐÃ XONG
                    if (updateItem.status && dbItem.status) {
                        const STATUS_WEIGHT: Record<string, number> = { 'NEW': 0, 'WAITING': 1, 'PREPARING': 2, 'READY': 3, 'IN_PROGRESS': 4, 'CLEANING': 5, 'FEEDBACK': 6, 'DONE': 7 };
                        const dbWeight = STATUS_WEIGHT[dbItem.status] || 0;
                        let incomingWeight = STATUS_WEIGHT[updateItem.status] || 0;
                        
                        // 2. ÉP TRẠNG THÁI VỀ WAITING NẾU CHƯA CÓ KTV NHƯNG LẠI BỊ GÁN PREPARING
                        if (updateItem.status === 'PREPARING') {
                            const hasKtv = (updateItem.technicianCodes && updateItem.technicianCodes.length > 0) || (dbItem.technicianCodes && dbItem.technicianCodes.length > 0);
                            if (!hasKtv && dbWeight < 2) {
                                updateItem.status = 'WAITING';
                                incomingWeight = STATUS_WEIGHT[updateItem.status];
                            }
                        }

                        if (dbWeight > incomingWeight) {
                            updateItem.status = dbItem.status;
                        }
                    }

                    let dbSegs: any[] = [];
                    try { dbSegs = typeof dbItem.segments === 'string' ? JSON.parse(dbItem.segments) : (dbItem.segments || []); } catch {}
                    
                    if (updateItem.segments && Array.isArray(updateItem.segments)) {
                        updateItem.segments = updateItem.segments.map(incomingSeg => {
                            const dbSeg = dbSegs.find((s: any) => s.ktvId === incomingSeg.ktvId);
                            if (dbSeg) {
                                return {
                                    ...incomingSeg,
                                    actualStartTime: dbSeg.actualStartTime || incomingSeg.actualStartTime,
                                    actualEndTime: dbSeg.actualEndTime || incomingSeg.actualEndTime,
                                    feedbackTime: dbSeg.feedbackTime || incomingSeg.feedbackTime,
                                    reviewTime: dbSeg.reviewTime || incomingSeg.reviewTime,
                                    startPhotoUrl: dbSeg.startPhotoUrl || incomingSeg.startPhotoUrl
                                };
                            }
                            return incomingSeg;
                        });
                    }
                    return updateItem;
                });
            }
        }

        // 1. Update Booking (Dữ liệu tổng quát cho Bill, không đổi status)
        const { error: bError } = await supabase
            .from('Bookings')
            .update({
                technicianCode: dispatchData.technicianCode,
                bedId: dispatchData.bedId,
                roomName: dispatchData.roomName,
                notes: dispatchData.notes,
                updatedAt: new Date().toISOString()
            })
            .eq('id', bookingId);

        if (bError) {
            console.error('❌ [Server] Booking draft update error:', bError);
            throw bError;
        }

        // 2. Update BookingItems (Dữ liệu chi tiết từng dịch vụ, không đổi status)
        if (dispatchData.itemUpdates && dispatchData.itemUpdates.length > 0) {
            for (const item of dispatchData.itemUpdates) {
                const technicianCodes = Array.isArray(item.technicianCodes) 
                    ? item.technicianCodes 
                    : (typeof item.technicianCodes === 'string' ? item.technicianCodes.split(',').map(c => c.trim()).filter(Boolean) : []);
                
                await supabase
                    .from('BookingItems')
                    .update({ 
                        roomName: item.roomName,
                        bedId: item.bedId,
                        technicianCodes: technicianCodes,
                        segments: item.segments || [],
                        options: item.options 
                    })
                    .eq('id', item.id);
            }
        }

        // Fetch bookingDate to sync turns correctly
        const { data: bData } = await supabase.from('Bookings').select('bookingDate').eq('id', bookingId).single();
        if (bData && bData.bookingDate) {
            const dateStr = bData.bookingDate.split('T')[0];
            const { syncTurnsForDate } = await import('@/lib/turn-sync');
            await syncTurnsForDate(dateStr);
        }

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] saveDraftDispatch error:', error);
        return { success: false, error: error.message };
    }
}

export async function cancelBooking(bookingId: string, date: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 1. Cập nhật trạng thái Booking thành CANCELLED
        const { error: bError } = await supabase
            .from('Bookings')
            .update({ 
                status: 'CANCELLED',
                updatedAt: new Date().toISOString()
            })
            .eq('id', bookingId);

        if (bError) throw bError;

        // Cập nhật trạng thái các BookingItems chưa hoàn thành về CANCELLED
        const { error: itemError } = await supabase
            .from('BookingItems')
            .update({ status: 'CANCELLED' })
            .eq('bookingId', bookingId)
            .neq('status', 'DONE')
            .neq('status', 'CANCELLED');
            
        if (itemError) console.error('❌ [Server] BookingItems update error:', itemError);

        // 2. Lấy thông tin trạng thái KTV trước khi giải phóng để quyết định có xóa Ledger không
        const { data: currentTurns } = await supabase
            .from('TurnQueue')
            .select('id, employee_id, status')
            .eq('current_order_id', bookingId)
            .eq('date', date);

        if (currentTurns && currentTurns.length > 0) {
            for (const turn of currentTurns) {
                // ✅ Nếu CHƯA bắt đầu (assigned) mà bị hủy -> Xóa Ledger để giải phóng lượt tua cho KTV
                if (turn.status === 'assigned' || turn.status === 'ready' || turn.status === 'waiting') {
                    console.log(`✅ KTV ${turn.employee_id} được hoàn lượt tua do hủy đơn TRƯỚC KHI bắt đầu.`);
                    await supabase
                        .from('TurnLedger')
                        .delete()
                        .eq('date', date)
                        .eq('booking_id', bookingId)
                        .eq('employee_id', turn.employee_id);
                } else {
                    // ⚠️ Nếu đã đang làm (working) mà bị hủy -> GIỮ Ledger để tính tua/tiền cho KTV
                    console.log(`⚠️ KTV ${turn.employee_id} giữ nguyên lượt tua do hủy đơn KHI ĐANG LÀM.`);
                }

                // 3. Giải phóng KTV trong TurnQueue
                const newStatus = turn.status === 'off' ? 'off' : 'waiting';
                const { error: tError } = await supabase
                    .from('TurnQueue')
                    .update({
                        status: newStatus,
                        current_order_id: null,
                        booking_item_id: null,
                        booking_item_ids: [],
                        room_id: null,
                        bed_id: null,
                        start_time: null,
                        estimated_end_time: null
                    })
                    .eq('id', turn.id);
                    
                if (tError) {
                    console.error('❌ [Server] TurnQueue cleanup error:', tError);
                }
            }
        }

        // 🔄 ĐỒNG BỘ TIMELINE SÂU XUỐNG DB
        // Removed destructive syncOrderTimelineToDb

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] cancelBooking error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateBookingStatus(bookingId: string, newStatus: string, date: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Lấy trạng thái hiện tại để check rule
        const { data: bCurrent } = await supabase.from('Bookings').select('status').eq('id', bookingId).single();
        if (bCurrent && bCurrent.status) {
            const { canTransition } = await import('@/lib/dispatch-status');
            if (!canTransition(bCurrent.status, newStatus)) {
                return { success: false, error: `Lỗi: Không thể chuyển trạng thái từ ${bCurrent.status} sang ${newStatus}` };
            }
        }

        // 1. Cập nhật trạng thái Booking
        const { error: bError } = await supabase
            .from('Bookings')
            .update({ 
                status: newStatus,
                updatedAt: new Date().toISOString()
            })
            .eq('id', bookingId);

        if (bError) throw bError;

        // Cập nhật trạng thái các BookingItems nếu Booking được hoàn thành / huỷ
        // 🔧 FIX: KHÔNG ghi đè items đang PREPARING (chưa bắt đầu) → chỉ update items đã IN_PROGRESS trở lên
        if (['DONE', 'CANCELLED', 'CLEANING', 'FEEDBACK'].includes(newStatus)) {
            const { data: itemsToUpdate } = await supabase
                .from('BookingItems')
                .select('id, segments, status')
                .eq('bookingId', bookingId)
                .in('status', ['IN_PROGRESS', 'CLEANING', 'FEEDBACK']);
            
            if (itemsToUpdate && itemsToUpdate.length > 0) {
                const { canTransition: canTransitionItem } = await import('@/lib/dispatch-status');
                for (const item of itemsToUpdate) {
                    let segs = [];
                    try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
                    
                    let segmentsModified = false;
                    segs.forEach((s: any) => {
                        if (!s.actualEndTime) {
                            s.actualEndTime = new Date().toISOString();
                            segmentsModified = true;
                        }
                    });

                    // Skip items already at higher status
                    const itemStatus = (item as any).status;
                    if (itemStatus && !canTransitionItem(itemStatus, newStatus)) {
                        // Still update segments if modified
                        if (segmentsModified) {
                            await supabase.from('BookingItems').update({ segments: JSON.stringify(segs) }).eq('id', item.id);
                        }
                        continue;
                    }

                    const payload: any = { status: newStatus };
                    if (segmentsModified) payload.segments = JSON.stringify(segs);
                    if (newStatus === 'CLEANING' || newStatus === 'DONE' || newStatus === 'CANCELLED') {
                        payload.timeEnd = new Date().toISOString();
                    }

                    await supabase.from('BookingItems').update(payload).eq('id', item.id);
                }
            }

            // 🔧 SMART BOOKING STATUS: Re-query ALL items để tính status chính xác
            const { data: allItemsAfterPartial } = await supabase
                .from('BookingItems')
                .select('id, status')
                .eq('bookingId', bookingId);
            
            if (allItemsAfterPartial && allItemsAfterPartial.length > 0) {
                const statuses = allItemsAfterPartial.map(i => i.status);
                const { recomputeBookingStatus } = await import('@/lib/dispatch-status');
                let smartStatus = recomputeBookingStatus(statuses);
                
                // Keep the requested status if recomputed is DONE but we want a specific terminal status (e.g. FEEDBACK)
                if (smartStatus === 'DONE' && ['COMPLETED', 'DONE', 'CANCELLED', 'CLEANING', 'FEEDBACK'].includes(newStatus)) {
                    smartStatus = newStatus;
                }
                
                // Override booking status nếu khác
                if (smartStatus !== newStatus) {
                    console.log(`🧠 [Smart Status] Booking ${bookingId}: Requested ${newStatus} but computed ${smartStatus} (some items still waiting)`);
                    await supabase.from('Bookings').update({ status: smartStatus, updatedAt: new Date().toISOString() }).eq('id', bookingId);
                }
            }
        } else if (newStatus === 'IN_PROGRESS') {
            const now = new Date().toISOString();
            // Cập nhật timeStart cho Bookings nếu chưa có
            await supabase.from('Bookings').update({ timeStart: now }).eq('id', bookingId).is('timeStart', null);

            // Cập nhật tất cả các items đang chờ thành IN_PROGRESS (CHỈ items chưa bắt đầu)
            const { error: itemError } = await supabase
                .from('BookingItems')
                .update({ status: 'IN_PROGRESS', timeStart: now })
                .eq('bookingId', bookingId)
                .in('status', ['WAITING', 'PREPARING', 'NEW']);
            if (itemError) console.error('❌ [Server] BookingItems start error:', itemError);

            // 🔥 FIX: Items đã từng IN_PROGRESS (bị kéo nhầm sang COMPLETED rồi kéo lại)
            // → Chỉ update status, KHÔNG ghi đè timeStart
            await supabase
                .from('BookingItems')
                .update({ status: 'IN_PROGRESS' })
                .eq('bookingId', bookingId)
                .in('status', ['COMPLETED', 'CLEANING'])
                .not('timeStart', 'is', null);

            // Cập nhật TurnQueue thành working + recalculate estimated_end_time
            const nowVN = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
            const { data: turnsToUpdate } = await supabase
                .from('TurnQueue')
                .select('id, employee_id, start_time, estimated_end_time')
                .eq('current_order_id', bookingId)
                .eq('date', date)
                .in('status', ['waiting', 'assigned', 'working']);

            for (const turn of turnsToUpdate || []) {
                const updatePayload: any = { status: 'working', start_time: nowVN };

                // 🔥 Recalculate estimated_end_time based on actual start time
                if (turn.start_time && turn.estimated_end_time) {
                    const newEnd = recalculateEstimatedEndTime(String(turn.start_time), String(turn.estimated_end_time), nowVN);
                    if (newEnd !== turn.estimated_end_time) {
                        updatePayload.estimated_end_time = newEnd;
                        console.log(`🔄 [TurnQueue] ${turn.employee_id}: Recalculated end ${turn.estimated_end_time} → ${updatePayload.estimated_end_time} (actual start: ${nowVN})`);
                    }
                }

                const { error: tError } = await supabase.from('TurnQueue').update(updatePayload).eq('id', turn.id);
                if (tError) console.error('❌ [Server] TurnQueue start error:', tError);
            }
        }

        // 🔧 CHỈ release KTV khi DONE hoặc CANCELLED. CLEANING/FEEDBACK = KTV vẫn bận!
        if (newStatus === 'DONE' || newStatus === 'CANCELLED') {
            // Re-check: chỉ giải phóng nếu KHÔNG còn items đang PREPARING/IN_PROGRESS
            const { data: remainingItems } = await supabase
                .from('BookingItems')
                .select('status')
                .eq('bookingId', bookingId)
                .in('status', ['PREPARING', 'IN_PROGRESS', 'NEW', 'WAITING']);
            
            const allReallyDone = !remainingItems || remainingItems.length === 0;
            
            if (allReallyDone) {
                // Lấy tất cả KTV đang làm đơn hàng này từ TurnQueue (cách cũ)
                const { data: turnsToRelease } = await supabase
                    .from('TurnQueue')
                    .select('id, employee_id, turns_completed, status')
                    .eq('current_order_id', bookingId)
                    .eq('date', date);

                // 🔥 BỔ SUNG: Lấy thêm danh sách từ KtvAssignments (ACTIVE state) để vét cạn các KTV bị kẹt
                const { data: activeAssignments } = await supabase
                    .from('KtvAssignments')
                    .select('employee_id')
                    .eq('booking_id', bookingId)
                    .eq('status', 'ACTIVE');

                const ktvsToRelease = new Set<string>();
                (turnsToRelease || []).forEach(t => { if (t.employee_id) ktvsToRelease.add(t.employee_id); });
                (activeAssignments || []).forEach(a => { if (a.employee_id) ktvsToRelease.add(a.employee_id); });

                if (ktvsToRelease.size > 0) {
                    for (const employeeId of Array.from(ktvsToRelease)) {
                        const turn = (turnsToRelease || []).find(t => t.employee_id === employeeId);

                        // Nếu hủy đơn khi đã bắt đầu làm (working) -> Xóa bản ghi TurnLedger (mất tua)
                        if (newStatus === 'CANCELLED' && turn && turn.status === 'working') {
                            console.log(`⚠️ KTV ${turn.id} mất tua do hủy đơn (status working).`);
                            await supabase
                                .from('TurnLedger')
                                .delete()
                                .eq('date', date)
                                .eq('booking_id', bookingId)
                                .eq('employee_id', employeeId);
                        }

                        // 1. Cập nhật KtvAssignments thành COMPLETED hoặc CANCELLED
                        const assignStatus = newStatus === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
                        await supabase
                            .from('KtvAssignments')
                            .update({ status: assignStatus, updated_at: new Date().toISOString() })
                            .eq('employee_id', employeeId)
                            .eq('booking_id', bookingId)
                            .eq('business_date', date)
                            .eq('status', 'ACTIVE'); // Khóa chặt theo đơn hàng và ngày làm việc

                        // 2. Gọi Auto-Handoff Engine
                        const { data: promoteData, error: promoteErr } = await supabase.rpc('promote_next_assignment', {
                            p_employee_id: employeeId,
                            p_business_date: date
                        });

                        if (promoteErr) console.error(`[Handoff] Error promoting KTV ${employeeId}:`, promoteErr);
                        else console.log(`[Handoff] KTV ${employeeId} auto-handoff result:`, promoteData);
                    }
                }
            } else {
                console.log(`🛡️ [Server] Booking ${bookingId}: Skipping TurnQueue release — ${remainingItems?.length} items still active`);
            }
        }

        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(date);

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] updateBookingStatus error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateBookingItemStatus(itemIds: string[], newStatus: string, date: string, bookingId: string, targetKtvIds?: string[], forceBackward: boolean = false) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Lấy trạng thái hiện tại của items để check rule
        const { data: itemsCurrent } = await supabase.from('BookingItems').select('id, status, segments').in('id', itemIds);
        const { canTransition } = await import('@/lib/dispatch-status');
        
        // Filter: chỉ update items CÓ THỂ chuyển trạng thái, skip items đã ở bước cao hơn
        const updatableIds = (itemsCurrent || [])
            .filter(item => !item.status || canTransition(item.status, newStatus) || forceBackward)
            .map(item => item.id);
        
        const skippedItems = (itemsCurrent || [])
            .filter(item => item.status && !canTransition(item.status, newStatus) && !forceBackward);
        
        if (skippedItems.length > 0) {
            console.log(`[updateBookingItemStatus] Skipping ${skippedItems.length} items already at higher status:`, 
                skippedItems.map(i => `${i.id}:${i.status}`).join(', '));
        }
        
        for (const item of itemsCurrent || []) {
            let segs: any[] = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            
            let segmentsModified = false;
            // Cập nhật actualStartTime khi bắt đầu làm
            if (['IN_PROGRESS'].includes(newStatus)) {
                segs.forEach((s: any) => {
                    if (targetKtvIds && targetKtvIds.length > 0 && s.ktvId && !targetKtvIds.includes(s.ktvId)) {
                        return;
                    }
                    if (!s.actualStartTime) {
                        s.actualStartTime = new Date().toISOString();
                        segmentsModified = true;
                    }
                });
            }

            // Xóa sạch thời gian nếu Lễ tân ÉP KÉO LÙI về Chuẩn Bị
            if (['PREPARING', 'WAITING', 'NEW'].includes(newStatus) && forceBackward) {
                segs.forEach((s: any) => {
                    if (targetKtvIds && targetKtvIds.length > 0 && s.ktvId && !targetKtvIds.includes(s.ktvId)) {
                        return;
                    }
                    delete s.actualStartTime;
                    delete s.actualEndTime;
                    delete s.feedbackTime;
                    delete s.reviewTime;
                    segmentsModified = true;
                });
            }

            // Luôn đảm bảo có actualEndTime nếu đang chuyển sang trạng thái kết thúc
            if (['DONE', 'CANCELLED', 'CLEANING', 'FEEDBACK', 'COMPLETED'].includes(newStatus)) {
                segs.forEach((s: any) => {
                    // Chỉ update nếu KTV này nằm trong targetKtvIds (nếu có)
                    if (targetKtvIds && targetKtvIds.length > 0 && s.ktvId && !targetKtvIds.includes(s.ktvId)) {
                        return; 
                    }
                    if (!s.actualEndTime) {
                        s.actualEndTime = new Date().toISOString();
                        segmentsModified = true;
                    }
                    // 🔥 FIX: Nếu chuyển sang FEEDBACK hoặc DONE, phải có feedbackTime thì Kanban mới chịu nhảy cột
                    if (['FEEDBACK', 'DONE'].includes(newStatus) && !s.feedbackTime) {
                        s.feedbackTime = new Date().toISOString();
                        segmentsModified = true;
                    }
                });
            }
            
            // Chỉ update status nếu được phép chuyển đổi
            const isUpdatable = updatableIds.includes(item.id);
            const payload: any = {};
            
            if (isUpdatable) {
                payload.status = newStatus;
                if (['CLEANING', 'DONE', 'CANCELLED', 'COMPLETED'].includes(newStatus)) {
                    payload.timeEnd = new Date().toISOString();
                }
            }
            
            if (segmentsModified) {
                payload.segments = JSON.stringify(segs);
            }
            
            if (Object.keys(payload).length > 0) {
                const { error: itemError } = await supabase.from('BookingItems').update(payload).eq('id', item.id);
                if (itemError) throw itemError;
            }
        }

        if (newStatus === 'IN_PROGRESS') {
            const now = new Date().toISOString();
            
            // Cập nhật timeStart cho Bookings nếu chưa có
            await supabase.from('Bookings').update({ timeStart: now }).eq('id', bookingId).is('timeStart', null);

            // 🔥 FIX: Chỉ set timeStart cho items CHƯA có timeStart (tránh ghi đè giờ KTV đã bấm)
            // Lấy danh sách items hiện tại để kiểm tra
            const { data: currentItems } = await supabase
                .from('BookingItems')
                .select('id, timeStart, status')
                .in('id', itemIds);

            const itemsNeedTimeStart = (currentItems || []).filter(i => !i.timeStart).map(i => i.id);
            const itemsAlreadyStarted = (currentItems || []).filter(i => i.timeStart).map(i => i.id);

            // Items chưa có timeStart → set cả status + timeStart
            if (itemsNeedTimeStart.length > 0) {
                await supabase
                    .from('BookingItems')
                    .update({ status: 'IN_PROGRESS', timeStart: now })
                    .in('id', itemsNeedTimeStart);
            }

            // Items đã có timeStart → CHỈ update status, bảo toàn timeStart gốc
            if (itemsAlreadyStarted.length > 0) {
                await supabase
                    .from('BookingItems')
                    .update({ status: 'IN_PROGRESS' })
                    .in('id', itemsAlreadyStarted);
            }

            // Cập nhật TurnQueue thành working + recalculate estimated_end_time
            const nowVN2 = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
            let fetchQuery = supabase
                .from('TurnQueue')
                .select('id, employee_id, start_time, estimated_end_time')
                .eq('current_order_id', bookingId)
                .overlaps('booking_item_ids', itemIds)
                .eq('date', date)
                .in('status', ['waiting', 'working']);

            if (targetKtvIds && targetKtvIds.length > 0) {
                fetchQuery = fetchQuery.in('employee_id', targetKtvIds);
            }
            const { data: turnsToUpdate2 } = await fetchQuery;

            for (const turn of turnsToUpdate2 || []) {
                const updatePayload: any = { status: 'working', start_time: nowVN2 };

                // 🔥 Recalculate estimated_end_time based on actual start time
                if (turn.start_time && turn.estimated_end_time) {
                    const newEnd = recalculateEstimatedEndTime(String(turn.start_time), String(turn.estimated_end_time), nowVN2);
                    if (newEnd !== turn.estimated_end_time) {
                        updatePayload.estimated_end_time = newEnd;
                        console.log(`🔄 [TurnQueue] ${turn.employee_id}: Recalculated end ${turn.estimated_end_time} → ${updatePayload.estimated_end_time} (actual start: ${nowVN2})`);
                    }
                }

                const { error: tErr } = await supabase.from('TurnQueue').update(updatePayload).eq('id', turn.id);
                if (tErr) console.error('❌ [Server] TurnQueue start error:', tErr);
            }
        }

        if (newStatus === 'CLEANING' || newStatus === 'COMPLETED' || newStatus === 'DONE' || newStatus === 'CANCELLED' || newStatus === 'FEEDBACK') {
            // Lấy tất cả KTV đang làm các item này
            let queryToRelease = supabase
                .from('TurnQueue')
                .select('id, turns_completed, status, booking_item_ids')
                .eq('current_order_id', bookingId)
                .overlaps('booking_item_ids', itemIds)
                .eq('date', date);
                
            if (targetKtvIds && targetKtvIds.length > 0) {
                queryToRelease = queryToRelease.in('employee_id', targetKtvIds);
            }

            const { data: turnsToRelease } = await queryToRelease;

            if (turnsToRelease && turnsToRelease.length > 0) {
                for (const turn of turnsToRelease) {
                    const currentItemIds = turn.booking_item_ids || [];
                    const remainingItemIds = currentItemIds.filter((id: string) => !itemIds.includes(id));

                    if (remainingItemIds.length > 0) {
                        // KTV vẫn còn item khác đang làm trong bill này
                        await supabase
                            .from('TurnQueue')
                            .update({
                                booking_item_id: remainingItemIds.join(','),
                                booking_item_ids: remainingItemIds
                            })
                            .eq('id', turn.id);
                    } else {
                        // KTV đã xong tất cả item của họ
                        let newTurnsCompleted = turn.turns_completed || 0;
                        const newStatus = turn.status === 'off' ? 'off' : 'waiting';
                        await supabase
                            .from('TurnQueue')
                            .update({
                                status: newStatus,
                                current_order_id: null,
                                booking_item_id: null,
                                booking_item_ids: [], // Set về mảng rỗng thay vì mảng chuỗi '{}'
                                start_time: null,
                                estimated_end_time: null,
                                turns_completed: newTurnsCompleted
                            })
                            .eq('id', turn.id);
                    }
                }
            }
        }
        
        // Auto-update Booking status based on remaining items
        const { data: allItems } = await supabase.from('BookingItems').select('status, serviceId, Services!BookingItems_serviceId_fkey(nameVN, is_utility)').eq('bookingId', bookingId);
        if (allItems && allItems.length > 0) {
            const validItems = allItems.filter((i: any) => {
                const name = i.Services?.nameVN || '';
                return i.Services?.is_utility !== true 
                    && i.serviceId !== 'NHS0900' // Legacy fallback
                    && !name.toLowerCase().includes('phòng riêng') 
                    && !name.toLowerCase().includes('phong rieng');
            });
            const finalItems = validItems.length > 0 ? validItems : allItems;
            const statuses = finalItems.map(i => i.status);
            const { recomputeBookingStatus } = await import('@/lib/dispatch-status');
            let bStatus = recomputeBookingStatus(statuses);
            
            if (bStatus === 'DONE' && ['CLEANING', 'FEEDBACK', 'DONE', 'CANCELLED'].includes(newStatus)) {
                bStatus = newStatus;
            }
            
            await supabase.from('Bookings').update({ status: bStatus }).eq('id', bookingId);
        }

        const { syncTurnsForDate } = await import('@/lib/turn-sync');
        await syncTurnsForDate(date);

        // 🔄 ĐỒNG BỘ TIMELINE SÂU XUỐNG DB
        // Removed destructive syncOrderTimelineToDb

        return { success: true };
    } catch (error: any) {
        console.error('❌ [Server] updateBookingItemStatus error:', error);
        return { success: false, error: error.message };
    }
}

export async function createQuickBooking(data: { customerName: string; customerPhone?: string; customerEmail?: string; serviceIds: string[]; bookingDate: string; customerLang?: string; }) {
    return await BookingModificationService.createQuickBooking(data);
}

export async function addAddonServices(bookingId: string, items: { serviceId: string; qty: number }[], adminId: string = 'ADMIN') {
    return await BookingModificationService.addAddonServices(bookingId, items, adminId);
}

export async function confirmAddonPayment(bookingId: string) {
    return await BookingModificationService.confirmAddonPayment(bookingId);
}

export async function removeBookingItem(bookingId: string, itemId: string) {
    return await BookingModificationService.removeBookingItem(bookingId, itemId);
}

export async function editBookingService(bookingId: string, itemId: string, newServiceId: string) {
    return await BookingModificationService.editBookingService(bookingId, itemId, newServiceId);
}

export async function submitCustomerRating(bookingId: string, rating: number, feedbackNote?: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Kiểm tra trạng thái hiện tại để quyết định chuyển hay không
        const { data: current } = await supabase
            .from('Bookings')
            .select('status')
            .eq('id', bookingId)
            .single();

        const updatePayload: any = { 
            rating, 
            feedbackNote,
            updatedAt: new Date().toISOString() 
        };

        // Nếu đã dọn xong (FEEDBACK) → cả 2 tag ✅ → DONE
        // Nếu đang dọn (CLEANING) → chỉ lưu rating, giữ nguyên status
        if (current?.status === 'FEEDBACK') {
            updatePayload.status = 'DONE';
        }
        // CLEANING → không đổi status, chờ dọn xong mới DONE

        const { error } = await supabase
            .from('Bookings')
            .update(updatePayload)
            .eq('id', bookingId);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error("❌ [Server] submitCustomerRating error:", error);
        return { success: false, error: error.message };
    }
}

export async function splitBookingItem(bookingId: string, itemId: string, dur1: number, dur2: number, date: string) {
    return await BookingModificationService.splitBookingItem(bookingId, itemId, dur1, dur2, date);
}

/**
 * 🔄 ĐỒNG BỘ TIMELINE TOÀN BỘ ORDER XUỐNG DATABASE (OPTION B)
 * Tính toán giờ nối tiếp thực tế dựa trên actualStartTime và ghi đè vào segments của từng BookingItem.
 * Điều này đảm bảo KTV Dashboard và các API khác luôn thấy giờ chính xác nhất.
 */
export async function syncOrderTimelineToDb(bookingId: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return;

        // 1. Fetch toàn bộ items của order
        const { data: items, error: fetchErr } = await supabase
            .from('BookingItems')
            .select('id, segments, duration, timeStart, serviceId, serviceName, options')
            .eq('bookingId', bookingId);
        
        if (fetchErr || !items || items.length === 0) return;

        // Helpers copy từ frontend (bản server-side)
        const formatToHourMinute = (isoString: string | null | undefined): string => {
            if (!isoString) return '--:--';
            if (/^\d{1,2}:\d{2}$/.test(isoString)) return isoString;
            let parseString = isoString;
            if (!isoString.endsWith('Z') && !isoString.includes('+')) {
                parseString = isoString.replace(' ', 'T') + 'Z';
            }
            const d = new Date(parseString);
            if (isNaN(d.getTime())) return isoString;
            const dVn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
            return `${String(dVn.getUTCHours()).padStart(2, '0')}:${String(dVn.getUTCMinutes()).padStart(2, '0')}`;
        };

        const getDynamicEndTime = (startStr?: string | null, durationMins: number = 60) => {
            if (!startStr) return '--:--';
            const formatted = formatToHourMinute(startStr);
            if (formatted === '--:--') return '--:--';
            let [h, m] = formatted.split(':').map(Number);
            m += durationMins;
            h += Math.floor(m / 60);
            m = m % 60;
            h = h % 24;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        // 2. Gom tất cả segments vào mảng phẳng để tính toán
        const allSegments: any[] = [];
        items.forEach(item => {
            // Bỏ qua phòng riêng
            if ((item as any).is_utility === true || item.serviceId === 'NHS0900' || item.serviceName?.toLowerCase().includes('phòng riêng') || item.serviceName?.toLowerCase().includes('phong rieng')) return; // Legacy fallback
            
            let segs = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch {}
            
            segs.forEach((s: any) => {
                allSegments.push({
                    itemId: item.id,
                    ktvId: s.ktvId,
                    origStart: s.startTime || '',
                    duration: Number(s.duration) || Number(item.duration) || 60,
                    actualStartTime: s.actualStartTime,
                    actualEndTime: s.actualEndTime,
                    _originalSeg: s,
                    _parentItem: item
                });
            });
        });

        // Sắp xếp theo giờ xuất phát gốc
        allSegments.sort((a, b) => a.origStart.localeCompare(b.origStart));

        let currentMaxEndStr = '';
        let lastGroupStartTime = '';
        let lastGroupCalculatedStart = '';
        const updates = new Map<string, any[]>(); // itemId -> newSegments[]

        allSegments.forEach((seg, idx) => {
            let calculatedStart = seg.origStart;
            
            if (idx > 0) {
                if (seg.origStart === lastGroupStartTime) {
                    calculatedStart = lastGroupCalculatedStart;
                } else if (currentMaxEndStr) {
                    calculatedStart = currentMaxEndStr;
                }
            }

            // Ghi nhận sự thay đổi nếu có
            const newSeg = { ...seg._originalSeg, startTime: calculatedStart };
            if (!updates.has(seg.itemId)) updates.set(seg.itemId, []);
            updates.get(seg.itemId)!.push(newSeg);

            // Tính mốc kết thúc để gối đầu cho KTV sau
            const runtimeAnchor = seg.actualStartTime || calculatedStart;
            const ktvEnd = seg.actualEndTime || getDynamicEndTime(runtimeAnchor, seg.duration);

            if (seg.origStart !== lastGroupStartTime) {
                currentMaxEndStr = ktvEnd;
            } else {
                if (ktvEnd > currentMaxEndStr) currentMaxEndStr = ktvEnd;
            }

            lastGroupStartTime = seg.origStart;
            lastGroupCalculatedStart = calculatedStart;
        });

        // 3. Thực hiện update DB cho các item có thay đổi segments
        for (const [itemId, newSegs] of updates.entries()) {
            const originalItem = items.find(i => i.id === itemId);
            let oldSegsStr = '';
            try { oldSegsStr = typeof originalItem?.segments === 'string' ? originalItem.segments : JSON.stringify(originalItem?.segments || []); } catch {}
            
            const newSegsStr = JSON.stringify(newSegs);
            
            if (oldSegsStr !== newSegsStr) {
                console.log(`[syncOrderTimeline] Updating Item ${itemId}: shifted timeline detected.`);
                const payload: any = { segments: newSegsStr };
                
                // Nếu là segment đầu tiên của item này, cập nhật cả timeStart của item để đồng bộ
                if (newSegs.length > 0 && newSegs[0].startTime) {
                    payload.timeStart = newSegs[0].startTime;
                }

                await supabase.from('BookingItems').update(payload).eq('id', itemId);
            }
        }
    } catch (err) {
        console.error('❌ [Server] syncOrderTimelineToDb error:', err);
    }
}

export async function searchCustomers(query: string) {
    try {
        await requirePermission('dispatch_board');
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const safeQuery = query.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');

        const { data, error } = await supabase
            .from('Customers')
            .select('id, fullName, phone, email')
            .or(`fullName.ilike.%${safeQuery}%,phone.ilike.%${safeQuery}%`)
            .limit(10);

        if (error) throw error;
        return { success: true, data };
    } catch (err: any) {
        console.error('❌ [Server] searchCustomers error:', err.message);
        return { success: false, error: err.message };
    }
}
