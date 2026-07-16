import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// =============================================
// 🔧 SHARED CONSTANTS — Single Source of Truth
// Sửa ở đây = áp dụng toàn hệ thống
// =============================================

/** Statuses that count as "completed" visits for visit counting */
export const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'FEEDBACK', 'CLEANING'];

/** Threshold: visits must be GREATER than this to be "Khách Cũ" (>= 2 đơn hoàn tất) */
export const RETURNING_THRESHOLD = 1;

// =============================================
// 🛠 SHARED UTILITIES — Import & dùng lại ở mọi nơi
// =============================================

/** Check if a phone number is a dummy/placeholder value (rỗng hoặc toàn số 0) */
export const isDummyPhone = (p: string): boolean => !p || /^0+$/.test(p.trim());

/** Check if an email is a dummy/placeholder value (rỗng hoặc không chứa @) */
export const isDummyEmail = (e: string): boolean => !e || !e.includes('@');

/** Check if visit count qualifies as returning customer */
export const isReturningCustomer = (visitCount: number): boolean => visitCount > RETURNING_THRESHOLD;

/**
 * Fuzzy name matching — đồng bộ với CRM (route.ts line 112-117)
 * Manager thường tái sử dụng 1 tài khoản GUEST cho nhiều khách khác nhau,
 * nên cần verify tên khớp trước khi đếm lượt ghé.
 */
export const isNameMatch = (name1: string, name2: string): boolean => {
  const n1 = (name1 || '').toLowerCase().trim();
  const n2 = (name2 || '').toLowerCase().trim();
  return !n1 || !n2 || n1 === n2 || n1.includes(n2) || n2.includes(n1);
};

// =============================================
// 🎯 MAIN IDENTIFY FUNCTION
// Dùng cho: Identify API, Webhook, hoặc bất kỳ nơi nào
// cần nhận diện nhanh 1 khách bằng phone/email
// =============================================

export interface CustomerIdentity {
  isReturning: boolean;
  visitCount: number;
  guestType: 'Khách Cũ' | 'Khách Mới';
  customerName: string;
  notes: string;
}

/**
 * Thuật toán kiểm tra Khách Cũ / Khách Mới
 * Dùng được cho cả API, Server Actions và Webhooks.
 *
 * @param phoneOrEmail Số điện thoại hoặc email khách hàng cần kiểm tra.
 * @returns Thông tin định danh khách hàng (isReturning, visitCount, customerName, notes)
 */
export async function identifyCustomer(phoneOrEmail: string): Promise<CustomerIdentity | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error('❌ [identifyCustomer] Supabase Admin không khởi tạo được.');
    return null;
  }
  
  const normalizedInput = phoneOrEmail?.trim();
  if (!normalizedInput || normalizedInput === '' || isDummyPhone(normalizedInput)) {
    return null; // Bỏ qua input rỗng hoặc chứa toàn số 0 (Dummy phone)
  }

  try {
    // 1. Tìm thông tin cơ bản & Ghi chú từ bảng Customers
    const { data: customer } = await supabase
      .from('Customers')
      .select('id, fullName, notes')
      .or(`phone.eq.${normalizedInput},email.eq.${normalizedInput}`)
      .maybeSingle();

    // 2. Đếm số đơn hàng ĐÃ HOÀN TẤT của khách này
    const { count: visitCount, error } = await supabase
      .from('Bookings')
      .select('*', { count: 'exact', head: true })
      .or(`customerPhone.eq.${normalizedInput},customerEmail.eq.${normalizedInput}`)
      .in('status', COMPLETED_STATUSES);

    if (error) {
      console.error('❌ [identifyCustomer] Lỗi khi query Bookings:', error);
    }

    const visits = visitCount || 0;
    const isReturning = isReturningCustomer(visits);

    return {
      isReturning,
      visitCount: visits,
      guestType: isReturning ? 'Khách Cũ' : 'Khách Mới',
      customerName: customer?.fullName || 'Khách Vãng Lai',
      notes: customer?.notes || ''
    };
  } catch (error) {
    console.error('❌ [identifyCustomer] Lỗi nghiêm trọng:', error);
    return null;
  }
}
