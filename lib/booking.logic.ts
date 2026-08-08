import { SupabaseClient } from '@supabase/supabase-js';

/**
 * 📅 SHARED BOOKING LOGIC
 * Chứa toàn bộ các tiện ích liên quan đến Booking (tạo bill, chuẩn hoá data).
 */

// =============================================
// 🔧 SHARED CONSTANTS
// =============================================
export const BRANCH_CODE = '11NDK'; // Ngân Hà - 11 Nguyễn Đình Kiên

// =============================================
// 🛠 SHARED UTILITIES
// =============================================

/**
 * Tạo mã Bill (vd: "001-19072026")
 * @param supabase Supabase admin client
 * @param dateCode Chuỗi ngày định dạng DDMMYYYY (vd: "19072026")
 */
export const generateBillCode = async (supabase: SupabaseClient, dateCode: string): Promise<string> => {
    try {
        const { count } = await supabase
            .from('Bookings')
            .select('id', { count: 'exact', head: true })
            .like('billCode', `%-${dateCode}`);
        
        const countValue = count || 0;
        return `${String(countValue + 1).padStart(3, '0')}-${dateCode}`;
    } catch (e) {
        console.error("❌ [generateBillCode] Error:", e);
        return `999-${dateCode}`;
    }
};

/**
 * Tạo ID cho bảng Bookings (vd: "BK-11NDK-001-19072026")
 * @param billCode Mã bill lấy từ generateBillCode
 */
export const generateBookingId = (billCode: string): string => {
    return `BK-${BRANCH_CODE}-${billCode}`;
};

/**
 * Chuẩn hoá giới tính (gender)
 */
export const normalizeGender = (g: string | null | undefined): string => {
    if (!g) return 'Nam'; // Default
    const lower = g.trim().toLowerCase();
    if (['nam', 'male', 'm'].includes(lower)) return 'Nam';
    if (['nu', 'nữ', 'female', 'f'].includes(lower)) return 'Nữ';
    return 'Nam';
};
