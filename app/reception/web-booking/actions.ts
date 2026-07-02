'use server';

// ═══════════════════════════════════════════════════════
// Web Booking Server Actions
// Handle incoming bookings from the web booking platform
// ═══════════════════════════════════════════════════════

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';
import { sendBookingConfirmationEmail } from '@/lib/email';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type WebBookingStatus = 'NEW' | 'PREPARING' | 'IN_PROGRESS' | 'COMPLETED' | 'DONE' | 'FEEDBACK' | 'CANCELLED';

export interface WebBookingItem {
  id: string;
  serviceId: string;
  serviceName: string;
  duration: number;
  price: number;
  quantity: number;
  options?: Record<string, any>;
  requestedKTVs?: { code: string; name: string; skills: string }[];
}

export interface WebBooking {
  id: string;
  billCode: string;
  branchName: string | null;
  bookingDate: string;
  timeBooking: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerLang: string | null;
  notes: string | null;
  technicianCode: string | null;
  totalAmount: number;
  status: WebBookingStatus;
  createdAt: string;
  updatedAt: string;
  accessToken: string | null;
  source: string;
  items: WebBookingItem[];
}

// ─── SERVER ACTIONS ───────────────────────────────────────────────────────────

/**
 * Fetch web bookings for a date range.
 * Includes BookingItems with service name resolution.
 */
export async function getWebBookings(startDate: string, endDate: string) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase admin not initialized');

    const startOfRange = `${startDate} 00:00:00`;
    const endOfRange = `${endDate} 23:59:59`;

    // Fetch bookings by source, excluding cancelled
    const { data: bookings, error: bError } = await supabase
      .from('Bookings')
      .select('*')
      .gte('bookingDate', startOfRange)
      .lte('bookingDate', endOfRange)
      .neq('status', 'CANCELLED')
      .in('source', ['WEB_BOOKING', 'HOME_BOOKING', 'VIP_BOOKING', 'STANDARD_BOOKING', 'MIXED_BOOKING'])
      .order('createdAt', { ascending: false });

    if (bError) throw bError;
    if (!bookings || bookings.length === 0) return { success: true, data: [] as WebBooking[] };

    // Fetch all services for name resolution
    const { data: allServices } = await supabase
      .from('Services')
      .select('id, code, nameVN, nameEN, duration, priceVND')
      .limit(1000);

    const servicesMap: Record<string, { name: string; duration: number; price: number }> = {};
    if (allServices) {
      allServices.forEach((s: any) => {
        const name =
          typeof s.nameVN === 'object' && s.nameVN !== null
            ? s.nameVN.vn || s.nameVN.en || ''
            : s.nameVN || s.nameEN || '';
        const info = { name, duration: s.duration ?? 60, price: s.priceVND ?? 0 };
        if (s.id) servicesMap[String(s.id).toLowerCase()] = info;
        if (s.code) servicesMap[String(s.code).toLowerCase()] = info;
      });
    }

    // Fetch all staff for name resolution
    const { data: allStaff } = await supabase
      .from('Staff')
      .select('id, full_name, skills')
      .limit(1000);

    const staffMap: Record<string, { name: string; skills: string }> = {};
    if (allStaff) {
      allStaff.forEach((s: any) => {
         let skillsText = '';
         try {
             if (s.skills && typeof s.skills === 'string') {
                 const parsed = JSON.parse(s.skills);
                 if (Array.isArray(parsed)) skillsText = parsed.join(', ');
             } else if (Array.isArray(s.skills)) {
                 skillsText = s.skills.join(', ');
             }
         } catch(e) {}
         staffMap[String(s.id).toLowerCase()] = { name: s.full_name || s.id, skills: skillsText };
      });
    }

    // Fetch BookingItems for all bookings
    const bookingIds = bookings.map((b: any) => b.id);
    const { data: items } = await supabase
      .from('BookingItems')
      .select('*')
      .in('bookingId', bookingIds);

    // Map to WebBooking type
    const result: WebBooking[] = bookings.map((b: any) => {
      let requestedKtvCodes: string[] = [];

      const bookingItems: WebBookingItem[] = (items || [])
        .filter((i: any) => i.bookingId === b.id)
        .map((i: any) => {
          let requestedKTVs: { code: string; name: string; skills: string }[] = [];
          if (Array.isArray(i.technicianCodes) && i.technicianCodes.length > 0) {
              requestedKtvCodes.push(...i.technicianCodes);
              requestedKTVs = i.technicianCodes.map((code: string) => {
                  const sInfo = staffMap[String(code).toLowerCase()];
                  return { code, name: sInfo?.name || code, skills: sInfo?.skills || '' };
              });
          }
          const svcKey = String(i.serviceId || '').toLowerCase();
          const svcInfo = servicesMap[svcKey];
          
          let parsedOptions = i.options ?? {};
          if (typeof i.options === 'string') {
              try { parsedOptions = JSON.parse(i.options); } catch(e) {}
          }

          let finalDuration = svcInfo?.duration ?? i.duration ?? 60;
          if (parsedOptions?.vipDuration) {
              finalDuration = Number(parsedOptions.vipDuration);
          } else if (parsedOptions?.duration) {
              finalDuration = Number(parsedOptions.duration);
          }

          return {
            id: i.id,
            serviceId: i.serviceId || '',
            serviceName: parsedOptions?.displayName || svcInfo?.name || `Dịch vụ ${i.serviceId}`,
            duration: finalDuration,
            price: i.price ?? svcInfo?.price ?? 0,
            quantity: i.quantity ?? 1,
            options: parsedOptions,
            requestedKTVs,
          };
        });

      return {
        id: b.id,
        billCode: b.billCode || b.id,
        branchName: b.branchName || null,
        bookingDate: b.bookingDate || '',
        timeBooking: b.timeBooking || null,
        customerName: b.customerName || 'Khách',
        customerPhone: b.customerPhone || null,
        customerEmail: b.customerEmail || null,
        customerLang: b.customerLang || 'vi',
        notes: b.notes || null,
        technicianCode: requestedKtvCodes.length > 0 
           ? Array.from(new Set(requestedKtvCodes)).join(', ') 
           : (b.technicianCode || null),
        totalAmount: Number(b.totalAmount) || 0,
        status: (b.status as WebBookingStatus) || 'NEW',
        createdAt: b.createdAt || '',
        updatedAt: b.updatedAt || '',
        accessToken: b.accessToken || null,
        source: b.source || 'WEB_BOOKING',
        items: bookingItems,
      };
    });

    return { success: true, data: result };
  } catch (error: any) {
    console.error('❌ [WebBooking] getWebBookings error:', error);
    return { success: false, error: error.message, data: [] as WebBooking[] };
  }
}

