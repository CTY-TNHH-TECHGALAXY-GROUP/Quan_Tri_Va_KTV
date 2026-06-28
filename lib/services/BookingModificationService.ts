import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission } from '@/lib/auth-server';
import { createNotification } from '@/lib/notification-helper';

export class BookingModificationService {
    static async createQuickBooking(data: {
        customerName: string;
        customerPhone?: string;
        customerEmail?: string;
        serviceIds: string[];
        bookingDate: string; // "YYYY-MM-DD"
        customerLang?: string; // Language code: vi, en, kr, jp, cn
    }) {
        try {
            await requirePermission('dispatch_board');
            const supabase = getSupabaseAdmin();
            if (!supabase) throw new Error('Supabase admin not initialized');

            // 1. Tạo billCode ngẫu nhiên (VD: S260307-ABCD)
            const dateStr = data.bookingDate.replace(/-/g, '').substring(2);
            const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
            const billCode = `S${dateStr}-${randomStr}`;

            // 2. Lấy thông tin dịch vụ
            const { data: svcs, error: sError } = await supabase
                .from('Services')
                .select('id, priceVND, duration')
                .in('id', data.serviceIds);
            
            if (sError) throw new Error(`Lỗi khi lấy dịch vụ: ${sError.message}`);
            if (!svcs || svcs.length === 0) throw new Error(`Không tìm thấy dịch vụ nào`);

            const totalAmount = svcs.reduce((acc, svc) => acc + (svc.priceVND || 0), 0);

            // 3. Tạo Booking
            const bookingId = crypto.randomUUID();
            const { data: booking, error: bError } = await supabase
                .from('Bookings')
                .insert({
                    id: bookingId,
                    customerName: data.customerName,
                    customerPhone: data.customerPhone || '',
                    customerEmail: data.customerEmail || '',
                    billCode,
                    status: 'NEW',
                    customerLang: data.customerLang || 'vi',
                    source: 'STANDARD_WALK_IN',
                    bookingDate: `${data.bookingDate} ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
                    totalAmount: totalAmount,
                    paymentMethod: 'Tiền mặt',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                })
                .select()
                .single();

            if (bError) throw bError;

            // Insert multiple items
            const itemsToInsert = data.serviceIds.map(sid => {
                const svc = svcs.find(s => s.id === sid);
                return {
                    id: crypto.randomUUID(),
                    bookingId: booking.id,
                    serviceId: sid,
                    quantity: 1,
                    price: svc?.priceVND || 0,
                    status: 'NEW'
                };
            });

            const { error: iError } = await supabase.from('BookingItems').insert(itemsToInsert);
            if (iError) throw iError;

            // 4. Notify
            const msg = `Khách ${data.customerName} vừa được tạo đơn. Hãy nhanh chóng điều phối!`;
            await createNotification({
                bookingId: bookingId,
                type: 'NEW_ORDER',
                message: msg,
            });

            return { success: true, bookingId: booking.id };
        } catch (error: any) {
            console.error('❌ [Server] createQuickBooking error:', error);
            return { success: false, error: error.message };
        }
    }

    static async addAddonServices(bookingId: string, items: { serviceId: string; qty: number }[], adminId: string = 'ADMIN') {
        try {
            await requirePermission('dispatch_board');
            const supabase = getSupabaseAdmin();
            if (!supabase) throw new Error('Supabase admin not initialized');

            const vnTimeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

            const { data: booking, error: bookingError } = await supabase.from('Bookings').select('*').eq('id', bookingId).single();
            if (bookingError || !booking) throw new Error('Không tìm thấy đơn hàng');

            const serviceIds = items.map(i => i.serviceId);
            const { data: allServices, error: sError } = await supabase.from('Services').select('*').in('id', serviceIds);
            if (sError) throw sError;

            let totalVND = 0;
            let addedDuration = 0;
            const detailedItems = items.map(item => {
                const serviceDef = allServices?.find(s => s.id === item.serviceId);
                const price = serviceDef?.priceVND || 0;
                const duration = serviceDef?.duration ?? 60;
                const name = (typeof serviceDef?.nameVN === 'object' && serviceDef?.nameVN !== null) ? (serviceDef?.nameVN.vn || serviceDef?.nameVN.en || serviceDef?.nameVN) : (serviceDef?.nameVN || serviceDef?.nameEN || `Dịch vụ ${item.serviceId}`);
                totalVND += price * item.qty;
                addedDuration += duration * item.qty;
                return { ...item, priceOriginal: price, duration, name };
            });

            const { data: existingItems } = await supabase
                .from('BookingItems')
                .select('id, segments, status, technicianCodes, roomName, bedId, serviceId')
                .eq('bookingId', bookingId)
                .neq('status', 'CANCELLED');
                
            let sourceItem = existingItems?.find((i: any) => {
                const isUtility = i.serviceId === 'NHS0900' || false;
                return !isUtility && (i.status === 'IN_PROGRESS' || i.status === 'PREPARING');
            }) || existingItems?.[0];

            const timestamp = Date.now();
            const itemsToInsert = detailedItems.map((item, index) => {
                const isUtility = (item as any).is_utility === true
                    || item.serviceId === 'NHS0900'
                    || String(item.name || '').toLowerCase().includes('phòng riêng')
                    || String(item.name || '').toLowerCase().includes('phong rieng');

                let itemStatus = 'WAITING';
                let itemTechCodes: string[] = [];
                let newSegments: any[] = [];
                
                if (!isUtility && sourceItem) {
                    itemTechCodes = Array.isArray(sourceItem.technicianCodes) 
                        ? sourceItem.technicianCodes 
                        : (typeof sourceItem.technicianCodes === 'string' ? sourceItem.technicianCodes.split(',').filter(Boolean) : []);
                        
                    if (sourceItem.status === 'IN_PROGRESS' || sourceItem.status === 'PREPARING') itemStatus = sourceItem.status;
                    
                    try {
                        const sourceSegs = typeof sourceItem.segments === 'string' ? JSON.parse(sourceItem.segments) : (sourceItem.segments || []);
                        if (sourceSegs.length > 0) {
                            newSegments = sourceSegs.map((seg: any) => ({
                                ...seg,
                                id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                                duration: item.duration,
                                actualStartTime: itemStatus === 'IN_PROGRESS' ? new Date().toISOString() : undefined,
                                actualEndTime: undefined,
                                feedbackTime: undefined,
                                reviewTime: undefined
                            }));
                        } else if (itemTechCodes.length > 0) {
                             newSegments = itemTechCodes.map((ktvId: string) => ({
                                 id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                                 ktvId: ktvId,
                                 roomId: sourceItem.roomName || null,
                                 bedId: sourceItem.bedId || null,
                                 startTime: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                                 duration: item.duration
                             }));
                        }
                    } catch (e) {}
                }

                return {
                    id: `${bookingId}-addon-${timestamp}-${index}`,
                    bookingId: bookingId,
                    serviceId: item.serviceId,
                    quantity: item.qty,
                    price: item.priceOriginal,
                    status: itemStatus,
                    technicianCodes: itemTechCodes,
                    roomName: sourceItem?.roomName || null,
                    bedId: sourceItem?.bedId || null,
                    segments: JSON.stringify(newSegments),
                    options: { isAddon: true, isPaid: false }
                };
            });

            const { error: itemsError } = await supabase.from('BookingItems').insert(itemsToInsert);
            if (itemsError) throw itemsError;

            const newTotalAmount = (Number(booking.totalAmount) || 0) + totalVND;
            const { error: updateBookingError } = await supabase.from('Bookings').update({ totalAmount: newTotalAmount, updatedAt: vnTimeStr }).eq('id', bookingId);
            if (updateBookingError) throw updateBookingError;

            const newItemIds = itemsToInsert.map(i => i.id);
            const affectedKtvIds = new Set<string>();
            itemsToInsert.forEach(i => {
                if (i.technicianCodes && Array.isArray(i.technicianCodes)) {
                    i.technicianCodes.forEach((ktvId: string) => affectedKtvIds.add(ktvId));
                }
            });
            
            if (affectedKtvIds.size > 0) {
                for (const ktvId of Array.from(affectedKtvIds)) {
                    const { data: turn } = await supabase.from('TurnQueue').select('*').eq('current_order_id', bookingId).eq('employee_id', ktvId).maybeSingle();
                    if (turn) {
                        const updateData: any = {};
                        let addedDurationForThisKtv = 0;
                        itemsToInsert.forEach((item, idx) => {
                             if (item.technicianCodes && item.technicianCodes.includes(ktvId)) {
                                  addedDurationForThisKtv += detailedItems[idx].duration;
                             }
                        });

                        if (turn.estimated_end_time && addedDurationForThisKtv > 0) {
                            const [h, m, s] = turn.estimated_end_time.split(':').map(Number);
                            const d = new Date();
                            d.setHours(h, m, s || 0);
                            d.setMinutes(d.getMinutes() + addedDurationForThisKtv);
                            updateData.estimated_end_time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                        }

                        const existingItemIds = Array.isArray(turn.booking_item_ids) ? turn.booking_item_ids : [];
                        const mergedItemIds = [...new Set([...existingItemIds, ...newItemIds])];
                        updateData.booking_item_id = mergedItemIds.join(',');
                        updateData.booking_item_ids = mergedItemIds;

                        await supabase.from('TurnQueue').update(updateData).eq('id', turn.id);
                    }
                }
            }

            const addedServiceNames = detailedItems.map(i => i.name).join(', ');
            await createNotification({
                bookingId: bookingId,
                type: 'ADDON_SERVICE',
                message: `Phát sinh chưa thu: Đơn ${booking.billCode || bookingId} vừa được thêm ${addedServiceNames} (${totalVND.toLocaleString()}đ).`,
            });

            return { success: true, newTotalAmount, newItems: itemsToInsert };
        } catch (error: any) {
            console.error("❌ [Server] Lỗi thêm dịch vụ phụ:", error.message);
            return { success: false, error: error.message };
        }
    }

    static async confirmAddonPayment(bookingId: string) {
        try {
            await requirePermission('dispatch_board');
            const supabase = getSupabaseAdmin();
            if (!supabase) throw new Error('Supabase admin not initialized');

            const { data: items, error: fetchError } = await supabase.from('BookingItems').select('*').eq('bookingId', bookingId);
            if (fetchError) throw fetchError;
            if (!items || items.length === 0) return { success: true };

            const addonItems = items.filter(item => {
                let options = item.options;
                if (typeof options === 'string') { try { options = JSON.parse(options); } catch (e) {} }
                return options?.isAddon === true && options?.isPaid === false;
            });

            if (addonItems.length === 0) return { success: true };

            for (const item of addonItems) {
                let options = item.options;
                if (typeof options === 'string') { try { options = JSON.parse(options); } catch (e) { options = {}; } }
                const newOptions = { ...options, isPaid: true };
                await supabase.from('BookingItems').update({ options: newOptions }).eq('id', item.id);
            }
            return { success: true };
        } catch (error: any) {
            console.error("❌ [Server] Lỗi xác nhận thu tiền:", error.message);
            return { success: false, error: error.message };
        }
    }

    static async removeBookingItem(bookingId: string, itemId: string) {
        try {
            await requirePermission('dispatch_board');
            const supabase = getSupabaseAdmin();
            if (!supabase) throw new Error('Supabase admin not initialized');

            const { data: item, error: iError } = await supabase.from('BookingItems').select('*').eq('id', itemId).single();
            if (iError || !item) return { success: false, error: 'Không tìm thấy dịch vụ' };
            
            const { data: booking, error: bError } = await supabase.from('Bookings').select('*').eq('id', bookingId).single();
            if (bError) throw bError;
            
            const { error: delError } = await supabase.from('BookingItems').delete().eq('id', itemId);
            if (delError) throw delError;
            
            const itemTotal = (item.price || 0) * (item.quantity || 1);
            const newTotalAmount = Math.max(0, (Number(booking.totalAmount) || 0) - itemTotal);
            const vnTimeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
            
            await supabase.from('Bookings').update({ totalAmount: newTotalAmount, updatedAt: vnTimeStr }).eq('id', bookingId);

            const { data: turnsAffected } = await supabase
                .from('TurnQueue')
                .select('id, status, booking_item_ids')
                .eq('current_order_id', bookingId)
                .contains('booking_item_ids', [itemId]);

            if (turnsAffected && turnsAffected.length > 0) {
                for (const turn of turnsAffected) {
                    const currentItemIds = turn.booking_item_ids || [];
                    const remainingItemIds = currentItemIds.filter((id: string) => id !== itemId);
                    if (remainingItemIds.length > 0) {
                        await supabase.from('TurnQueue').update({ booking_item_id: remainingItemIds.join(','), booking_item_ids: remainingItemIds }).eq('id', turn.id);
                    } else {
                        const newStatus = turn.status === 'off' ? 'off' : 'waiting';
                        await supabase.from('TurnQueue').update({
                            status: newStatus, current_order_id: null, booking_item_id: null, booking_item_ids: [],
                            room_id: null, bed_id: null, start_time: null, estimated_end_time: null
                        }).eq('id', turn.id);
                    }
                }
            }
            return { success: true, newTotalAmount };
        } catch (error: any) {
            console.error("❌ [Server] Lỗi xoá dịch vụ:", error.message);
            return { success: false, error: error.message };
        }
    }

    static async editBookingService(bookingId: string, itemId: string, newServiceId: string) {
        try {
            await requirePermission('dispatch_board');
            const supabase = getSupabaseAdmin();
            if (!supabase) throw new Error('Supabase admin not initialized');

            const vnTimeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
            const { data: booking, error: bError } = await supabase.from('Bookings').select('*').eq('id', bookingId).single();
            if (bError || !booking) throw new Error('Không tìm thấy đơn hàng');

            const { data: oldItem, error: iError } = await supabase.from('BookingItems').select('*').eq('id', itemId).single();
            if (iError || !oldItem) throw new Error('Không tìm thấy dịch vụ cũ');

            const { data: newService, error: sError } = await supabase.from('Services').select('*').eq('id', newServiceId).single();
            if (sError || !newService) throw new Error('Không tìm thấy dịch vụ thay thế');

            const oldPrice = oldItem.price || 0;
            const newPrice = newService.priceVND || 0;
            const priceDiff = (newPrice - oldPrice) * (oldItem.quantity || 1);
            const newDuration = newService.duration ?? 60;
            
            const { data: oldService } = await supabase.from('Services').select('duration, nameVN').eq('id', oldItem.serviceId).single();
            const oldDuration = oldService?.duration ?? 60;
            const durationDiff = newDuration - oldDuration;

            const oldServiceName = typeof oldService?.nameVN === 'object' ? oldService?.nameVN?.vn || oldService?.nameVN?.en : oldService?.nameVN || 'Dịch vụ cũ';
            const newServiceName = typeof newService.nameVN === 'object' ? newService.nameVN.vn || newService.nameVN.en : newService.nameVN || 'Dịch vụ mới';

            let newOptions = oldItem.options || {};
            if (!newOptions.displayName || newOptions.displayName === oldServiceName) {
                newOptions.displayName = newServiceName;
            }

            let newSegments = oldItem.segments || [];
            try { newSegments = typeof oldItem.segments === 'string' ? JSON.parse(oldItem.segments) : (Array.isArray(oldItem.segments) ? oldItem.segments : []); } catch { newSegments = []; }
            
            if (durationDiff !== 0 && newSegments.length > 0) {
                newSegments = newSegments.map((seg: any) => {
                    if (seg.startTime) {
                        const [h, m] = seg.startTime.split(':').map(Number);
                        const d = new Date(); d.setHours(h, m, 0); d.setMinutes(d.getMinutes() + newDuration);
                        seg.endTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    }
                    return seg;
                });
            }

            await supabase.from('BookingItems').update({ serviceId: newServiceId, price: newPrice, options: newOptions, segments: newSegments }).eq('id', itemId);

            const newTotalAmount = Math.max(0, (Number(booking.totalAmount) || 0) + priceDiff);
            await supabase.from('Bookings').update({ totalAmount: newTotalAmount, updatedAt: vnTimeStr }).eq('id', bookingId);

            if (booking.technicianCode) {
                const ktvIds = booking.technicianCode.split(',').map((id: string) => id.trim());
                for (const ktvId of ktvIds) {
                    const { data: turn } = await supabase.from('TurnQueue').select('*').eq('current_order_id', bookingId).eq('employee_id', ktvId).contains('booking_item_ids', [itemId]).maybeSingle();
                    if (turn && turn.estimated_end_time && durationDiff !== 0) {
                        const [h, m, s] = turn.estimated_end_time.split(':').map(Number);
                        const d = new Date(); d.setHours(h, m, s || 0); d.setMinutes(d.getMinutes() + durationDiff);
                        const updatedEndTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                        await supabase.from('TurnQueue').update({ estimated_end_time: updatedEndTime }).eq('id', turn.id);
                    }
                }
            }

            let diffText = priceDiff > 0 ? `Thu thêm ${(priceDiff).toLocaleString()}đ` : priceDiff < 0 ? `Thối lại ${Math.abs(priceDiff).toLocaleString()}đ` : 'Không chênh lệch giá';
            await createNotification({ bookingId: bookingId, type: 'SYSTEM_LOG', message: `Đổi dịch vụ đơn ${booking.billCode || bookingId}: từ "${oldServiceName}" thành "${newServiceName}". Tính tiền: ${diffText}.` });

            return { success: true, newTotalAmount, newPrice, newDuration, newServiceName, newDisplayName: newOptions.displayName, priceDiff };
        } catch (error: any) {
            console.error("❌ [Server] Lỗi sửa dịch vụ:", error.message);
            return { success: false, error: error.message };
        }
    }

    static async splitBookingItem(bookingId: string, itemId: string, dur1: number, dur2: number, date: string) {
        try {
            await requirePermission('dispatch_board');
            const supabase = getSupabaseAdmin();
            if (!supabase) throw new Error('Supabase admin not initialized');

            const { data: originalItem, error: fetchErr } = await supabase.from('BookingItems').select('*').eq('id', itemId).single();
            if (fetchErr || !originalItem) throw new Error('Không tìm thấy dịch vụ gốc để tách');

            let originalSegs: any[] = [];
            try { originalSegs = typeof originalItem.segments === 'string' ? JSON.parse(originalItem.segments) : (originalItem.segments || []); } catch {}
            
            const calcEnd = (start: string, mins: number): string => {
                if (!start || !/^\d{1,2}:\d{2}$/.test(start)) {
                    const now = new Date(); const d = new Date(); d.setHours(now.getHours(), now.getMinutes() + mins, 0, 0);
                    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                }
                const [h, m] = start.split(':').map(Number);
                const d = new Date(); d.setHours(h, m + mins, 0, 0);
                return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            };

            let ktv1Start = originalSegs[0]?.startTime || '';
            if (!ktv1Start) { const now = new Date(); ktv1Start = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; }
            const ktv1End = calcEnd(ktv1Start, dur1);
            const ktv2Start = ktv1End; 
            const ktv2End = calcEnd(ktv2Start, dur2);

            if (originalSegs.length > 0) {
                originalSegs[0].duration = dur1; originalSegs[0].startTime = ktv1Start; originalSegs[0].endTime = ktv1End;
            } else {
                originalSegs = [{ duration: dur1, startTime: ktv1Start, endTime: ktv1End }];
            }

            await supabase.from('BookingItems').update({ segments: originalSegs }).eq('id', itemId);

            const { id: _oldId, created_at: _ca, ...newItemData } = originalItem;
            newItemData.id = crypto.randomUUID();
            newItemData.price = 0; 
            newItemData.technicianCodes = []; 
            newItemData.segments = [{ duration: dur2, startTime: ktv2Start, endTime: ktv2End }];
            newItemData.timeStart = null; newItemData.timeEnd = null; newItemData.status = 'NEW';
            
            let opts = typeof newItemData.options === 'string' ? JSON.parse(newItemData.options) : (newItemData.options || {});
            opts.isSplitItem = true; opts.parentItemId = itemId; newItemData.options = opts;

            await supabase.from('BookingItems').insert(newItemData);

            if (date) {
                const { syncTurnsForDate } = await import('@/lib/turn-sync');
                await syncTurnsForDate(date);
            }

            return { success: true };
        } catch (error: any) {
            console.error('❌ [Server] splitBookingItem error:', error);
            return { success: false, error: error.message };
        }
    }
}
