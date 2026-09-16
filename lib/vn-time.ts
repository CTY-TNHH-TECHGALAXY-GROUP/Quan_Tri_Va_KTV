import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Returns current Date object in VN timezone
 */
export const vnNow = (): Date => {
  return toZonedTime(new Date(), VN_TIMEZONE);
};

/**
 * Returns today's date string in VN timezone (yyyy-MM-dd)
 */
export const vnToday = (): string => {
  return format(vnNow(), 'yyyy-MM-dd');
};

/**
 * Returns current hour (0-23) in VN timezone
 */
export const vnHour = (): number => {
  return parseInt(format(vnNow(), 'HH'), 10);
};

/**
 * 'yyyy-MM-dd' → 'dd/MM/yyyy' để hiện cho người đọc.
 *
 * Dùng cho MỌI thông báo và thông điệp lỗi gửi tới nhân viên: họ đọc trên điện
 * thoại, in nguyên ngày ISO ra là bắt họ tự dịch ngược. Chuỗi không đúng dạng thì
 * trả lại nguyên vẹn, không nuốt mất dữ liệu.
 */
export function vnDate(iso: string): string {
  const raw = String(iso ?? '');
  // Khớp CHẶT yyyy-MM-dd. Nếu chỉ kiểm "tách ra đủ 3 mảnh" thì một chuỗi bất kỳ
  // có 2 dấu gạch cũng lọt và bị đảo lộn thành rác, ví dụ 'khong-phai-ngay'.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}

/**
 * Sửa / huỷ lịch ngày D được phép đến 06:59 sáng chính ngày D.
 * Từ 07:00 thì đóng băng — chỉ còn quyền BÁO TRỄ 1 lần.
 *
 * @param workDateStr 'yyyy-MM-dd'
 */
export function canEditRegistration(workDateStr: string): boolean {
  const today = vnToday();
  if (workDateStr > today) return true;
  if (workDateStr === today && vnHour() < 7) return true;
  return false;
}

/**
 * Hạn chót đổi lịch MIỄN PHẠT: **00:00 nửa đêm** của ngày làm.
 * Tức là được đổi thoải mái đến hết ngày hôm trước.
 */
export type RegistrationEditWindow =
  | 'FREE'      // còn trong hạn — đổi thoải mái, không phạt
  | 'PENALTY'   // đã sang ngày làm nhưng chưa tới 07:00 — đổi được nhưng trừ 5 giờ
  | 'LOCKED';   // từ 07:00 ngày làm — hết quyền đổi, chỉ còn báo trễ

/**
 * Đổi lịch ngày D đang nằm ở khung nào.
 *
 *   ... hết ngày D-1        : FREE     — huỷ / chuyển OFF thoải mái
 *   00:00 D → 07:00 D       : PENALTY  — vẫn đổi được, TRỪ 5 GIỜ tích lũy
 *   từ 07:00 ngày D         : LOCKED   — chỉ còn báo trễ 1 lần
 *
 * @param workDateStr 'yyyy-MM-dd' — ngày làm việc đang sửa
 */
export function getRegistrationEditWindow(workDateStr: string): RegistrationEditWindow {
  const today = vnToday();
  if (workDateStr > today) return 'FREE';                 // chưa tới ngày làm
  if (workDateStr === today) return vnHour() < 7 ? 'PENALTY' : 'LOCKED';
  return 'LOCKED';                                        // ngày làm đã qua
}
