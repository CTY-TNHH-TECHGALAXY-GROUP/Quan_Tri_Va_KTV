export const KTV_WORK_TYPES = {
  TYPE_A: 'TYPE_A', // Mặc định - 100k/h
  TYPE_B: 'TYPE_B', // KTV VIP - 180k/h cho mã VIP/Điều trị
  TYPE_C: 'TYPE_C', // Học việc - 0đ
} as const;

export type KtvWorkType = keyof typeof KTV_WORK_TYPES;

export const BASE_RATE = 100000; // 100k/h
export const VIP_RATE = 180000;  // 180k/h

/**
 * Tính tiền hoa hồng tua cho KTV dựa trên cơ chế Két Sắt 2 Lớp (Global Toggle + Per-Staff Config)
 * 
 * @param isGlobalToggleOn Cờ bật/tắt toàn hệ thống (`ktv_type_b_enabled`)
 * @param staffWorkType Loại nhân viên (TYPE_A, TYPE_B, TYPE_C)
 * @param serviceCode Mã dịch vụ (ví dụ: NHP001, NHT002, NHS090...)
 * @param durationInMinutes Thời lượng làm thực tế (phút)
 * @returns Số tiền hoa hồng KTV được nhận
 */
export function calculateKtvCommission(
  isGlobalToggleOn: boolean,
  staffWorkType: KtvWorkType | string | null,
  serviceCode: string,
  durationInMinutes: number
): number {
  const durationInHours = durationInMinutes / 60;
  const safeWorkType = staffWorkType || KTV_WORK_TYPES.TYPE_A;

  // LỚP 1: CÔNG TẮC TỔNG BỊ TẮT -> Ép toàn bộ về Loại A
  if (!isGlobalToggleOn) {
    if (safeWorkType === KTV_WORK_TYPES.TYPE_C) return 0; // Học việc vẫn 0đ
    return durationInHours * BASE_RATE;
  }

  // LỚP 2: CÔNG TẮC TỔNG BẬT -> Xét theo từng loại KTV
  if (safeWorkType === KTV_WORK_TYPES.TYPE_C) {
    return 0; // Loại C không có tiền
  }

  if (safeWorkType === KTV_WORK_TYPES.TYPE_B) {
    // Loại B: Kiểm tra mã dịch vụ
    const isVipOrTreatment = serviceCode?.startsWith('NHP') || serviceCode?.startsWith('NHT');
    
    if (isVipOrTreatment) {
      return durationInHours * VIP_RATE;
    }
    // Mã thường (NHS) hoặc mã khác thì vẫn tính giá cơ bản
    return durationInHours * BASE_RATE;
  }

  // Mặc định (Loại A hoặc không xác định)
  return durationInHours * BASE_RATE;
}
