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

export const generateBillCode = async (supabase: SupabaseClient, dateCode: string): Promise<string> => {
    try {
        // Lấy tất cả mã bill trong ngày để tìm số lớn nhất (tránh lỗi khi có đơn bị xoá)
        const { data } = await supabase
            .from('Bookings')
            .select('billCode')
            .like('billCode', `%-${dateCode}`);
            
        let maxNumber = 0;
        
        if (data && data.length > 0) {
            data.forEach(item => {
                if (item.billCode) {
                    const codePart = item.billCode.split('-')[0];
                    const num = parseInt(codePart, 10);
                    if (!isNaN(num) && num > maxNumber) {
                        maxNumber = num;
                    }
                }
            });
        }
        
        return `${String(maxNumber + 1).padStart(3, '0')}-${dateCode}`;
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
