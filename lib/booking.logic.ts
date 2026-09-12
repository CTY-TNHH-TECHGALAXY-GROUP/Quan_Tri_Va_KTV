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
    if (['nam', 'male', 'm', '남성', '남자', '男', '男性'].includes(lower)) return 'Nam';
    if (['nu', 'nữ', 'female', 'f', '여성', '여자', '女', '女性'].includes(lower)) return 'Nữ';
    return 'Nam';
};

// =============================================
// 🌐 MULTI-LANGUAGE BODY PARTS & PREFERENCES
// =============================================

export const BODY_PART_MAP: Record<string, string> = {
  // Toàn thân
  'whole_body': 'Toàn thân',
  'full_body': 'Toàn thân',
  'full body': 'Toàn thân',
  'whole body': 'Toàn thân',
  'body': 'Toàn thân',
  'toàn thân': 'Toàn thân',
  'toan than': 'Toàn thân',
  '全身': 'Toàn thân',
  '전신': 'Toàn thân',
  '전체': 'Toàn thân',

  // Đầu
  'head': 'Đầu',
  'đầu': 'Đầu',
  'dau': 'Đầu',
  '头部': 'Đầu',
  '头': 'Đầu',
  '頭': 'Đầu',
  '頭部': 'Đầu',
  '머리': 'Đầu',
  '두피': 'Đầu',

  // Cổ
  'neck': 'Cổ',
  'cổ': 'Cổ',
  'co': 'Cổ',
  '颈部': 'Cổ',
  '脖子': 'Cổ',
  '颈': 'Cổ',
  '首': 'Cổ',
  '首筋': 'Cổ',
  '목': 'Cổ',

  // Vai
  'shoulder': 'Vai',
  'shoulders': 'Vai',
  'vai': 'Vai',
  '肩部': 'Vai',
  '肩膀': 'Vai',
  '肩': 'Vai',
  '어깨': 'Vai',

  // Tay
  'arm': 'Tay',
  'arms': 'Tay',
  'tay': 'Tay',
  'cánh tay': 'Tay',
  'canh tay': 'Tay',
  '手臂': 'Tay',
  '手': 'Tay',
  '臂': 'Tay',
  '腕': 'Tay',
  '팔': 'Tay',

  // Lưng
  'back': 'Lưng',
  'lưng': 'Lưng',
  'lung': 'Lưng',
  '背部': 'Lưng',
  '背': 'Lưng',
  '背中': 'Lưng',
  '등': 'Lưng',
  '허리': 'Lưng',

  // Đùi
  'thigh': 'Đùi',
  'thighs': 'Đùi',
  'đùi': 'Đùi',
  'dui': 'Đùi',
  '大腿': 'Đùi',
  '太もも': 'Đùi',
  '太腿': 'Đùi',
  'もも': 'Đùi',
  '허벅지': 'Đùi',

  // Đầu gối
  'knee': 'Đầu gối',
  'knees': 'Đầu gối',
  'đầu gối': 'Đầu gối',
  'dau goi': 'Đầu gối',
  'gối': 'Đầu gối',
  'goi': 'Đầu gối',
  '膝盖': 'Đầu gối',
  '膝': 'Đầu gối',
  'ひざ': 'Đầu gối',
  '무릎': 'Đầu gối',

  // Bắp chân
  'calf': 'Bắp chân',
  'calves': 'Bắp chân',
  'bắp chân': 'Bắp chân',
  'bap chan': 'Bắp chân',
  '小腿': 'Bắp chân',
  'ふくらはぎ': 'Bắp chân',
  '脹脛': 'Bắp chân',
  '종아리': 'Bắp chân',

  // Bàn chân
  'foot': 'Bàn chân',
  'feet': 'Bàn chân',
  'bàn chân': 'Bàn chân',
  'ban chan': 'Bàn chân',
  'chân': 'Bàn chân',
  'chan': 'Bàn chân',
  '脚部': 'Bàn chân',
  '脚': 'Bàn chân',
  '足': 'Bàn chân',
  '足裏': 'Bàn chân',
  '발': 'Bàn chân',
  '발바닥': 'Bàn chân',
};

