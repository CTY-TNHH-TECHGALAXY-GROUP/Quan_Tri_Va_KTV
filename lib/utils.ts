import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Hàm parse ngày tháng từ DB Supabase (timestamp without timezone)
 * Các chuỗi từ DB (ví dụ: '2026-07-06T04:50:53') thường thiếu chữ Z ở cuối dù bản chất nó là UTC.
 * Hàm này sẽ tự động nối Z vào nếu thiếu, giúp trình duyệt (hay JS) parse ra đúng giờ Việt Nam (+7).
 */
export function parseDbDate(dateString: string | null | undefined): Date {
  if (!dateString) return new Date();
  let ds = dateString;
  if (!ds.endsWith('Z') && !ds.match(/[+-]\d{2}:?\d{2}$/)) {
      ds += 'Z';
  }
  return new Date(ds);
}
