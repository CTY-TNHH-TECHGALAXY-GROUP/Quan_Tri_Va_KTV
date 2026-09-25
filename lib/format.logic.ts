/**
 * 🎨 SHARED FORMATTING LOGIC
 * Chứa toàn bộ các tiện ích format tiền tệ, ngày giờ cho UI.
 */

// =============================================
// 🔧 SHARED CONSTANTS
// =============================================
const LOCALE = 'vi-VN';
const CURRENCY = 'VND';

// =============================================
// 🛠 SHARED UTILITIES
// =============================================

/**
 * Format số tiền thành chuỗi VNĐ.
 * VD: 1000000 -> "1.000.000đ"
 */
export const formatCurrency = (amount: number | string | null | undefined): string => {
  if (amount === null || amount === undefined) return '0đ';
  const num = Number(amount);
  if (isNaN(num)) return '0đ';
  
  return `${num.toLocaleString(LOCALE)}đ`;
};

/**
 * Format Date hoặc chuỗi ngày thành DD/MM/YYYY
 */
export const formatDate = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';
  
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
};

/**
 * Format thời gian chuỗi "HH:mm:ss" thành "HH:mm"
 */
export const formatTime = (timeInput: string | null | undefined): string => {
  if (!timeInput) return '';
  const parts = timeInput.split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return timeInput;
};

/**
 * Format Date thành "HH:mm DD/MM/YYYY"
 */
export const formatDateTime = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  
  return `${h}:${min} ${formatDate(date)}`;
};