export const STRENGTH_MAP: Record<string, string> = {
  // Nhẹ
  'light': 'Nhẹ',
  'soft': 'Nhẹ',
  'gentle': 'Nhẹ',
  'nhẹ': 'Nhẹ',
  'nhe': 'Nhẹ',
  '轻轻': 'Nhẹ',
  '轻': 'Nhẹ',
  '柔和': 'Nhẹ',
  '弱め': 'Nhẹ',
  '弱い': 'Nhẹ',
  '약': 'Nhẹ',
  '약하게': 'Nhẹ',

  // Vừa
  'medium': 'Vừa',
  'normal': 'Vừa',
  'moderate': 'Vừa',
  'vừa': 'Vừa',
  'vua': 'Vừa',
  '适中': 'Vừa',
  '中等': 'Vừa',
  '中': 'Vừa',
  '普通': 'Vừa',
  '보통': 'Vừa',

  // Mạnh
  'strong': 'Mạnh',
  'hard': 'Mạnh',
  'firm': 'Mạnh',
  'heavy': 'Mạnh',
  'mạnh': 'Mạnh',
  'manh': 'Mạnh',
  '用力': 'Mạnh',
  '强': 'Mạnh',
  '重': 'Mạnh',
  '強め': 'Mạnh',
  '強い': 'Mạnh',
  '강': 'Mạnh',
  '강하게': 'Mạnh',
};

/**
 * Chuẩn hoá và dịch các vùng tập trung (focus) / tránh (avoid) sang tiếng Việt.
 * Nhận chuỗi hoặc mảng từ mọi ngôn ngữ (VN, EN, CN, JP, KR).
 * Tự động nhận diện 'Toàn thân' khi chọn >= 8 vùng hoặc có từ khóa Toàn thân.
 */
export const formatBodyAreas = (raw: string | string[] | undefined | null): string => {
  if (!raw) return '';
  let parts: string[] = [];
  if (Array.isArray(raw)) {
    parts = raw.map(s => String(s || '').trim()).filter(Boolean);
  } else if (typeof raw === 'string') {
    parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    return '';
  }

  if (parts.length === 0) return '';

  const translated = parts.map(p => {
    const key = p.trim().toLowerCase();
    return BODY_PART_MAP[key] || p.trim();
  });

  const unique = Array.from(new Set(translated));
  const isFullBody = unique.some(p => p === 'Toàn thân') || unique.length >= 8;
  if (isFullBody) {
    return 'Toàn thân';
  }

  return unique.join(', ');
};

/**
 * Chuẩn hoá mức lực massage (strength) sang tiếng Việt (Nhẹ / Vừa / Mạnh).
 */
export const normalizeStrength = (s: string | null | undefined): string => {
  if (!s) return '';
  const key = s.trim().toLowerCase();
  return STRENGTH_MAP[key] || s.trim();
};

/**
 * Kiểm tra xem một service item có phải là tiện ích (như Phòng riêng) hay không.
 * Cơ chế: Dựa vào cờ is_utility trong DB, fallback về các check string cũ nếu dữ liệu cũ chưa migrate.
 */
export function isUtilityService(item: any): boolean {
    if (!item) return false;
    
    // 1. Chuẩn mực: DB flag
    if (item.is_utility === true || item.isUtility === true || item.Services?.is_utility === true) return true;
    
    // 2. Fallback: Mã dịch vụ cũ
    if (item.serviceId === 'NHS0900' || item.id === 'NHS0900') return true;
    
    // 3. Fallback: Kiểm tra string tên
    const name = String(item.serviceName || item.service_name || item.name || item.Services?.nameVN || item.Services?.nameEN || '').toLowerCase();
    if (name.includes('phòng riêng') || name.includes('phong rieng')) {
        // Tránh trùng các dịch vụ có dấu + (combo)
        if (!name.includes('+')) return true;
    }
    
    return false;
}
