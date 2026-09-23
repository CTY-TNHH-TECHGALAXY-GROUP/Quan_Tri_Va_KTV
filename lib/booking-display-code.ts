/** Keep WebBooking's date and sequence; local bills use their short sequence. */
export function displayBookingCode(code: string | null | undefined): string {
  if (!code) return '';
  return code.startsWith('WB-') ? code : code.split('-')[0];
}