/**
 * Confirm a web booking: keeps status = 'NEW' so it appears in
 * Dispatch Board as 'Chờ điều phối' — same flow as walk-in bookings.
 * Only touches updatedAt to trigger realtime update on dispatch board.
 */
export async function confirmWebBooking(bookingId: string) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase admin not initialized');

    // Lấy thông tin hiện tại để map sang loại tương ứng và gửi thông báo KTV, kèm thông tin chi tiết cho Email
    const { data: bData } = await supabase
      .from('Bookings')
      .select(`
        source, technicianCode, roomName, bedId, billCode, customerName, customerEmail, customerLang, customerPhone,
        bookingDate, timeBooking, totalAmount, id,
        BookingItems!BookingItems_bookingId_fkey (
          quantity,
          serviceId,
          Services!BookingItems_serviceId_fkey (
            nameVN, nameEN, nameKR, nameJP, nameCN, duration
          )
        )
      `)
      .eq('id', bookingId)
      .single();

    let newSource = 'STANDARD_WALK_IN';
    if (bData?.source === 'VIP_BOOKING') {
      newSource = 'VIP_WALK_IN';
    } else if (bData?.source === 'MIXED_BOOKING' || bData?.source === 'MIXED_WALK_IN') {
      newSource = 'MIXED_WALK_IN';
    }

    const { error } = await supabase
      .from('Bookings')
      .update({
        source: newSource,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('status', 'NEW'); // Safety: only update if still NEW

    if (error) throw error;

    const msg = `Đơn ${bookingId} đã được xác nhận. Vui lòng vào Điều Phối để phân công KTV.`;
    
    // 1. Insert Realtime StaffNotification for UI Toasts & Push
    await createNotification({
        bookingId: bookingId,
        type: 'NEW_ORDER',
        message: msg,
    });

    // 2. Gửi thông báo cho KTV yêu cầu nếu có sẵn
    if (bData?.technicianCode) {
        const techList = bData.technicianCode.split(',').map((t: string) => t.trim()).filter(Boolean);
        const locationInfo = `Phòng ${bData.roomName || '???'}${bData.bedId ? ` - Giường ${bData.bedId.split('-').pop()}` : ''}`;
        
        for (const techCode of techList) {
            const ktvMsg = `Bạn có đơn yêu cầu mới #${bData.billCode || bookingId} tại ${locationInfo}`;
            
            await createNotification({
                bookingId: bookingId,
                employeeId: techCode,
                type: 'KTV_NEW_ORDER',
                message: ktvMsg,
            });
        }
    }

    // 3. Gửi email xác nhận kèm mã QR nếu có email
    if (bData?.customerEmail) {
        // Kiểm tra xem khách cũ hay mới dựa trên cấu hình "ngưỡng tin cậy"
        let isNewCustomer = true;
        if (bData.customerPhone) {
            // 1. Kiểm tra "Blacklist": Khách có từng bùng kèo (CANCELLED) lần nào chưa?
            const { data: cancelledBookings } = await supabase
              .from('Bookings')
              .select('id')
              .eq('customerPhone', bData.customerPhone)
              .eq('status', 'CANCELLED')
              .limit(1);

            // Nếu KHÔNG CÓ lịch sử hủy kèo, mới bắt đầu xét uy tín
            if (!cancelledBookings || cancelledBookings.length === 0) {
                // 2. Lấy cấu hình số lượng đơn tối thiểu để thành khách VIP (mặc định 1)
                const { data: configData } = await supabase
                   .from('SystemConfigs')
                   .select('value')
                   .eq('key', 'web_booking_trusted_threshold')
                   .maybeSingle();
                
                const threshold = parseInt(configData?.value || '1', 10);

                // 3. Tìm đúng N đơn Web trước đó của SĐT này (tối ưu hóa bằng LIMIT)
                const { data: pastBookings } = await supabase
                  .from('Bookings')
                  .select('id')
                  .eq('customerPhone', bData.customerPhone)
                  .eq('isWebBooking', true)
                  .neq('status', 'CANCELLED') // Không tính những đơn web bị hủy vào quota
                  .neq('id', bookingId) // Loại trừ đơn hiện tại
                  .limit(threshold);
                
                // 4. Nếu khách có đủ số đơn yêu cầu, họ được tính là khách cũ (không cần cọc)
                if (pastBookings && pastBookings.length >= threshold) {
                    isNewCustomer = false;
                }
            }
        }

        // 5. Lấy % cọc từ SystemConfigs
        let depositPercent = 40;
        try {
            const { data: configData } = await supabase
                .from('SystemConfigs')
                .select('value')
                .eq('key', 'web_booking_deposit_percent')
                .maybeSingle();
            if (configData && configData.value) {
                depositPercent = parseInt(configData.value, 10);
            }
        } catch (e) {}

        // Thuật toán: Lấy 50% tổng bill, làm tròn ĐẾN 100.000 gần nhất
        let depositAmountVND = 0;
        if (bData.totalAmount && bData.totalAmount > 0) {
            const rawDeposit = (bData.totalAmount * 50) / 100;
            // Làm tròn đến hàng trăm nghìn (vd: 525k -> 5.25 -> round=5 -> 500k)
            depositAmountVND = Math.max(100000, Math.round(rawDeposit / 100000) * 100000);
        }

        // Bóc tách danh sách dịch vụ và tính tổng phút, số lượng khách
        let totalDuration = 0;
        let totalGuests = 0;
        const serviceList: { name: string; duration: number }[] = [];

        if (bData.BookingItems && Array.isArray(bData.BookingItems)) {
            bData.BookingItems.forEach((item: any) => {
                const qty = item.quantity || 1;
                totalGuests += qty;
                
                if (item.Services) {
                    const dur = item.Services.duration || 0;
                    totalDuration += dur;
                    
                    // Lấy tên dịch vụ theo ngôn ngữ khách hàng
                    let sName = item.Services.nameEN || 'Service';
                    if (bData.customerLang === 'vi') sName = item.Services.nameVN || sName;
                    else if (bData.customerLang === 'kr') sName = item.Services.nameKR || sName;
                    else if (bData.customerLang === 'jp') sName = item.Services.nameJP || sName;
                    else if (bData.customerLang === 'cn') sName = item.Services.nameCN || sName;
                    
                    serviceList.push({ name: sName, duration: dur });
                }
            });
        }

        const bookingDetails = {
            bookingId: bData.billCode || bData.id || bookingId,
            date: bData.bookingDate || '',
            time: bData.timeBooking || '',
            services: serviceList,
            duration: totalDuration,
            guests: totalGuests,
            depositAmount: depositAmountVND
        };

        // Gọi hàm gửi email (BẮT BUỘC CÓ AWAIT trên Vercel/Serverless để hàm không bị ngắt giữa chừng)
        try {
            await sendBookingConfirmationEmail(
                bData.customerEmail,
                bData.customerName || 'Quý khách',
                bData.customerLang || 'vi',
                isNewCustomer,
                bookingDetails
            );
        } catch (err) {
            console.error('[WebBooking] Lỗi khi gửi email xác nhận:', err);
        }
    }

    return { success: true };
  } catch (error: any) {
    console.error('❌ [WebBooking] confirmWebBooking error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Reject a web booking: NEW → CANCELLED
 */
export async function rejectWebBooking(bookingId: string, reason?: string) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase admin not initialized');

    const { error } = await supabase
      .from('Bookings')
      .update({
        status: 'CANCELLED',
        notes: reason ? `[Từ chối]: ${reason}` : '[Từ chối bởi lễ tân]',
        updatedAt: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('status', 'NEW'); // Safety: only update if still NEW

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('❌ [WebBooking] rejectWebBooking error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get count of NEW bookings (for sidebar badge).
 */
export async function getNewWebBookingCount(): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return 0;

    const { count } = await supabase
      .from('Bookings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'NEW');

    return count ?? 0;
  } catch {
    return 0;
  }
}
