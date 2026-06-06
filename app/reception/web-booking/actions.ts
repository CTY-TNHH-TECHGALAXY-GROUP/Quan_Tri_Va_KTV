'use server';

// ═══════════════════════════════════════════════════════
// Web Booking Server Actions
// Handle incoming bookings from the web booking platform
// ═══════════════════════════════════════════════════════

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';

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
      .in('source', ['WEB_BOOKING', 'HOME_BOOKING', 'VIP_BOOKING', 'STANDARD_BOOKING', 'MIXED_WALK_IN', 'MIXED_BOOKING'])
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

    // Fetch BookingItems for all bookings
    const bookingIds = bookings.map((b: any) => b.id);
    const { data: items } = await supabase
      .from('BookingItems')
      .select('*')
      .in('bookingId', bookingIds);

    // Map to WebBooking type
    const result: WebBooking[] = bookings.map((b: any) => {
      const bookingItems: WebBookingItem[] = (items || [])
        .filter((i: any) => i.bookingId === b.id)
        .map((i: any) => {
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

    // Lấy thông tin hiện tại để map sang loại tương ứng và gửi thông báo KTV
    const { data: bData } = await supabase
      .from('Bookings')
      .select('source, technicianCode, roomName, bedId, billCode')
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
